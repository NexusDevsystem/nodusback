import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient.js';
import { AbacateService } from '../services/abacateService.js';
import crypto from 'crypto';

export class BillingController {
    /**
     * User wants to buy a plan.
     * We create a checkout session on AbacatePay.
     */
    static async checkout(req: any, res: Response) {
        try {
            const { planId, taxId, cellphone } = req.body;
            const userId = req.userId;

            console.log(`[CHECKOUT] Iniciando checkout: userId=${userId}, planId=${planId}`);
            const startTime = Date.now();

            if (!userId) {
                console.warn('[CHECKOUT] Tentativa de checkout sem userId');
                return res.status(401).json({ error: 'Não autorizado' });
            }

            // Fetch user from DB to handle synchronization correctly
            const { data: user, error: userError } = await supabase
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();
            
            console.log(`[CHECKOUT] Supabase fetch: ${Date.now() - startTime}ms`);
            console.log(`[CHECKOUT] Supabase user fetch took ${Date.now() - startTime}ms`);

            if (userError || !user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            if (!['monthly', 'annual'].includes(planId)) {
                return res.status(400).json({ error: 'Plano inválido' });
            }

            const amount = planId === 'monthly' ? 1990 : 19900; // Example: R$ 19,90 or R$ 199,00

            const monthlyId = process.env.ABACATE_PAY_PRODUCT_ID_MONTHLY || 'monthly';
            const annualId = process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL || 'annual';
            const abacateProductId = planId === 'annual' ? annualId : monthlyId;
            // 3. Request Checkout Session from AbacatePay v1
            // 3. Use Fixed Billing Links
            const annualLink = "https://app.abacatepay.com/pay/bill_k0J6rzHHKHRMbb4gqX64AQNJ";
            const monthlyLink = "https://app.abacatepay.com/pay/bill_6WwrTTTeETXXxxhSMfe3Ss3x";
            
            const checkoutUrl = planId === "annual" ? annualLink : monthlyLink;

            console.log(`[CHECKOUT] Link fixo: ${planId}`);

            res.json({ url: checkoutUrl });
        } catch (error: any) {
            console.error('[CHECKOUT] Erro:', error.message);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Webhook updated for fixed links.
     * Matches by abacate_customer_id or email.
     */
    static async webhook(req: Request, res: Response) {
        const webhookSecret = req.query.webhookSecret;
        const expectedSecret = process.env.ABACATE_PAY_WEBHOOK_SECRET;

        console.log('[WEBHOOK] Recebido');

        if (expectedSecret && webhookSecret !== expectedSecret) {
            console.warn('[WEBHOOK] Secret invalido');
            return res.status(401).json({ error: 'Unauthorized' });
        }

        console.log('[WEBHOOK] Payload:', JSON.stringify(req.body, null, 2));

        const { event, data } = req.body;

        if (event === 'billing.paid') {
            const billing = data?.billing || data;
            const amount = billing?.amount || 0;
            const customer = billing?.customer || data?.customer;
            const customerId = customer?.id || billing?.customerId || data?.customerId;
            const customerEmail = (customer?.email || billing?.customerEmail || data?.customerEmail || "")?.toString()?.toLowerCase()?.trim();
            
            let planType: 'monthly' | 'annual' = amount >= 19000 ? 'annual' : 'monthly';

            console.log(`[WEBHOOK] Detalhes: Amount=${amount}, Plan=${planType}, Email=${customerEmail || 'no-email'}, CustomerID=${customerId || 'no-id'}`);

            let userData: any = null;
            if (customerId) {
                const { data: dbUser } = await supabase.from('users').select('id, name').eq('abacate_customer_id', customerId).maybeSingle();
                userData = dbUser;
            }

            if (!userData && customerEmail) {
                const { data: dbUserEmail } = await supabase.from('users').select('id, name').ilike('email', customerEmail).maybeSingle();
                userData = dbUserEmail;
            }

            if (!userData) {
                console.error('[WEBHOOK] Usuario nao encontrado para:', customerEmail || customerId);
                return res.sendStatus(200);
            }

            const expiryDate = new Date();
            if (planType === 'annual') {
                expiryDate.setFullYear(expiryDate.getFullYear() + 1);
            } else {
                expiryDate.setMonth(expiryDate.getMonth() + 1);
            }

            const { error: updateError } = await supabase
                .from('users')
                .update({
                    plan_type: planType,
                    subscription_status: 'active',
                    subscription_expiry_date: expiryDate.toISOString(),
                    abacate_customer_id: customerId
                })
                .eq('id', userData.id);

            if (updateError) {
                console.error('[WEBHOOK] Erro no update do banco:', updateError.message);
            } else {
                console.log(`[WEBHOOK] Ativado: ${userData.name} (${planType})`);
            }
        }
        res.sendStatus(200);
    }

    /**
     * Cancel the current subscription (downgrade to free).
     * INDICATES THAT THE RENEWAL IS CANCELED, but user remains PRO until expiry.
     */
    static async cancelSubscription(req: Request, res: Response) {
        try {
            const userId = (req as any).userId;
            if (!userId) return res.status(401).json({ error: 'Não autorizado' });

            // Fetch current plan status to log it
            const { data: user } = await supabase.from('users').select('plan_type, subscription_expiry_date').eq('id', userId).single();
            
            if (user?.plan_type === 'free' || !user?.plan_type) {
                return res.status(400).json({ error: 'Você não possui uma assinatura ativa para cancelar.' });
            }

            const { error: updateError } = await supabase
                .from('users')
                .update({
                    // 🔥 DEFERRED CANCELLATION logic:
                    // We DO NOT change plan_type to 'free' yet.
                    // We DO NOT clear the expiry date.
                    // We only mark the status as 'canceled', which indicates it won't rotate/renew.
                    subscription_status: 'canceled'
                })
                .eq('id', userId);

            if (updateError) {
                console.error('[CANCEL] Erro no update do banco:', updateError.message);
                return res.status(500).json({ error: 'Erro ao cancelar assinatura' });
            }

            console.log(`[CANCEL] Renovação cancelada para o usuário ${userId}. Permanecendo ${user.plan_type} até ${user.subscription_expiry_date}`);
            res.json({ 
                success: true, 
                message: 'Renovação cancelada! Você continuará com acesso Pro até o final do período pago.',
                expiryDate: user.subscription_expiry_date
            });
        } catch (error: any) {
            console.error('[CANCEL] Erro:', error.message);
            res.status(500).json({ error: 'Erro interno ao cancelar' });
        }
    }

    /**
     * Reactivate a previously canceled but not yet expired subscription.
     */
    static async reactivateSubscription(req: Request, res: Response) {
        try {
            const userId = (req as any).userId;
            if (!userId) return res.status(401).json({ error: 'Não autorizado' });

            // Fetch current plan status
            const { data: user } = await supabase.from('users').select('plan_type, subscription_status').eq('id', userId).single();
            
            if (user?.subscription_status !== 'canceled') {
                return res.status(400).json({ error: 'Apenas assinaturas canceladas podem ser reativadas.' });
            }

            const { error: updateError } = await supabase
                .from('users')
                .update({
                    subscription_status: 'active'
                })
                .eq('id', userId);

            if (updateError) {
                console.error('[REACTIVATE] Erro no update do banco:', updateError.message);
                return res.status(500).json({ error: 'Erro ao reativar assinatura' });
            }

            console.log(`[REACTIVATE] Assinatura reativada para o usuário ${userId}`);
            res.json({ 
                success: true, 
                message: 'Assinatura reativada com sucesso! A renovação automática foi religada.'
            });
        } catch (error: any) {
            console.error('[REACTIVATE] Erro:', error.message);
            res.status(500).json({ error: 'Erro interno ao reativar' });
        }
    }

    /**
     * Get payment history (billings) for the current user.
     */
    static async getInvoices(req: Request, res: Response) {
        try {
            const userId = (req as any).userId;
            if (!userId) return res.status(401).json({ error: 'Não autorizado' });

            const { data: user } = await supabase
                .from('users')
                .select('abacate_customer_id')
                .eq('id', userId)
                .single();

            if (!user?.abacate_customer_id) {
                return res.json({ data: [] });
            }

            const billings = await AbacateService.listBillings();
            
            // Filter billings belonging to this customer and that are PAID
            const userBillings = billings
                .filter((b: any) => b.customerId === user.abacate_customer_id && b.status === 'PAID')
                .map((b: any) => ({
                    id: b.id,
                    amount_paid: b.amount,
                    currency: 'brl',
                    status: b.status,
                    created: Math.floor(new Date(b.createdAt).getTime() / 1000),
                    invoice_pdf: b.url, // AbacatePay billing URL acts as receipt
                    number: b.id.replace('bill_', 'REC-'),
                    hosted_invoice_url: b.url,
                    payment_method: b.method || 'PIX', // PIX or CREDIT_CARD
                    card: b.card || null // { brand: 'visa', last4: '4242', expiryMonth: '12', expiryYear: '2029' }
                }));

            res.json({ data: userBillings });
        } catch (error: any) {
            console.error('[INVOICES] Erro:', error.message);
            res.status(500).json({ error: 'Erro ao buscar recibos' });
        }
    }

    /**
     * Manually check if user should be PRO.
     */
    static async autoReconcile(req: Request, res: Response) {
        try {
            const userId = (req as any).userId;

            if (!userId) {
                return res.status(401).json({ error: 'Nao autorizado' });
            }

            const { data: user, error: userError } = await supabase
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();

            if (userError || !user) {
                console.error(`[RECONCILE] Usuario ${userId} nao encontrado ou erro:`, userError?.message);
                return res.status(404).json({ error: 'Usuario nao encontrado' });
            }

            console.log(`[RECONCILE] DB plan_type: ${user.plan_type}`);

            res.json({
                ...user,
                planType: user.plan_type
            });
        } catch (error: any) {
            console.error('[RECONCILE] Erro critico:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
}
