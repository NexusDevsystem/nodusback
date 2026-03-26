import axios from 'axios';
import 'dotenv/config';

const ABACATE_PAY_API_URL = 'https://api.abacatepay.com/v1';
const API_TOKEN = process.env.ABACATE_PAY_TOKEN;

const abacateApi = axios.create({
    baseURL: ABACATE_PAY_API_URL,
    timeout: 15000, // 15 seconds timeout
    headers: {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }
});

export interface CreateBillingOptions {
    customerId: string;
    email: string;
    name: string;
    taxId?: string;
    cellphone?: string;
    amount: number; // in cents
    externalId: string; // The specific plan ID (monthly/annual)
    userId: string; // Internal User ID
}

export class AbacateService {
    /**
     * Creates a new billing (checkout session) on AbacatePay
     */
    static async createBilling(options: CreateBillingOptions) {
        try {
            const payload = {
                frequency: 'ONE_TIME',
                methods: ['PIX'],
                amount: Math.round(Number(options.amount)), // Top level amount in cents
                externalId: options.externalId, // Pass at top level for v1 webhook support
                products: [
                    {
                        externalId: options.externalId,
                        name: options.externalId === process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL ? 'Nodus Pro - Anual' : 'Nodus Pro - Mensal',
                        quantity: 1,
                        price: Math.round(Number(options.amount)) // Correct field name is 'price'
                    }
                ],
                returnUrl: `${process.env.FRONTEND_URL}/payment/success`,
                completionUrl: `${process.env.FRONTEND_URL}/admin`,
                customerId: options.customerId || undefined,
                customer: !options.customerId ? {
                    name: options.name,
                    email: options.email,
                    taxId: options.taxId?.replace(/\D/g, ''), // Send whatever is provided, or nothing
                    cellphone: options.cellphone || '00000000000'
                } : undefined
            };

            console.log('📦 Sending payload to AbacatePay:', JSON.stringify(payload, null, 2));

            const response = await abacateApi.post('/billing/create', payload);
            return response.data.data;
        } catch (error: any) {
            console.error('❌ AbacatePay createBilling error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.error || 'Erro ao criar cobrança no AbacatePay');
        }
    }

    /**
     * Lists billings for debugging or reconciliation
     */
    static async listBillings() {
        try {
            const response = await abacateApi.get('/billing/list');
            return response.data.data;
        } catch (error: any) {
            console.error('❌ AbacatePay listBillings error:', error.response?.data || error.message);
            throw new Error('Erro ao listar cobranças');
        }
    }
}
