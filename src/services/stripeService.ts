import Stripe from 'stripe';
import 'dotenv/config';

const stripeKey = (process.env.STRIPE_SECRET_KEY || '').trim();
const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16' as any
});

export const stripeService = {
    async createCheckoutSession(params: {
        userId: string;
        email: string;
        planId: 'monthly' | 'annual';
        successUrl: string;
        cancelUrl: string;
    }) {
        const priceId = params.planId === 'monthly'
            ? process.env.STRIPE_MONTHLY_PRICE_ID
            : process.env.STRIPE_ANNUAL_PRICE_ID;

        return stripe.checkout.sessions.create({
            customer_email: params.email,
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: params.successUrl,
            cancel_url: params.cancelUrl,
            metadata: {
                userId: params.userId,
                planId: params.planId
            }
        });
    },

    async constructEvent(payload: string | Buffer, signature: string, secret: string) {
        return stripe.webhooks.constructEvent(payload, signature, secret);
    },

    async getSessionWithLineItems(sessionId: string) {
        return stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['line_items']
        });
    }
};
