import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { profileService } from '../services/profileService.js';
import { abacateService } from '../services/abacateService.js';

export const billingController = {
    async createCheckout(req: AuthRequest, res: Response) {
        try {
            const { planId, taxId, cellphone } = req.body;
            const userId = req.userId;
            if (!userId) return res.status(401).json({ error: 'Unauthorized' });
            if (!planId || (planId !== 'monthly' && planId !== 'annual')) {
                return res.status(400).json({ error: 'Plano inválido' });
            }

            console.log(`[Checkout] Starting for user: ${userId}, plan: ${planId}`);

            const profile = await profileService.getProfileByUserId(userId);
            if (!profile) {
                return res.status(404).json({ error: 'Perfil não encontrado' });
            }

            const frontendUrl = process.env.FRONTEND_URL || 'https://nodus.my';
            const successUrl = `${frontendUrl.startsWith('http') ? '' : 'https://'}${frontendUrl}/payment/success`;

            const monthlyId = process.env.ABACATE_PAY_PRODUCT_ID_MONTHLY || 'prod_HfZuk60kqgMcYtg1wceKgZTr';
            const annualId = process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL || 'prod_PamM5q2LRFN6gHHESs4jrGqC';

            // Base billing data
            const billingData: any = {
                frequency: 'ONE_TIME',
                methods: ['PIX', 'CARD'],
                products: [{
                    externalId: (planId === 'monthly' ? monthlyId : annualId).toString(),
                    name: planId === 'monthly' ? 'Nodus Pro - Mensal' : 'Nodus Pro - Anual',
                    quantity: 1,
                    price: planId === 'monthly' ? 2990 : 29900
                }],
                externalId: profile.id,
                returnUrl: successUrl || 'https://nodus.my',
                completionUrl: successUrl || 'https://nodus.my',
            };

            // Mandatory customer data for AbacatePay v1 (All 4 fields MUST be strings)
            billingData.customer = {
                name: (profile.name || 'Cliente').trim(),
                email: (profile.email || '').trim(),
                taxId: (taxId || profile.taxId || '').toString().trim(),
                cellphone: (cellphone || profile.cellphone || '').toString().trim()
            };

            console.log('[Checkout] Attaching customer data from DB:', billingData.customer.email);

            console.log('Sending to AbacatePay v1 API...');
            const session = await abacateService.createBilling(billingData);
            
            console.log('--- ABACATEPAY RESPONSE DEBUG ---');
            console.log(JSON.stringify(session, null, 2));
            console.log('---------------------------------');

            if (session && session.data && session.data.url) {
                console.log('Success! Billing URL generated:', session.data.url);
                return res.json({ url: session.data.url });
            } 
            
            console.error('AbacatePay invalid response:', session);
            return res.status(500).json({ error: 'AbacatePay retornou resposta inválida' });

        } catch (error: any) {
            console.error('CRITICAL ERROR in createCheckout:', error.message);
            if (error.response) {
                console.error('AbacatePay Error Response:', JSON.stringify(error.response.data, null, 2));
            }
            return res.status(500).json({ 
                error: 'Erro interno ao processar checkout AbacatePay',
                details: error.message 
            });
        }
    },

    async handleWebhook(req: any, res: Response) {
        try {
            const { webhookSecret } = req.query;
            const expectedSecret = process.env.ABACATE_PAY_WEBHOOK_SECRET;

            console.log('--- ABACATEPAY WEBHOOK RECEIVED ---');

            // Security: Case 1 - Query Secret validation (Recommended for v1 when HMAC is not available)
            if (expectedSecret && webhookSecret !== expectedSecret) {
                console.error('❌ Webhook Error: Invalid webhookSecret token');
                return res.status(401).json({ error: 'Unauthorized: Invalid webhook secret' });
            }

            // Security: Case 2 - HMAC signature (Optional fallback/defense in depth)
            const signature = req.headers['x-webhook-signature'] || req.headers['abacatepay-signature'];
            if (!abacateService.verifyWebhook(req.body, signature as string)) {
                // Note: If no HMAC secret is set in the service, this currently just logs a warning but continues.
            }

            const { event, data } = req.body;
            console.log(`[AbacatePay Webhook] Event received: ${event}`);

            // Logical routing based on event
            switch (event) {
                case 'checkout.completed':
                case 'billing.paid':
                case 'pix.paid': // Some v1 integrations use pix.paid for direct QR Codes
                    const billing = data.billing || data.checkout || data;
                    console.log('[AbacatePay Webhook Payload]:', JSON.stringify(billing, null, 2));

                    let profileId = billing?.externalId; // Nodus uses externalId to link billing to profile.id

                    // Identify the product/plan
                    const products = billing?.products || billing?.items || [];
                    const product = products[0];
                    const abacateProdId = product?.externalId;
                    const amount = billing?.amount || 0;

                    // Map Abacate Product ID back to Nodus planId
                    let planId: 'monthly' | 'annual' | null = null;
                    const monthlyId = process.env.ABACATE_PAY_PRODUCT_ID_MONTHLY || 'prod_HfZuk60kqgMcYtg1wceKgZTr';
                    const annualId = process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL || 'prod_PamM5q2LRFN6gHHESs4jrGqC';

                    if (abacateProdId === monthlyId) planId = 'monthly';
                    else if (abacateProdId === annualId) planId = 'annual';

                    // Robust fallback for manual links: Identify plan by amount
                    if (!planId) {
                        if (amount >= 2900 && amount <= 3100) planId = 'monthly';
                        else if (amount >= 29000 && amount <= 31000) planId = 'annual';
                    }

                    // Robust fallback for manual links: Identify profile by customer email
                    let profileToUpdate = null;
                    if (profileId) {
                        profileToUpdate = await profileService.getProfileByUserId(profileId as string);
                    }

                    const customerEmail = billing?.customer?.metadata?.email || billing?.customer?.email;

                    if (!profileToUpdate && customerEmail) {
                        const emailToSearch = customerEmail.toLowerCase();
                        console.log(`[Webhook Fallback] Searching user by email (case-insensitive): ${emailToSearch}`);

                        profileToUpdate = await profileService.getProfileByEmail(emailToSearch);
                        if (profileToUpdate) profileId = profileToUpdate.id;
                    }

                    if (!profileId || !planId) {
                        console.error('Webhook Error: Missing identification data', { profileId, planId, amount, email: customerEmail });
                        return res.status(400).send('Missing payload identification');
                    }

                    console.log(`✅ AbacatePay Payment Success for Profile: ${profileToUpdate?.username || profileId} - Plan: ${planId}`);

                    if (profileToUpdate && profileToUpdate.id) {
                        const expiryDate = new Date();
                        if (planId === 'monthly') expiryDate.setDate(expiryDate.getDate() + 30);
                        else expiryDate.setFullYear(expiryDate.getFullYear() + 1);

                        await profileService.updateProfile(profileToUpdate.id, {
                            planType: planId,
                            subscriptionStatus: 'active',
                            subscriptionExpiryDate: expiryDate.toISOString()
                        });
                        console.log(`🚀 Profile upgraded (Webhook): ${profileToUpdate.username || profileToUpdate.id} -> ${planId.toUpperCase()}`);
                    }
                    break;

                case 'billing.refunded':
                    // Handle refund: deactivate plan
                    console.log('[AbacatePay] Billing Refunded:', data.id);
                    break;

                case 'billing.failed':
                    console.log('[AbacatePay] Billing Failed:', data.id);
                    break;

                default:
                    console.log(`[AbacatePay] Ignoring unhandled event: ${event}`);
            }

            // Always respond with 200 OK
            res.status(200).json({ received: true });
        } catch (error: any) {
            console.error('Abacate Webhook Error:', error);
            res.status(500).send('Webhook process failed');
        }
    },

    async handleAutoReconcile(req: Request, res: Response) {
        try {
            const profile = (req as any).profile;
            if (!profile) return res.status(401).json({ error: 'Perfil não encontrado' });

            console.log(`[AutoReconcile] Checking status for user ${profile.id}...`);

            // Fetch recent billings from AbacatePay
            const response = await abacateService.listBillings();
            
            if (!response || !response.data) {
                return res.status(200).json({ status: 'PENDING', message: 'Nenhuma cobrança ativa' });
            }

            // Look for PAID billings linked to this profile
            const paidBilling = response.data.find((b: any) => 
                b.externalId === profile.id && b.status === 'PAID'
            );

            if (paidBilling) {
                console.log(`[AutoReconcile] Found PAID billing for user ${profile.id}. Upgrading...`);
                
                // Identify the plan from the product in billing
                const product = paidBilling.products?.[0];
                const abacateProdId = product?.externalId;
                const monthlyId = process.env.ABACATE_PAY_PRODUCT_ID_MONTHLY || 'prod_HfZuk60kqgMcYtg1wceKgZTr';
                const annualId = process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL || 'prod_PamM5q2LRFN6gHHESs4jrGqC';
                
                let planId: 'monthly' | 'annual' = abacateProdId === annualId ? 'annual' : 'monthly';

                const expiryDate = new Date();
                if (planId === 'monthly') expiryDate.setDate(expiryDate.getDate() + 30);
                else expiryDate.setFullYear(expiryDate.getFullYear() + 1);

                await profileService.updateProfile(profile.id, {
                    planType: planId,
                    subscriptionStatus: 'active',
                    subscriptionExpiryDate: expiryDate.toISOString()
                });

                const updated = await profileService.getProfileByUserId(profile.userId);
                return res.json({ status: 'PAID', profile: updated });
            }

            return res.json({ status: 'PENDING' });

        } catch (error: any) {
            console.error('AutoReconcile Error:', error.message);
            return res.status(200).json({ status: 'PENDING', error: error.message });
        }
    },

    async getConfig(req: any, res: Response) {
        try {
            res.json({
                gateway: 'abacatepay',
                env: process.env.NODE_ENV || 'development'
            });
        } catch (error: any) {
            res.status(500).json({ error: 'Erro ao carregar configuração' });
        }
    }
};
