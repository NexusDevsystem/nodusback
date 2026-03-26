import axios from 'axios';
import 'dotenv/config';

const ABACATE_PAY_API_URL = 'https://api.abacatepay.com/v2';
const API_TOKEN = process.env.ABACATE_PAY_TOKEN;

const abacateApi = axios.create({
    baseURL: ABACATE_PAY_API_URL,
    timeout: 30000, 
    headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }
});

export interface CreateBillingOptions {
    customerId?: string;
    email: string;
    name: string;
    taxId?: string;
    cellphone?: string;
    amount: number; // in cents
    externalId: string; // Internal plan ID (monthly/annual)
    userId: string;
}

export class AbacateService {
    /**
     * Finds or creates a product in AbacatePay by externalId.
     * v2 requires product IDs for checkouts.
     */
    static async ensureProduct(externalId: string, name: string, price: number) {
        try {
            // 1. Try to list products and find by externalId
            const listRes = await abacateApi.get('/products/list');
            const existing = listRes.data.data.find((p: any) => p.externalId === externalId);
            
            if (existing) return existing.id;

            // 2. Create if not found
            const createRes = await abacateApi.post('/products/create', {
                externalId,
                name,
                price,
                currency: 'BRL'
            });
            return createRes.data.data.id;
        } catch (error: any) {
            console.error('[ABACATE] ensureProduct error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Creates or updates a customer in AbacatePay v2.
     * Wraps fields inside "data" object.
     */
    static async ensureCustomer(options: { email: string; name: string; taxId?: string; cellphone?: string }) {
        try {
            const payload = {
                data: {
                    email: options.email,
                    name: options.name,
                    taxId: options.taxId?.replace(/\D/g, ''),
                    cellphone: options.cellphone?.replace(/\D/g, '')
                }
            };
            
            const response = await abacateApi.post('/customers/create', payload);
            return response.data.data.id;
        } catch (error: any) {
            console.error('[ABACATE] ensureCustomer error:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Creates a checkout session on AbacatePay v2
     */
    static async createBilling(options: CreateBillingOptions) {
        try {
            const productName = options.externalId === process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL ? 'Nodus Pro - Anual' : 'Nodus Pro - Mensal';
            
            // 1. Ensure Product exists and get its ID
            const productId = await this.ensureProduct(options.externalId, productName, options.amount);

            // 2. Ensure Customer exists if no customerId provided
            let customerId = options.customerId;
            if (!customerId) {
                customerId = await this.ensureCustomer({
                    email: options.email,
                    name: options.name,
                    taxId: options.taxId,
                    cellphone: options.cellphone
                });
            }

            const payload = {
                items: [
                    {
                        id: productId,
                        quantity: 1
                    }
                ],
                customerId: customerId,
                methods: ['PIX'],
                returnUrl: `${process.env.FRONTEND_URL}/payment/success`,
                completionUrl: `${process.env.FRONTEND_URL}/payment/success`,
            };

            console.log('[ABACATE] Creating checkout (v2):', JSON.stringify(payload, null, 2));

            const response = await abacateApi.post('/checkouts/create', payload);
            console.log('[ABACATE] Response status:', response.status);
            
            return {
                id: response.data.data.id,
                url: response.data.data.url,
                customer: { id: customerId }
            };
        } catch (error: any) {
            console.error('[ABACATE] createCheckout error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.error || 'Erro ao criar checkout no AbacatePay v2');
        }
    }

    static async listBillings() {
        try {
            const response = await abacateApi.get('/billing/list');
            return response.data.data;
        } catch (error: any) {
            console.error('[ABACATE] listBillings error:', error.response?.data || error.message);
            throw new Error('Erro ao listar cobranças');
        }
    }
}
