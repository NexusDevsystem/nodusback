import axios from 'axios';
import crypto from 'crypto';
import 'dotenv/config';

/**
 * Nodus Webhook Testing Tool (Safe & Secure)
 * This script simulates an AbacatePay 'billing.paid' event.
 */

// Configuration - Sync with your .env
const SERVER_URL = process.env.NODE_ENV === 'production' 
    ? 'https://nodusback-production.up.railway.app' 
    : 'http://localhost:3001';

const WEBHOOK_SECRET = process.env.ABACATE_PAY_WEBHOOK_SECRET || 'nodus_hmac_secret_key_safe';
const PROFILE_ID = 'test-profile-id'; // Change to a real profile.id for testing logic

async function simulatePayment() {
    const payload = {
        event: 'billing.paid',
        devMode: true,
        data: {
            id: 'bill_test_' + Date.now(),
            externalId: PROFILE_ID,
            amount: 2990,
            status: 'PAID',
            products: [
                {
                    externalId: 'prod_HfZuk60kqgMcYtg1wceKgZTr', // Monthly Pro ID
                    name: 'Nodus Pro Monthly TEST',
                    quantity: 1,
                    price: 2990
                }
            ],
            customer: {
                id: 'cust_test_123',
                email: 'test@example.com',
                name: 'Tester Nodus'
            }
        }
    };

    // Calculate HMAC Signature
    const signature = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(JSON.stringify(payload))
        .digest('hex');

    console.log(`🚀 Sending Simulated Payment to ${SERVER_URL}...`);

    try {
        const response = await axios.post(
            `${SERVER_URL}/api/billing/webhook?webhookSecret=${WEBHOOK_SECRET}`,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'abacatepay-signature': signature
                }
            }
        );

        console.log('✅ Response Status:', response.status);
        console.log('✅ Response Body:', response.data);
        
        if (response.status === 200) {
            console.log('\n✨ SUCESSO! O backend aceitou o pagamento simulado e validou ambas as camadas de segurança (Query e HMAC).');
        }
    } catch (error: any) {
        console.error('❌ ERRO NO TESTE:', error.response?.data || error.message);
        if (error.response?.status === 401) {
            console.log('💡 DICA: Verifique se o ABACATE_PAY_WEBHOOK_SECRET no .env do servidor é o mesmo deste script.');
        }
    }
}

simulatePayment();
