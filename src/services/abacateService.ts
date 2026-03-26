import axios from 'axios';
import crypto from 'crypto';
import 'dotenv/config';

const ABACATE_API_URL = 'https://api.abacatepay.com/v1';

const cleanToken = (token: string) => (token || '')
    .trim()
    .replace(/^=/, '')
    .replace(/[\r\n]/gm, '')
    .trim();

const apiToken = cleanToken(process.env.ABACATE_PAY_TOKEN || '');

const getHeaders = () => ({
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Nodus-Backend/1.0.0'
});

const axiosConfig = {
    timeout: 15000, 
};

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
            const response = await axios({
                method: 'post',
                url: `${ABACATE_API_URL}/customer/create`,
                data,
                headers: getHeaders(),
                timeout: 15000
            });
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
            const response = await axios({
                method: 'get',
                url: `${ABACATE_API_URL}/customer/list`,
                headers: getHeaders(),
                timeout: 15000
            });
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
            const response = await axios({
                method: 'post',
                url: `${ABACATE_API_URL}/coupon/create`,
                data: { data },
                headers: getHeaders(),
                timeout: axiosConfig.timeout
            });
            return response.data;
        } catch (error: any) {
            console.error('Error creating AbacatePay coupon:', JSON.stringify(error.response?.data || error.message));
            throw error;
        }
    },

    /**
     * List all coupons
     */
    async listCoupons() {
        try {
            const response = await axios({
                method: 'get',
                url: `${ABACATE_API_URL}/coupon/list`,
                headers: getHeaders(),
                timeout: 15000
            });
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
        externalId?: string;
    }) {
        try {
            const url = `${ABACATE_API_URL}/billing/create`;
            console.log(`[AbacatePay] Requesting: POST ${url}`);
            console.log(`[AbacatePay] Payload: ${JSON.stringify(params, null, 2)}`);

            const response = await axios({
                method: 'post',
                url: url,
                data: params,
                headers: getHeaders(),
                timeout: 20000 
            });

            console.log(`[AbacatePay] Success Response:`, JSON.stringify(response.data, null, 2));
            return response.data;
        } catch (error: any) {
            console.error('[AbacatePay] CRITICAL API ERROR:');
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Data:', JSON.stringify(error.response.data, null, 2));
                throw new Error(error.response.data.message || 'Erro na API do AbacatePay');
            }
            console.error('Message:', error.message);
            throw error;
        }
    },

    /**
     * Get details of a specific billing
     */
    async getBilling(id: string) {
        try {
            const response = await axios({
                method: 'get',
                url: `${ABACATE_API_URL}/billing/get?id=${id}`,
                headers: getHeaders(),
                timeout: 15000
            });
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
            const response = await axios({
                method: 'get',
                url: `${ABACATE_API_URL}/billing/list`,
                headers: getHeaders(),
                timeout: 15000
            });
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
            const response = await axios({
                method: 'post',
                url: `${ABACATE_API_URL}/pixQrCode/create`,
                data: {
                    ...params,
                    expiresIn: params.expiresIn || 3600 // 1 hour default
                },
                headers: getHeaders(),
                timeout: 15000
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
            const response = await axios({
                method: 'get',
                url: `${ABACATE_API_URL}/pixQrCode/check?id=${id}`,
                headers: getHeaders(),
                timeout: 15000
            });
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
            const response = await axios({
                method: 'post',
                url: `${ABACATE_API_URL}/pixQrCode/simulate-payment?id=${id}`,
                data: { metadata },
                headers: getHeaders(),
                timeout: 15000
            });
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
            const response = await axios({
                method: 'post',
                url: `${ABACATE_API_URL}/withdraw/create`,
                data,
                headers: getHeaders(),
                timeout: 15000
            });
            return response.data;
        } catch (error: any) {
            console.error('Error creating AbacatePay withdrawal:', error.response?.data || error.message);
            throw error;
        }
    },
    async getWithdraw(id: string) {
        try {
            const response = await axios({
                method: 'get',
                url: `${ABACATE_API_URL}/withdraw/get?id=${id}`,
                headers: getHeaders(),
                timeout: 15000
            });
            return response.data;
        } catch (error: any) {
            console.error('Error getting AbacatePay withdrawal:', error.response?.data || error.message);
            throw error;
        }
    },
    async listWithdraws() {
        try {
            const response = await axios({
                method: 'get',
                url: `${ABACATE_API_URL}/withdraw/list`,
                headers: getHeaders(),
                timeout: 15000
            });
            return response.data;
        } catch (error: any) {
            console.error('Error listing AbacatePay withdrawals:', error.response?.data || error.message);
            throw error;
        }
    },
    async getStore() {
        try {
            const response = await axios({
                method: 'get',
                url: `${ABACATE_API_URL}/store/get`,
                headers: getHeaders(),
                timeout: 15000
            });
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
