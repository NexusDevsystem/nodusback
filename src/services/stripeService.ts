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

// Determine Environment logic
const isTestMode = process.env.STRIPE_ENV === 'test';

const getEnvKey = (keyName: string) => {
    // Priority: NAME_TEST or NAME_LIVE or NAME
    const testKey = process.env[`${keyName}_TEST`];
    const liveKey = process.env[`${keyName}_LIVE`];
    const defaultKey = process.env[keyName];

    if (isTestMode) return testKey || defaultKey;
    return liveKey || defaultKey;
};

const secretKey = getEnvKey('STRIPE_SECRET_KEY');
const stripeKey = getCleanedKey(secretKey || '');
let stripe: Stripe;

try {
    if (!stripeKey) {
        throw new Error('❌ STRIPE_SECRET_KEY faltando no .env');
    }
    stripe = new Stripe(stripeKey, {
        apiVersion: '2023-10-16' as any
    });
    console.log(`💳 Stripe initialized in ${isTestMode ? 'TEST' : 'PRODUCTION'} mode`);
} catch (err: any) {
    console.error(`❌ Erro crítico: Stripe não pôde ser inicializado:`, err.message);
    // Allow the process to continue so other parts of the app can work, 
    // but stripe will be undefined and throw on usage (which is safer than dummy keys)
}

export const stripeService = {
    async createCheckoutSession(params: {
        userId: string;
        email: string;
        planId: 'monthly' | 'annual';
        successUrl: string;
        cancelUrl: string;
    }) {
        // Check for custom URL override in .env
        const urlKey = params.planId === 'monthly' ? 'STRIPE_MONTHLY_URL' : 'STRIPE_ANNUAL_URL';
        const customUrl = getEnvKey(urlKey);

        if (customUrl) {
            // Append client_reference_id to the payment link so our webhook knows who paid
            const separator = customUrl.includes('?') ? '&' : '?';
            const finalUrl = `${customUrl}${separator}client_reference_id=${params.userId}`;
            return { url: finalUrl };
        }

        const monthlyPriceId = getEnvKey('STRIPE_MONTHLY_PRICE_ID');
        const annualPriceId = getEnvKey('STRIPE_ANNUAL_PRICE_ID');

        const priceId = params.planId === 'monthly' ? monthlyPriceId : annualPriceId;

        if (!priceId) {
            throw new Error(`Price ID not configured for ${params.planId} in ${isTestMode ? 'TEST' : 'PRODUCTION'} mode.`);
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
        const secret = getEnvKey('STRIPE_WEBHOOK_SECRET');
        return getCleanedKey(secret || '');
    },

    getEnvKey(key: string) {
        return getEnvKey(key);
    }
};
