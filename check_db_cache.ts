
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
    console.log('--- USER INTEGRATIONS CACHE ---');
    const { data: users, error } = await supabase
        .from('users')
        .select('id, integrations')
        .contains('integrations', '[{"provider": "youtube"}]')
        .limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (users && users.length > 0) {
        console.log('User ID:', users[0].id);
        console.log('Integrations in Users Column:');
        console.log(JSON.stringify(users[0].integrations, null, 2));
    } else {
        console.log('No users with cached integrations found.');
    }
}

check();
