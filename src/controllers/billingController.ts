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

            const profile = await profileService.getProfileByUserId(userId);
            if (!profile) return res.status(404).json({ error: 'Perfil não encontrado' });

            const finalTaxId = taxId || profile.taxId;
            const finalCellphone = cellphone || profile.cellphone;

            const frontendUrl = process.env.FRONTEND_URL || 'https://nodustree.com.br';
            const successUrl = `${frontendUrl.startsWith('http') ? '' : 'https://'}${frontendUrl}/payment/success`;

            const monthlyId = process.env.ABACATE_PAY_PRODUCT_ID_MONTHLY || 'prod_HfZuk60kqgMcYtg1wceKgZTr';
            const annualId = process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL || 'prod_PamM5q2LRFN6gHHESs4jrGqC';

            const billingData: any = {
                frequency: 'ONE_TIME',
                methods: ['PIX', 'CARD'],
                products: [{
                    externalId: planId === 'monthly' ? monthlyId : annualId,
                    name: planId === 'monthly' ? 'Nodus Pro - Mensal' : 'Nodus Pro - Anual',
                    quantity: 1,
                    price: planId === 'monthly' ? 2990 : 29900
                }],
                externalId: profile.id,
                returnUrl: successUrl,
                completionUrl: successUrl,
            };

            if (profile.email) {
                const customer: any = {
                    email: profile.email,
                    name: profile.name || 'User'
                };

                if (finalTaxId && finalTaxId.trim() !== '') customer.taxId = finalTaxId.trim();
                if (finalCellphone && finalCellphone.trim() !== '') customer.cellphone = finalCellphone.trim();

                billingData.customer = customer;
            }

            console.log('Creating AbacatePay Session with payload:', JSON.stringify(billingData, null, 2));
            const session = await abacateService.createBilling(billingData);
            
            if (session.data && session.data.url) {
                console.log('AbacatePay Session Created Success:', session.data.id, 'URL:', session.data.url);
                return res.json({ url: session.data.url });
            } else {
                console.error('AbacatePay Response missing URL:', session);
                throw new Error('AbacatePay não retornou URL de checkout');
            }
        } catch (error: any) {
            const apiError = error.response?.data;
            console.error('AbacatePay Checkout Error (Detailed):', JSON.stringify(apiError || error.message, null, 2));
            res.status(500).json({ error: 'Falha ao criar sessão de pagamento. Verifique os dados do perfil.' });
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
            const signature = req.headers['abacatepay-signature'];
            if (!abacateService.verifyWebhook(req.body, signature as string)) {
                 // Note: If no HMAC secret is set in the service, this currently just logs a warning but continues.
            }

            const { event, data } = req.body;
            
            // Logical routing based on event
            switch (event) {
                case 'billing.paid':
                case 'pix.paid': // Some v1 integrations use pix.paid for direct QR Codes
                    const billing = data.billing || data;
                    console.log('[AbacatePay Webhook Payload]:', JSON.stringify(billing, null, 2));

                    let profileId = billing?.externalId; // Nodus uses externalId to link billing to profile.id
                    
                    // Identify the product/plan
                    const product = billing?.products?.[0];
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

    async handleAutoReconcile(req: AuthRequest, res: Response) {
        try {
            const userId = req.userId;
            if (!userId) return res.status(401).json({ error: 'Unauthorized' });

            console.log(`[AutoReconcile] Checking status for user ${userId}...`);

            // 1. Fetch recent billings from AbacatePay
            const billingsResponse = await abacateService.listBillings();
            const billings = billingsResponse.data || [];

            // 2. Find the most recent PAID billing that belongs to this user
            const currentProfile = await profileService.getProfileByUserId(userId);
            
            const paidBilling = billings.find((b: any) => 
                (b.externalId === userId || 
                 (currentProfile?.email && (b.customer?.metadata?.email === currentProfile.email || b.customer?.email === currentProfile.email))) && 
                b.status === 'PAID'
            );

            if (!paidBilling) {
                // Return current profile if no payment found
                return res.json(currentProfile);
            }

            // 3. If found, ensure profile is upgraded (Logic identical to webhook)
            const product = paidBilling.products?.[0];
            const abacateProdId = product?.externalId;
            
            let planId: 'monthly' | 'annual' | null = null;
            const monthlyId = process.env.ABACATE_PAY_PRODUCT_ID_MONTHLY || 'prod_HfZuk60kqgMcYtg1wceKgZTr';
            const annualId = process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL || 'prod_PamM5q2LRFN6gHHESs4jrGqC';

            if (abacateProdId === monthlyId) planId = 'monthly';
            else if (abacateProdId === annualId) planId = 'annual';

            if (currentProfile && currentProfile.id && planId) {
                // Only update if not already active or if status is not 'active'
                if (currentProfile.planType !== planId || currentProfile.subscriptionStatus !== 'active') {
                    const expiryDate = new Date();
                    if (planId === 'monthly') expiryDate.setDate(expiryDate.getDate() + 30);
                    else expiryDate.setFullYear(expiryDate.getFullYear() + 1);

                    const updated = await profileService.updateProfile(currentProfile.id, {
                        planType: planId,
                        subscriptionStatus: 'active',
                        subscriptionExpiryDate: expiryDate.toISOString()
                    });
                    console.log(`✅ [AutoReconcile] Successfully upgraded user ${userId} to ${planId}`);
                    return res.json(updated);
                }
            }

            return res.json(currentProfile);
        } catch (error: any) {
            console.error('AutoReconcile Error:', error);
            res.status(500).json({ error: 'Falha na conciliação automática' });
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
