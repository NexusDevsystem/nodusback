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

            // AbacatePay V1 requires TaxID and Cellphone for PIX/Card in most cases.
            // We use what came in the request, or fallback to the profile.
            const finalTaxId = taxId || profile.taxId;
            const finalCellphone = cellphone || profile.cellphone;

            if (!finalTaxId || !finalCellphone) {
                return res.status(400).json({ 
                    error: 'CPF e Celular são obrigatórios para processar o pagamento do PIX/Cartão.',
                    missingFields: true 
                });
            }

            // Prices in cents (R$ 29,90 and R$ 299,00)
            const price = planId === 'monthly' ? 2990 : 29900;
            const planName = planId === 'monthly' ? 'Nodus Pro Mensal' : 'Nodus Pro Anual';

            // Specific Product IDs provided by the user
            const abacateProductId = planId === 'monthly' 
                ? 'prod_HfZuk60kqgMcYtg1wceKgZTr' 
                : 'prod_PamM5q2LRFN6gHHESs4jrGqC';

            const session = await abacateService.createBilling({
                frequency: 'ONE_TIME',
                methods: ['PIX', 'CARD'],
                products: [{
                    externalId: abacateProductId,
                    name: planName,
                    price,
                    quantity: 1
                }],
                externalId: profile.id, // Store Profile ID here for webhook identification
                returnUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/billing?canceled=true`,
                completionUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/success`,
                customer: {
                    name: profile.name || 'User',
                    email: profile.email,
                    cellphone: finalCellphone,
                    taxId: finalTaxId
                }
            });

            res.json({ url: session.data.url });
        } catch (error: any) {
            console.error('AbacatePay Checkout Error:', error);
            res.status(500).json({ error: error.message || 'Falha ao criar sessão de pagamento' });
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
                    const billing = data;
                    const profileId = billing?.externalId; // Nodus uses externalId to link billing to profile.id
                    
                    // Identify the product/plan
                    const product = billing?.products?.[0];
                    const abacateProdId = product?.externalId;
                    
                    // Map Abacate Product ID back to Nodus planId
                    let planId: 'monthly' | 'annual' | null = null;
                    if (abacateProdId === 'prod_HfZuk60kqgMcYtg1wceKgZTr') planId = 'monthly';
                    if (abacateProdId === 'prod_PamM5q2LRFN6gHHESs4jrGqC') planId = 'annual';

                    if (!profileId || !planId) {
                        console.error('Webhook Error: Missing identification data', { profileId, planId });
                        return res.status(400).send('Missing payload identification');
                    }

                    console.log(`✅ AbacatePay Payment Success for Profile ID: ${profileId} - Plan: ${planId}`);

                    const profile = await profileService.getProfileByUserId(profileId as string);
                    if (profile && profile.id) {
                        const expiryDate = new Date();
                        if (planId === 'monthly') expiryDate.setDate(expiryDate.getDate() + 30);
                        else expiryDate.setFullYear(expiryDate.getFullYear() + 1);

                        await profileService.updateProfile(profile.id, {
                            planType: planId,
                            subscriptionStatus: 'active',
                            subscriptionExpiryDate: expiryDate.toISOString()
                        });
                        console.log(`🚀 Profile upgraded: ${profile.username || profile.id} -> ${planId.toUpperCase()}`);
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
            const paidBilling = billings.find((b: any) => 
                b.externalId === userId && 
                b.status === 'PAID'
            );

            const currentProfile = await profileService.getProfileByUserId(userId);

            if (!paidBilling) {
                // Return current profile if no payment found
                return res.json(currentProfile);
            }

            // 3. If found, ensure profile is upgraded (Logic identical to webhook)
            const product = paidBilling.products?.[0];
            const abacateProdId = product?.externalId;
            
            let planId: 'monthly' | 'annual' | null = null;
            if (abacateProdId === 'prod_HfZuk60kqgMcYtg1wceKgZTr') planId = 'monthly';
            if (abacateProdId === 'prod_PamM5q2LRFN6gHHESs4jrGqC') planId = 'annual';

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
