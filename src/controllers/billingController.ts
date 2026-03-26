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

            // 2. Save taxId and cellphone to user profile if possible. 
            // NOTE: If columns 'tax_id' or 'cellphone' are missing in Supabase, 
            // we ignore the error but still proceed with the billing creation.
            if (taxId || cellphone) {
                try {
                    const updateData: any = {};
                    if (taxId) updateData.tax_id = taxId;
                    if (cellphone) updateData.cellphone = cellphone;

                    const { error: updateError } = await supabase
                        .from('users')
                        .update(updateData)
                        .eq('id', userId);

                    if (updateError) {
                        console.warn('⚠️ Nota: Colunas de faturamento podem estar faltando no Supabase:', updateError.message);
                    }
                } catch (e) {
                    console.warn('⚠️ Erro ao tentar atualizar perfil do usuário (não crítico):', e);
                }
            }

            const amount = planId === 'monthly' ? 1990 : 19900; // Example: R$ 19,90 or R$ 199,00

            const monthlyId = process.env.ABACATE_PAY_PRODUCT_ID_MONTHLY || 'monthly';
            const annualId = process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL || 'annual';
            const externalId = planId === 'annual' ? annualId : monthlyId;

            // 3. Request Checkout Session from AbacatePay
            const abacateResponse = await AbacateService.createBilling({
                customerId: user.abacate_customer_id || undefined,
                email: user.email,
                name: user.name,
                taxId: taxId || user.tax_id,
                cellphone: cellphone || user.cellphone,
                amount,
                externalId: externalId,
                userId: userId
            });

            console.log('✅ Checkout Criado com Sucesso!');

            // Update user's Abacate customer ID if it's the first time
            if (!user.abacate_customer_id && abacateResponse.customer?.id) {
                await supabase
                    .from('users')
                    .update({ abacate_customer_id: abacateResponse.customer.id })
                    .eq('id', userId);
            }

            res.json({ url: abacateResponse.url });
        } catch (error: any) {
            console.error('❌ Error in checkout:', error.message);
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * AbacatePay calls this when payment status changes.
     */
    static async webhook(req: Request, res: Response) {
        // v1 Security: Validate Secret from URL
        const webhookSecret = req.query.webhookSecret;
        const expectedSecret = process.env.ABACATE_PAY_WEBHOOK_SECRET;

        console.log('🚀 Webhook recebido! Query Secret:', webhookSecret ? 'Sim' : 'Não');

        if (expectedSecret && webhookSecret !== expectedSecret) {
            console.warn('🚨 Webhook: Secret inválido ou faltando na URL');
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // --- FULL PAYLOAD LOGGING ---
        console.log('📦 FULL WEBHOOK PAYLOAD (v1):', JSON.stringify(req.body, null, 2));

        const { event, data } = req.body;

        if (event === 'billing.paid') {
            const billingData = data;
            
            // v1 paths: Try all possible locations for customer ID
            const customerId = 
                billingData.customer?.id || 
                billingData.customerId || 
                billingData.customer_id;
            
            // Try all possible locations for product/plan ID
            const abacateProductId = 
                billingData.products?.[0]?.externalId || 
                billingData.externalId || 
                billingData.metadata?.planId;
            
            console.log(`🔎 Extração Webhook: customerId=${customerId}, planId=${abacateProductId}`);

            const monthlyId = process.env.ABACATE_PAY_PRODUCT_ID_MONTHLY;
            const annualId = process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL;

            let planType: 'monthly' | 'annual' = 'monthly';
            if (abacateProductId === annualId) {
                planType = 'annual';
            }

            if (!customerId) {
                console.error('❌ Webhook error: customerId not found in data. Body logged above.');
                return res.sendStatus(200);
            }

            // Find user by abacate_customer_id
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select('id, name')
                .eq('abacate_customer_id', customerId)
                .single();

            if (userError || !userData) {
                console.error('❌ User not found for customerId:', customerId);
                return res.sendStatus(200); 
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
