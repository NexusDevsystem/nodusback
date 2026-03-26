import axios from 'axios';
import crypto from 'crypto';
import 'dotenv/config';

const ABACATE_API_URL = 'https://api.abacatepay.com/v1';

const getCleanedKey = (key: string) => {
    let cleaned = (key || '').trim();
    if (cleaned.startsWith('=')) {
        cleaned = cleaned.substring(1).trim();
    }
    return cleaned;
};

const apiToken = getCleanedKey(process.env.ABACATE_PAY_TOKEN || '');

const abacateApi = axios.create({
    baseURL: ABACATE_API_URL,
    headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
        'accept': 'application/json'
    }
});

export interface AbacateCustomer {
    name: string;
    cellphone: string;
    email: string;
    taxId: string; // CPF or CNPJ
}

export interface AbacateProduct {
    externalId: string;
    name: string;
    description?: string;
    quantity: number;
    price: number; // in cents
}

export interface AbacateCoupon {
    code: string;
    notes?: string;
    maxRedeems: number; // -1 for unlimited
    discountKind: 'PERCENTAGE' | 'FIXED';
    discount: number;
    metadata?: any;
}

export interface AbacateWithdraw {
    amount: number;
    pixKey: string;
    notes?: string;
}

/**
 * AbacatePay Service
 * Integrates with AbacatePay API v1
 * Documentation: https://docs.abacatepay.com
 */
