
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
    const { data: integrations, error } = await supabase
        .from('social_integrations')
        .select('*')
        .eq('provider', 'youtube')
        .limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (integrations && integrations.length > 0) {
        console.log('YouTube Integration Full Object:');
        console.log(JSON.stringify(integrations[0], null, 2));
    } else {
        console.log('No YouTube integrations found.');
    }
}

check();
