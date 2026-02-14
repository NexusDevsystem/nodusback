import Stripe from 'stripe';
import 'dotenv/config';

const getCleanedKey = (key: string) => {
    let cleaned = (key || '').trim();
    // Remove accidental '=' prefix often caused by copy-pasting from .env files
    if (cleaned.startsWith('=')) {
        cleaned = cleaned.substring(1).trim();
    }
    // Remove accidental variable name prefix if present
    if (cleaned.startsWith('STRIPE_SECRET_KEY=')) {
        cleaned = cleaned.replace('STRIPE_SECRET_KEY=', '').trim();
    }
    return cleaned;
};

// Determine Environment - Locked to LIVE
const secretKey = process.env.STRIPE_SECRET_KEY_LIVE || process.env.STRIPE_SECRET_KEY;

const stripeKey = getCleanedKey(secretKey || '');
const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16' as any
});

console.log(`💳 Stripe initialized in PRODUCTION mode`);

export const stripeService = {
    async createCheckoutSession(params: {
        userId: string;
        email: string;
        planId: 'monthly' | 'annual';
        successUrl: string;
        cancelUrl: string;
    }) {
        const monthlyPriceId = process.env.STRIPE_MONTHLY_PRICE_ID_LIVE || process.env.STRIPE_MONTHLY_PRICE_ID;
        const annualPriceId = process.env.STRIPE_ANNUAL_PRICE_ID_LIVE || process.env.STRIPE_ANNUAL_PRICE_ID;

        const priceId = params.planId === 'monthly' ? monthlyPriceId : annualPriceId;

        if (!priceId) {
            throw new Error(`Price ID not configured for ${params.planId} in PRODUCTION mode.`);
        }

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
    },

    async createPortalSession(customerId: string, returnUrl: string) {
        return stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl,
        });
    },

    async listInvoices(customerId: string) {
        return stripe.invoices.list({
            customer: customerId,
            limit: 12
        });
    },

    async findActiveSubscriptionByEmail(email: string) {
        // 1. Find customers with this email
        const customers = await stripe.customers.list({ email, limit: 1 });
        if (customers.data.length === 0) return null;

        const customer = customers.data[0];

        // 2. Find active subscriptions for this customer
        const subscriptions = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'active',
            limit: 1,
            expand: ['data.default_payment_method']
        });

        if (subscriptions.data.length > 0) {
            const sub = subscriptions.data[0] as any;
            return {
                subscriptionId: sub.id,
                customerId: customer.id,
                status: sub.status,
                planId: sub.items.data[0].price.id,
                expiryDate: new Date(sub.current_period_end * 1000).toISOString()
            };
        }

        // 3. Fallback: Check trialing subscriptions
        const trialing = await stripe.subscriptions.list({
            customer: customer.id,
            status: 'trialing',
            limit: 1
        });

        if (trialing.data.length > 0) {
            const sub = trialing.data[0] as any;
            return {
                subscriptionId: sub.id,
                customerId: customer.id,
                status: sub.status,
                planId: sub.items.data[0].price.id,
                expiryDate: new Date(sub.current_period_end * 1000).toISOString()
            };
        }

        return null;
    },

    getWebhookSecret() {
        const secret = process.env.STRIPE_WEBHOOK_SECRET_LIVE || process.env.STRIPE_WEBHOOK_SECRET;
        return getCleanedKey(secret || '');
    }
};