export const abacateService = {
    // --- CUSTOMERS ---
    
    /**
     * Create or retrieve a customer in AbacatePay
     */
    async createCustomer(data: AbacateCustomer) {
        try {
            const response = await abacateApi.post('/customer/create', data);
            return response.data;
        } catch (error: any) {
            console.error('Error creating AbacatePay customer:', error.response?.data || error.message);
            throw error;
        }
    },

    /**
     * List all customers
     */
    async listCustomers() {
        try {
            const response = await abacateApi.get('/customer/list');
            return response.data;
        } catch (error: any) {
            console.error('Error listing AbacatePay customers:', error.response?.data || error.message);
            throw error;
        }
    },

    // --- COUPONS ---

    /**
     * Create a new coupon
     */
    async createCoupon(data: AbacateCoupon) {
        try {
            const response = await abacateApi.post('/coupon/create', { data });
            return response.data;
        } catch (error: any) {
            console.error('Error creating AbacatePay coupon:', error.response?.data || error.message);
            throw error;
        }
    },

    /**
     * List all coupons
     */
    async listCoupons() {
        try {
            const response = await abacateApi.get('/coupon/list');
            return response.data;
        } catch (error: any) {
            console.error('Error listing AbacatePay coupons:', error.response?.data || error.message);
            throw error;
        }
    },

    // --- BILLING (COBRANÇAS) ---

    /**
     * Create a billing (checkout session)
     */
    async createBilling(params: {
        frequency: 'ONE_TIME' | 'MULTIPLE_PAYMENTS';
        methods: ('PIX' | 'CARD')[];
        products: AbacateProduct[];
        returnUrl: string;
        completionUrl: string;
        customerId?: string;
        customer?: AbacateCustomer;
        externalId?: string; // used for internal tracking in webhooks
    }) {
        try {
            const response = await abacateApi.post('/billing/create', params);
            return response.data; // contains { data: { url, id, ... } }
        } catch (error: any) {
            console.error('Error creating AbacatePay billing:', error.response?.data || error.message);
            throw error;
        }
    },

    /**
     * Get details of a specific billing
     */
    async getBilling(id: string) {
        try {
            const response = await abacateApi.get(`/billing/get?id=${id}`);
            return response.data;
        } catch (error: any) {
            console.error('Error getting AbacatePay billing:', error.response?.data || error.message);
            throw error;
        }
    },

    /**
     * List all billings
     */
    async listBillings() {
        try {
            const response = await abacateApi.get('/billing/list');
            return response.data;
        } catch (error: any) {
            console.error('Error listing AbacatePay billings:', error.response?.data || error.message);
            throw error;
        }
    },

    // --- PIX QRCODE ---

    /**
     * Create a one-off Pix QRCode
     */
    async createPixQrCode(params: {
        amount: number;
        expiresIn?: number;
        description?: string;
        customer?: AbacateCustomer;
        metadata?: any;
    }) {
        try {
            const response = await abacateApi.post('/pixQrCode/create', {
                ...params,
                expiresIn: params.expiresIn || 3600 // 1 hour default
            });
            return response.data;
        } catch (error: any) {
            console.error('Error creating AbacatePay Pix QrCode:', error.response?.data || error.message);
            throw error;
        }
    },

    /**
     * Check status of a Pix QRCode
     */
    async checkPixStatus(id: string) {
        try {
            const response = await abacateApi.get(`/pixQrCode/check?id=${id}`);
            return response.data;
        } catch (error: any) {
            console.error('Error checking AbacatePay Pix status:', error.response?.data || error.message);
            throw error;
        }
    },

    /**
     * Simulate Pix Payment (Dev Mode Only)
     */
    async simulatePixPayment(id: string, metadata: any = {}) {
        try {
            const response = await abacateApi.post(`/pixQrCode/simulate-payment?id=${id}`, { metadata });
            return response.data;
        } catch (error: any) {
            console.error('Error simulating AbacatePay Pix payment:', error.response?.data || error.message);
            throw error;
        }
    },

    // --- WITHDRAW (SAQUES) ---

    /**
     * Create a withdrawal request
     */
    async createWithdraw(data: AbacateWithdraw) {
        try {
            const response = await abacateApi.post('/withdraw/create', data);
            return response.data;
        } catch (error: any) {
            console.error('Error creating AbacatePay withdrawal:', error.response?.data || error.message);
            throw error;
        }
    },

    /**
     * Get details of a withdrawal
     */
    async getWithdraw(id: string) {
        try {
            const response = await abacateApi.get(`/withdraw/get?id=${id}`);
            return response.data;
        } catch (error: any) {
            console.error('Error getting AbacatePay withdrawal:', error.response?.data || error.message);
            throw error;
        }
    },

    /**
     * List all withdrawal requests
     */
    async listWithdraws() {
        try {
            const response = await abacateApi.get('/withdraw/list');
            return response.data;
        } catch (error: any) {
            console.error('Error listing AbacatePay withdrawals:', error.response?.data || error.message);
            throw error;
        }
    },

    // --- STORE ---

    /**
     * Get store details
     */
    async getStore() {
        try {
            const response = await abacateApi.get('/store/get');
            return response.data;
        } catch (error: any) {
            console.error('Error getting AbacatePay store details:', error.response?.data || error.message);
            throw error;
        }
    },

    // --- WEBHOOK VALIDATION ---

    /**
     * Verify Webhook Signature using HMAC-SHA256
     * This ensures the payload has not been tampered with and comes from AbacatePay.
     */
    verifyWebhook(payload: any, signature: string) {
        const secret = process.env.ABACATE_PAY_WEBHOOK_SECRET;
        
        if (!secret) {
            console.warn('[AbacatePay] ABACATE_PAY_WEBHOOK_SECRET not set. Skipping cryptographic validation.');
            return !!signature; // Fallback to presence check if secret is missing
        }

        if (!signature) {
            console.error('[AbacatePay] Webhook received without signature header.');
            return false;
        }

        try {
            const hmac = crypto.createHmac('sha256', secret);
            const bodyString = typeof payload === 'string' ? payload : JSON.stringify(payload);
            const expectedSignature = hmac.update(bodyString).digest('hex');

            const isValid = crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature)
            );

            if (!isValid) console.error('[AbacatePay] ⚠️ Invalid Webhook Signature detected!');
            return isValid;
        } catch (error) {
            console.error('[AbacatePay] Error while verifying webhook signature:', error);
            return false;
        }
    }
};
