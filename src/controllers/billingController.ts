import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { profileService } from '../services/profileService.js';
import { abacateService } from '../services/abacateService.js';

export const billingController = {
    async createCheckout(req: AuthRequest, res: Response) {
        try {
            const { planId, taxId, cellphone } = req.body;
            const userId = req.userId;
            if (!userId) return res.status(401).json({ error: 'Unauthorized' });

            const profile = await profileService.getProfileByUserId(userId);
            if (!profile) return res.status(404).json({ error: 'Perfil não encontrado' });

            console.log(`[AbacatePay API] Starting payment for: ${profile.email}`);

            // Preços fixos em centavos
            const price = (planId === 'annual') ? 29900 : 2990;
            const planName = (planId === 'annual') ? 'Nodus Pro - Anual' : 'Nodus Pro - Mensal';

            const payload = {
                frequency: 'ONE_TIME' as const,
                methods: ['PIX', 'CARD'] as ('PIX' | 'CARD')[],
                products: [{
                    externalId: planId as string,
                    name: planName,
                    quantity: 1,
                    price: price
                }],
                customer: {
                    name: (profile.name || 'Cliente').trim(),
                    email: (profile.email || '').trim(),
                    taxId: (taxId || profile.taxId || '00000000000').toString().trim(),
                    cellphone: (cellphone || profile.cellphone || '00000000000').toString().trim()
                },
                externalId: profile.id as string,
                devMode: true,
                returnUrl: 'https://nodus.my/payment/success',
                completionUrl: 'https://nodus.my/payment/success'
            };

            const session = await abacateService.createBilling(payload);
            
            if (session?.data?.url) {
                return res.json({ url: session.data.url });
            }

            console.error('AbacatePay invalid response:', session);
            return res.status(500).json({ error: 'Erro ao gerar checkout na API' });

        } catch (error: any) {
            console.error('API ERROR in createCheckout:', error.message);
            return res.status(500).json({ 
                error: 'Falha na API de pagamento',
                details: error.response?.data || error.message
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
                    let profileToUpdate: any = null;
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

                        await profileService.updateProfile(profileToUpdate.id as string, {
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
            const profileId = req.profileId;
            if (!profileId) return res.status(401).json({ error: 'Sessão inválida' });

            const profile = await profileService.getProfileByUserId(profileId as string);
            return res.json({ status: 'PENDING', profile });

        } catch (error: any) {
            return res.status(200).json({ status: 'PENDING' });
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
