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
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        console.log('--- STRIPE WEBHOOK RECEIVED ---');
        console.log('Signature:', sig ? 'Present' : 'Missing');
        console.log('Secret Configured:', webhookSecret && !webhookSecret.startsWith('whsec_...') ? 'Yes' : 'No (Using placeholder?)');

        let event;

        try {
            if (!req.rawBody) {
                console.error('Webhook Error: req.rawBody is missing. Check Express middleware.');
            }
            // req.rawBody must be provided by express.raw() or similar middleware
            event = await stripeService.constructEvent(req.rawBody, sig, webhookSecret || '');
            console.log('Event Type:', event.type);
        } catch (err: any) {
            console.error(`Webhook Signature Error: ${err.message}`);
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

                        if (priceId === process.env.STRIPE_MONTHLY_PRICE_ID) {
                            planId = 'monthly';
                            console.log('Mapped to Monthly plan');
                        } else if (priceId === process.env.STRIPE_ANNUAL_PRICE_ID) {
                            planId = 'annual';
                            console.log('Mapped to Annual plan');
                        } else {
                            console.log('Price ID did not match any internal plan IDs.');
                            console.log('Internal Monthly ID:', process.env.STRIPE_MONTHLY_PRICE_ID);
                            console.log('Internal Annual ID:', process.env.STRIPE_ANNUAL_PRICE_ID);
                        }
                    } catch (e) {
                        console.error('Error fetching session line items:', e);
                    }
                }

                if (userId && planId) {
                    console.log(`Final identified user: ${userId}, plan: ${planId}`);
                    const updated = await profileService.updateProfile(userId, {
                        planType: planId as any,
                        subscriptionStatus: 'active',
                        stripeCustomerId: session.customer as string
                    });
                    if (updated) {
                        console.log('Profile updated successfully.');
                    } else {
                        console.error('Failed to update profile.');
                    }
                } else {
                    console.warn(`Webhook ignored: Could not identify User (${userId}) or Plan (${planId})`);
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
    }
};
