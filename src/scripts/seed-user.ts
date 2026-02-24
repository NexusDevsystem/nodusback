import bcrypt from 'bcrypt';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY!
);

const EMAIL = 'moitaboy@nodus.com';
const PASSWORD = 'moitaboycriador';
const NAME = 'MoitaBoy';

async function seed() {
    console.log('🌱 Seeding test user...');

    // Check if already exists
    const { data: existing } = await supabase
        .from('users')
        .select('id, email')
        .eq('email', EMAIL)
        .maybeSingle();

    if (existing) {
        console.log(`⚠️  User ${EMAIL} already exists (ID: ${existing.id}). Updating password...`);

        const passwordHash = await bcrypt.hash(PASSWORD, 12);
        const { error } = await supabase
            .from('users')
            .update({ password_hash: passwordHash, auth_provider: 'email' })
            .eq('email', EMAIL);

        if (error) {
            console.error('❌ Failed to update password:', error);
            process.exit(1);
        }

        console.log(`✅ Password updated for ${EMAIL}`);
        process.exit(0);
    }

    // Create new user
    const passwordHash = await bcrypt.hash(PASSWORD, 12);

    const { data: newUser, error } = await supabase
        .from('users')
        .insert({
            email: EMAIL,
            name: NAME,
            password_hash: passwordHash,
            auth_provider: 'email',
            onboarding_completed: false,
            theme_id: 'default',
            font_family: 'Inter'
        })
        .select('id, email, name')
        .single();

    if (error) {
        console.error('❌ Failed to create user:', error);
        process.exit(1);
    }

    console.log(`✅ User created successfully!`);
    console.log(`   ID:    ${newUser.id}`);
    console.log(`   Email: ${newUser.email}`);
    console.log(`   Name:  ${newUser.name}`);
    console.log(`   Pass:  ${PASSWORD} (hashed with bcrypt)`);
    process.exit(0);
}

seed().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
