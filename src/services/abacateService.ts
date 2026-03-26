import axios from 'axios';
import 'dotenv/config';

const ABACATE_PAY_API_URL = 'https://api.abacatepay.com/v1';
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
    amount: number;
    externalId: string;
    userId: string;
}

export class AbacateService {
    static async createBilling(options: CreateBillingOptions) {
        try {
            const payload = {
                frequency: 'ONE_TIME',
                methods: ['PIX'],
                amount: Math.round(Number(options.amount)),
                externalId: options.externalId, 
                products: [
                    {
                        externalId: options.externalId,
                        name: options.externalId === process.env.ABACATE_PAY_PRODUCT_ID_ANNUAL ? 'Nodus Pro - Anual' : 'Nodus Pro - Mensal',
                        quantity: 1,
                        price: Math.round(Number(options.amount))
                    }
                ],
                returnUrl: `${process.env.FRONTEND_URL}/payment/success`,
                completionUrl: `${process.env.FRONTEND_URL}/payment/success`,
                customerId: options.customerId || undefined,
                customer: !options.customerId ? {
                    name: options.name,
                    email: options.email,
                    taxId: options.taxId?.replace(/\D/g, ''),
                    cellphone: options.cellphone?.replace(/\D/g, '') || '00000000000'
                } : undefined
            };

            console.log('[ABACATE] Sending v1 payload:', JSON.stringify(payload, null, 2));

            const response = await abacateApi.post('/billing/create', payload);
            console.log('[ABACATE] Response status:', response.status);
            
            return response.data.data;
        } catch (error: any) {
            console.error('[ABACATE] createBilling error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.error || 'Erro ao criar cobranca no AbacatePay v1');
        }
    }

    static async listBillings() {
        try {
            const response = await abacateApi.get('/billing/list');
            return response.data.data;
        } catch (error: any) {
            console.error('[ABACATE] listBillings error:', error.response?.data || error.message);
            throw new Error('Erro ao listar cobrancas');
        }
    }
}
