import axios from 'axios';
import 'dotenv/config';

const ABACATE_PAY_API_URL = 'https://api.abacatepay.com/v1';
const API_TOKEN = process.env.ABACATE_PAY_TOKEN;

const abacateApi = axios.create({
    baseURL: ABACATE_PAY_API_URL,
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
                frequency: 'ONE_TIME', // Nodus currently uses one-time checkout for simplicity or "intentions"
                methods: ['PIX'],
                products: [
                    {
                        externalId: options.externalId,
                        name: options.externalId === process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL ? 'Nodus Pro - Anual' : 'Nodus Pro - Mensal',
                        quantity: 1,
                        priceUnit: Number(options.amount)
                    }
                ],
                returnUrl: `${process.env.FRONTEND_URL}/payment/success`,
                completionUrl: `${process.env.FRONTEND_URL}/admin`,
                customerId: options.customerId,
                customer: {
                    name: options.name,
                    email: options.email,
                    taxId: options.taxId?.replace(/\D/g, '') || '00000000000' // Abacate requires taxId, we use placeholder if missing
                }
            };

            const response = await abacateApi.post('/billing/create', payload);
            return response.data.data;
        } catch (error: any) {
            console.error('❌ AbacatePay createBilling error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.message || 'Erro ao criar cobrança no AbacatePay');
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
