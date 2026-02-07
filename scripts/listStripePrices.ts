import Stripe from 'stripe';
import 'dotenv/config';

async function listPrices() {
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey || secretKey.startsWith('sk_test_...')) {
        console.error('❌ Erro: STRIPE_SECRET_KEY não configurada no .env');
        return;
    }

    const stripe = new Stripe(secretKey);

    try {
        console.log('--- Listando Produtos e Preços do Stripe ---\n');

        const prices = await stripe.prices.list({
            expand: ['data.product'],
            active: true
        });

        if (prices.data.length === 0) {
            console.log('Nenhum preço ativo encontrado.');
            return;
        }

        prices.data.forEach(price => {
            const product = price.product as Stripe.Product;
            console.log(`Produto: ${product.name}`);
            console.log(`ID do Preço: ${price.id}`);
            console.log(`Valor: ${(price.unit_amount || 0) / 100} ${price.currency.toUpperCase()}`);
            console.log(`Frequência: ${price.type === 'recurring' ? price.recurring?.interval : 'Uma vez'}`);
            console.log('-------------------------------------------');
        });

    } catch (error: any) {
        console.error('❌ Erro ao listar preços:', error.message);
    }
}

listPrices();
