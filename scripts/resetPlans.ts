import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function resetPlans() {
    console.log('--- Resetando Planos para FREE ---');
    const { data, error } = await supabase
        .from('users')
        .update({ plan_type: 'free', subscription_status: 'inactive' })
        .not('id', 'is', null);

    if (error) {
        console.error('Erro ao resetar planos:', error);
    } else {
        console.log('Todos os planos foram resetados para FREE com sucesso.');
    }
}

resetPlans();
