import { Request, Response } from 'express';
import { supabase } from '../config/supabaseClient.js';
import { AbacateService } from '../services/abacateService.js';
import { UserProfileDB, dbToApi } from '../models/types.js';
import crypto from 'crypto';

export class BillingController {
    /**
     * User wants to buy a plan.
     * We create a checkout session on AbacatePay.
     */
    static async checkout(req: any, res: Response) {
        try {
            const userId = req.userId;
            const { planId } = req.body;

            console.log(`[CHECKOUT] Iniciando checkout: userId=${userId}, planId=${planId}`);

            if (!userId) {
                return res.status(401).json({ error: 'Não autorizado' });
            }

            const { data: user, error: userError } = await supabase
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();

            if (userError || !user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            if (!['monthly', 'annual'].includes(planId)) {
                return res.status(400).json({ error: 'Plano inválido' });
            }

            // USE FIXED BILLING LINKS AS REQUESTED
            const annualLink = "https://app.abacatepay.com/pay/bill_k0J6rzHHKHRMbb4gqX64AQNJ";
            const monthlyLink = "https://app.abacatepay.com/pay/bill_6WwrTTTeETXXxxhSMfe3Ss3x";
            
            const checkoutUrl = planId === "annual" ? annualLink : monthlyLink;

            console.log(`[CHECKOUT] Redirecionando para link fixo: ${planId}`);
            res.json({ url: checkoutUrl });
        } catch (error: any) {
            console.error('[CHECKOUT] Erro:', error.message);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Webhook for AbacatePay.
     */
    static async webhook(req: Request, res: Response) {
        const expectedSecret = process.env.ABACATE_PAY_WEBHOOK_SECRET;
        const webhookSecret = req.query.webhookSecret;

        if (expectedSecret && webhookSecret !== expectedSecret) {
            console.warn('[WEBHOOK] Assinatura inválida');
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const payload = req.body;
        if (payload.event !== 'billing.paid') {
            return res.sendStatus(200);
        }

        console.log('[WEBHOOK] Processando billing.paid...');

        // Robust extraction from diverse payload structures
        const billing = payload.data || payload.metadata?.data?.billing || payload.metadata?.data || {};
        const customer = billing.customer || {};

        let customerEmail = (billing.email || customer.email || "").toString().toLowerCase().trim();
        let customerId = (customer.id || billing.id || "").toString().trim();
        let amount = billing.amount || 0;
        let externalId = billing.externalId || (billing.products?.[0]?.externalId) || "";

        console.log(`[WEBHOOK] Extração: Email=${customerEmail || 'N/A'}, ID=${customerId || 'N/A'}, Valor=${amount}, ExternalID=${externalId || 'N/A'}`);
        if (!customerEmail || customerEmail === 'null' || customerEmail === 'undefined') customerEmail = "";
        if (!customerId || customerId === 'null' || customerId === 'undefined') customerId = "";

        if (!customerEmail && !customerId) {
            console.error('[WEBHOOK] Identificadores ausentes no payload:', JSON.stringify(payload, null, 2));
            return res.sendStatus(200);
        }

        // 2. Busca de Usuário (Direto e Reto)
        let user: any = null;

        // Tenta por ID do AbacatePay primeiro
        if (customerId) {
            const { data } = await supabase.from('users').select('id, email').eq('abacate_customer_id', customerId).maybeSingle();
            user = data;
        }

        // Tenta por E-mail se não achou por ID (fundamental para o primeiro pagamento)
        if (!user && customerEmail) {
            const { data } = await supabase.from('users').select('id, email').ilike('email', customerEmail).maybeSingle();
            user = data;
        }

        if (!user) {
            console.error(`[WEBHOOK] Usuário não encontrado no DB para ${customerEmail || customerId}`);
            return res.sendStatus(200);
        }

        // 3. Ativação do Plano
        const planType: 'monthly' | 'annual' = (externalId === 'nodus_anual' || amount >= 19000) ? 'annual' : 'monthly';
        const expiryDate = new Date();
        expiryDate.setMonth(expiryDate.getMonth() + (planType === 'annual' ? 12 : 1));

        const { error: updateError } = await supabase
            .from('users')
            .update({
                plan_type: planType,
                subscription_status: 'active',
                subscription_expiry_date: expiryDate.toISOString(),
                abacate_customer_id: customerId || undefined
            })
            .eq('id', user.id);

        if (updateError) {
            console.error('[WEBHOOK] Falha ao atualizar Supabase:', updateError.message);
        } else {
            console.log(`[WEBHOOK] SUCESSO: Plano ${planType} ativado para ${user.email}`);
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

            // Return mapped profile
            res.json(dbToApi(user as UserProfileDB));
        } catch (error: any) {
            console.error('[RECONCILE] Erro critico:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
    /**
     * Get billing configuration (gateway, env, etc)
     */
    static async getConfig(req: Request, res: Response) {
        try {
            res.json({
                gateway: 'abacatepay',
                env: process.env.NODE_ENV || 'development'
            });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
}

export default BillingController;
