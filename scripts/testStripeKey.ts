import Stripe from 'stripe';
import 'dotenv/config';

async function testKey() {
    const key = process.env.STRIPE_SECRET_KEY;

    if (!key) {
        console.error('❌ Erro: STRIPE_SECRET_KEY não encontrada no .env');
        return;
    }

    console.log(`--- Testando Chave Stripe ---`);
    console.log(`Chave: ${key.substring(0, 15)}...${key.substring(key.length - 4)}`);
    console.log(`Tamanho: ${key.length} caracteres`);

    if (key !== key.trim()) {
        console.warn('⚠️ AVISO: A chave contém espaços ou quebras de linha invisíveis nas pontas!');
    }

    const stripe = new Stripe(key.trim());

    try {
        const account = await stripe.accounts.retrieve();
        console.log('✅ Chave Válida!');
        console.log('Conta Stripe:', account.settings?.dashboard.display_name || account.id);
    } catch (error: any) {
        console.error('❌ Erro ao validar chave:', error.message);
        if (error.message.includes('invalid character')) {
            console.error('Dica: Existe um caractere invisível (como um espaço ou enter) na sua chave.');
        }
    }
}

testKey();
