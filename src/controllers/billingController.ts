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

            console.log(`💳 Início do checkout para o usuário ${userId} - Plano: ${planId}`);

            if (!userId) {
                console.warn('⚠️ Tentativa de checkout sem userId');
                return res.status(401).json({ error: 'Não autorizado' });
            }

            // Fetch user from DB to handle synchronization correctly
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

            // Sync user data to DB if missing (taxId/cellphone)
            const { error: updateError } = await supabase
                .from('users')
                .update({ 
                    tax_id: taxId || user.tax_id, 
                    cellphone: cellphone || user.cellphone 
                })
                .eq('id', user.id);

            if (updateError) {
                console.warn('⚠️ Erro ao atualizar info do usuário:', updateError.message);
            }

            const amount = planId === 'monthly' ? 1990 : 19900; // Example: R$ 19,90 or R$ 199,00

            const monthlyId = process.env.ABACATE_PAY_PRODUCT_ID_MONTHLY || 'monthly';
            const annualId = process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL || 'annual';
            const abacateProductId = planId === 'annual' ? annualId : monthlyId;

            // Create Billing on AbacatePay
            const billingRes = await AbacateService.createBilling({
                userId: user.id,
                email: user.email,
                name: user.name,
                taxId: taxId || user.tax_id,
                cellphone: cellphone || user.cellphone,
                amount,
                externalId: abacateProductId,
                customerId: user.abacate_customer_id || undefined
            });

            // Update user's Abacate customer ID if it's the first time
            if (!user.abacate_customer_id && billingRes.customer?.id) {
                await supabase
                    .from('users')
                    .update({ abacate_customer_id: billingRes.customer.id })
                    .eq('id', user.id);
            }

            res.json({ url: billingRes.url });
        } catch (error: any) {
            console.error('❌ Error in checkout:', error.message);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * AbacatePay calls this when payment status changes.
     */
    static async webhook(req: Request, res: Response) {
        const signature = req.headers['abacatepay-signature'] as string;
        const secret = process.env.ABACATE_PAY_WEBHOOK_SECRET;

        // Security Validation (Optional depending on how strict you want to be)
        // For AbacatePay, we usually check the signature with HMAC SHA256
        /*
        if (secret && signature) {
            const hmac = crypto.createHmac('sha256', secret);
            const digest = hmac.update(JSON.stringify(req.body)).digest('hex');
            if (digest !== signature) {
               return res.status(400).json({ error: 'Invalid signature' });
            }
        }
        */

        const { event, metadata, data } = req.body;

        console.log(`🔔 AbacatePay Webhook: ${event}`);

        if (event === 'billing.paid') {
            const billingData = data;
            const customerId = billingData.customerId;
            const product = billingData.products?.[0]; // Get plan info
            const abacateProductId = product?.externalId;
            
            const monthlyId = process.env.ABACATE_PAY_PRODUCT_ID_MONTHLY;
            const annualId = process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL;

            let planType: 'monthly' | 'annual' = 'monthly';
            if (abacateProductId === annualId) {
                planType = 'annual';
            }

            if (!customerId) return res.sendStatus(200);

            // Find user by abacate_customer_id
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select('id, name')
                .eq('abacate_customer_id', customerId)
                .single();

            if (userError || !userData) {
                console.error('❌ User not found for customerId:', customerId);
                return res.sendStatus(200); // Send 200 to acknowledge anyway
            }

            // Calculate Expiry Date
            const expiryDate = new Date();
            if (planType === 'annual') {
                expiryDate.setFullYear(expiryDate.getFullYear() + 1);
            } else {
                expiryDate.setMonth(expiryDate.getMonth() + 1);
            }

            // Update user to PRO
            const { error: updateError } = await supabase
                .from('users')
                .update({
                    plan_type: planType,
                    subscription_status: 'active',
                    subscription_expiry_date: expiryDate.toISOString(),
                })
                .eq('id', userData.id);

            if (updateError) {
                console.error('❌ Failed to update user plan:', updateError.message);
            } else {
                console.log(`✅ User ${userData.name} upgraded to ${planType}`);
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
