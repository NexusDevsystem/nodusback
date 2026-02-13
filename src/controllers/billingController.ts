import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { profileService } from '../services/profileService.js';
import { stripeService } from '../services/stripeService.js';

export const billingController = {
    async createCheckout(req: AuthRequest, res: Response) {
        try {
            const { planId } = req.body;
            const userId = req.userId;

            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            if (!planId || (planId !== 'monthly' && planId !== 'annual')) {
                return res.status(400).json({ error: 'Plano inválido' });
            }

            const profile = await profileService.getProfileByUserId(userId);
            if (!profile) {
                return res.status(404).json({ error: 'Perfil não encontrado' });
            }

            const session = await stripeService.createCheckoutSession({
                userId,
                email: profile.email,
                planId,
                successUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
                cancelUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/billing?canceled=true`
            });

            res.json({ url: session.url });
        } catch (error: any) {
            console.error('Stripe Checkout Error:', error);
            res.status(500).json({ error: error.message || 'Falha ao criar sessão de pagamento' });
        }
    },

    async handleWebhook(req: any, res: Response) {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = stripeService.getWebhookSecret();

        console.log('--- STRIPE WEBHOOK RECEIVED ---');
        console.log('Signature:', sig ? 'Present' : 'Missing');
        console.log('Secret Configured:', webhookSecret ? 'Yes' : 'No');
        console.log('Event Version:', req.body?.api_version || 'Unknown');

        let event;

        try {
            if (!req.rawBody) {
                console.error('CRITICAL: Webhook Error: req.rawBody is missing. Stripe signature verification will fail.');
                console.error('Path:', req.originalUrl);
                return res.status(400).send('Webhook Error: Raw body missing');
            }
            // req.rawBody must be provided by express.raw() or similar middleware
            event = await stripeService.constructEvent(req.rawBody, sig as string, webhookSecret || '');
            console.log('✅ Webhook Verified. Event Type:', event.type);
        } catch (err: any) {
            console.error(`❌ Webhook Signature Error: ${err.message}`);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        // Handle the event
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as any;
                let userId = session.metadata?.userId;
                let planId = session.metadata?.planId;

                console.log('Checkout Session Completed:', session.id);
                console.log('Customer Email:', session.customer_details?.email);
                console.log('Metadata userId:', userId);
                console.log('Metadata planId:', planId);

                // 1. Identification Fallback: Email-based
                if (!userId && session.customer_details?.email) {
                    console.log(`Metadata missing userId. Searching user by email: ${session.customer_details.email}`);
                    const profile = await profileService.getProfileByEmail(session.customer_details.email);
                    if (profile) {
                        userId = profile.id;
                        console.log('Found user via email:', userId);
                    } else {
                        console.log('User not found via email.');
                    }
                }

                // 2. Plan Detection Fallback: Price ID mapping
                if (!planId) {
                    console.log(`Metadata missing planId. Fetching line items...`);
                    try {
                        const fullSession = await stripeService.getSessionWithLineItems(session.id);
                        const priceId = fullSession.line_items?.data?.[0]?.price?.id;
                        console.log(`Detected Price ID: ${priceId}`);

                        const monthlyPriceId = process.env.STRIPE_MONTHLY_PRICE_ID_LIVE || process.env.STRIPE_MONTHLY_PRICE_ID;
                        const annualPriceId = process.env.STRIPE_ANNUAL_PRICE_ID_LIVE || process.env.STRIPE_ANNUAL_PRICE_ID;

                        if (priceId === monthlyPriceId) {
                            planId = 'monthly';
                            console.log('Mapped to Monthly plan');
                        } else if (priceId === annualPriceId) {
                            planId = 'annual';
                            console.log('Mapped to Annual plan');
                        } else {
                            console.log('Price ID did not match any internal plan IDs.');
                            console.log('Internal Monthly ID:', monthlyPriceId);
                            console.log('Internal Annual ID:', annualPriceId);
                        }
                    } catch (e) {
                        console.error('Error fetching session line items:', e);
                    }
                }

                // 3. Identification Fallback: Stripe Customer ID
                if (!userId && session.customer) {
                    console.log(`Metadata missing userId. Searching user by Stripe Customer ID: ${session.customer}`);
                    const profile = await profileService.getProfileByStripeCustomerId(session.customer as string);
                    if (profile) {
                        userId = profile.id;
                        console.log('Found user via Stripe Customer ID:', userId);
                    }
                }

                if (userId && planId) {
                    console.log(`🚀 PROCESSING UPGRADE: User: ${userId}, Plan: ${planId}`);

                    // Calculate expiry date
                    const expiryDate = new Date();
                    if (planId === 'monthly') {
                        expiryDate.setDate(expiryDate.getDate() + 30);
                    } else if (planId === 'annual') {
                        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                    }

                    const updated = await profileService.updateProfile(userId, {
                        planType: planId as any,
                        subscriptionStatus: 'active',
                        stripeCustomerId: session.customer as string,
                        subscriptionExpiryDate: expiryDate.toISOString()
                    });

                    if (updated) {
                        console.log(`SUCCESS: Profile ${userId} upgraded to ${planId}. Expiry: ${expiryDate.toISOString()}`);
                    } else {
                        console.error(`DATABASE ERROR: Failed to update profile ${userId} to ${planId}`);
                    }
                } else {
                    console.warn(`WEBHOOK IGNORED: Could not identify User (${userId}) or Plan (${planId})`);
                }
                break;
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object as any;
                const customerId = subscription.customer;
                console.log(`Webhook: Subscription deleted for customer ${customerId}`);

                const profile = await profileService.getProfileByStripeCustomerId(customerId);
                if (profile && profile.id) {
                    console.log(`Deactivating plan for user ${profile.id}`);
                    await profileService.updateProfile(profile.id, {
                        planType: 'free',
                        subscriptionStatus: 'canceled'
                    });
                }
                break;
            }

            default:
                console.log(`Webhook: Unhandled event type ${event.type}`);
        }

        res.json({ received: true });
    },

    async createPortalSession(req: AuthRequest, res: Response) {
        try {
            const userId = req.userId;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const profile = await profileService.getProfileByUserId(userId);
            if (!profile || !profile.stripeCustomerId) {
                return res.status(400).json({ error: 'Nenhuma assinatura ativa encontrada' });
            }

            const session = await stripeService.createPortalSession(
                profile.stripeCustomerId,
                `${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin`
            );

            res.json({ url: session.url });
        } catch (error: any) {
            console.error('Stripe Portal Error:', error);
            res.status(500).json({ error: error.message || 'Falha ao criar sessão do portal' });
        }
    },

    async getInvoices(req: AuthRequest, res: Response) {
        try {
            const userId = req.userId;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const profile = await profileService.getProfileByUserId(userId);
            if (!profile || !profile.stripeCustomerId) {
                // If no stripe customer, return empty list instead of error for cleaner UI
                return res.json({ data: [] });
            }

            const invoices = await stripeService.listInvoices(profile.stripeCustomerId);
            res.json(invoices);
        } catch (error: any) {
            console.error('Fetch Invoices Error:', error);
            res.status(500).json({ error: error.message || 'Falha ao buscar faturas' });
        }
    },

    async autoReconcile(req: AuthRequest, res: Response) {
        try {
            const userId = req.userId;
            if (!userId) return res.status(401).json({ error: 'Unauthorized' });

            // 1. Get current profile
            const profile = await profileService.getProfileByUserId(userId);
            if (!profile) return res.status(404).json({ error: 'Perfil não encontrado' });

            // 2. If already Pro, just return it
            if (profile.planType && profile.planType !== 'free' && profile.subscriptionStatus === 'active') {
                return res.json(profile);
            }

            console.log(`🔍 Auto-reconciling for user: ${profile.email}`);

            // 3. Search for active subscriptions on Stripe
            const subscription = await stripeService.findActiveSubscriptionByEmail(profile.email);

            if (subscription) {
                console.log(`✅ Found active subscription for ${profile.email} on Stripe: ${subscription.subscriptionId}`);

                // Map Price ID to planId
                const monthlyPriceId = process.env.STRIPE_MONTHLY_PRICE_ID_LIVE || process.env.STRIPE_MONTHLY_PRICE_ID;
                const annualPriceId = process.env.STRIPE_ANNUAL_PRICE_ID_LIVE || process.env.STRIPE_ANNUAL_PRICE_ID;

                let planId: 'monthly' | 'annual' = 'monthly';
                if (subscription.planId === annualPriceId) {
                    planId = 'annual';
                }

                // 4. Update Profile
                const updatedProfile = await profileService.updateProfile(userId, {
                    planType: planId,
                    subscriptionStatus: 'active',
                    stripeCustomerId: subscription.customerId,
                    subscriptionExpiryDate: subscription.expiryDate
                });

                console.log(`🚀 Automated Recovery: Profile ${userId} restored to ${planId}`);
                return res.json(updatedProfile);
            }

            // No subscription found, return existing profile
            res.json(profile);
        } catch (error: any) {
            console.error('Auto Reconcile Error:', error);
            res.status(500).json({ error: error.message || 'Erro durante a reconciliação automática' });
        }
    }
};
