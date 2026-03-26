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
            const billingData = data;
            
            const customerId = billingData.customer?.id || billingData.customerId;
            const customerEmail = billingData.customer?.email;
            const billingId = billingData.id; 
            
            // Map fixed link IDs to plan types
            let planType: 'monthly' | 'annual' = 'monthly';
            if (billingId === 'bill_k0J6rzHHKHRMbb4gqX64AQNJ') {
                planType = 'annual';
            }

            console.log(`[WEBHOOK] Processando billingId=${billingId}, planType=${planType}, email=${customerEmail}`);

            let userData: any = null;
            
            if (customerId) {
                const { data } = await supabase
                    .from('users')
                    .select('id, name')
                    .eq('abacate_customer_id', customerId)
                    .maybeSingle();
                userData = data;
            }

            if (!userData && customerEmail) {
                const { data } = await supabase
                    .from('users')
                    .select('id, name')
                    .eq('email', customerEmail)
                    .maybeSingle();
                userData = data;
            }

            if (!userData) {
                console.error('[WEBHOOK] Usuario nao localizado');
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
                    abacate_customer_id: customerId // Sync ID if we matched by email
                })
                .eq('id', userData.id);

            if (updateError) {
                console.error('[WEBHOOK] Erro ao atualizar usuario:', updateError.message);
            } else {
                console.log(`[WEBHOOK] Sucesso: ${userData.name} ativado (${planType})`);
            }
        }

        res.sendStatus(200);
    }

    /**
     * Manually check if user should be PRO.
     */
    static async autoReconcile(req: any, res: Response) {
        try {
            const userId = req.userId;
            if (!userId) {
                return res.status(401).json({ error: 'Não autorizado' });
            }

            // Fetch current user from DB to get their customer ID
            const { data: user, error: userError } = await supabase
                .from('users')
                .select('*')
                .eq('id', userId)
                .single();

            if (userError || !user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            // We use abacate_customer_id field
            const abacateCustomerId = user.abacate_customer_id;

            if (!abacateCustomerId) {
                return res.json({ plan_type: 'free', subscription_status: 'unpaid' });
            }

            // Fetch billings from AbacatePay for this customer
            const billings = await AbacateService.listBillings();

            // Check if there is ANY paid billing for this customer
            const paidBilling = billings.find((b: any) =>
                b.customerId === abacateCustomerId && b.status === 'PAID'
            );

            if (paidBilling) {
                const planId = paidBilling.products?.[0]?.externalId || 'monthly';

                // Update local status just in case webhook failed
                const { data: updatedProfile, error: updateError } = await supabase
                    .from('users')
                    .update({
                        plan_type: planId,
                        subscription_status: 'active'
                    })
                    .eq('id', user.id)
                    .select()
                    .single();

                return res.json(updatedProfile);
            }

            res.json({ planType: 'free' });
        } catch (error: any) {
            console.error('❌ Error in autoReconcile:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
}
