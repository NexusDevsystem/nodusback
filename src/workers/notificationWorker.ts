import { supabase } from '../config/supabaseClient.js';
import { sendIncompleteLinkEmail } from '../services/emailService.js';
import { isLinkIncomplete } from '../utils/linkValidation.js';

/**
 * Capitalizes a string
 */
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Logic to check all users for incomplete links and notify them if needed
 * Cooldown: 4 hours (as requested)
 */
export const checkAndNotifyIncompleteLinks = async () => {
    try {
        console.log('🤖 [Worker] Checking for incomplete links...');

        // 1. Fetch users who haven't been notified in the last 4 hours (or ever)
        const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
        
        const { data: users, error: userError } = await supabase
            .from('users')
            .select('id, email, name, last_incomplete_notification_at');

        if (userError) throw userError;
        if (!users || users.length === 0) {
            console.log('🤖 [Worker] No users need notification check right now (cooldown active for all).');
            return;
        }

        console.log(`🤖 [Worker] Checking links for ${users.length} candidate users...`);

        for (const user of users) {
            const now = new Date();
            const lastSent = user.last_incomplete_notification_at ? new Date(user.last_incomplete_notification_at) : null;
            const hoursPassed = lastSent ? (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60) : 999;
            const hoursRemaining = lastSent ? Math.max(0, 4 - hoursPassed) : 0;

            // 2. Fetch links for this user
            const { data: links, error: linkError } = await supabase
                .from('links')
                .select('*')
                .eq('user_id', user.id)
                .eq('is_archived', false);

            if (linkError) {
                console.error(`❌ [Worker] Error fetching links for ${user.email}:`, linkError);
                continue;
            }

            // 3. Filter incomplete links (ignoring collections)
            const incompleteLinks = (links || []).filter(l => 
                l.type !== 'collection' && isLinkIncomplete(l.url || '', l.platform)
            );

            if (incompleteLinks.length > 0) {
                if (hoursRemaining > 0) {
                    console.log(`⏳ [Worker] ${user.email}: Link incompleto detectado. Próximo aviso em ${hoursRemaining.toFixed(1)}h`);
                } else {
                    const platformNames = Array.from(new Set(
                        incompleteLinks.map(l => l.platform ? capitalize(l.platform) : (l.title || 'Link Sem Nome'))
                    )).join(', ');

                    console.log(`📧 [Worker] ${user.email}: 4h passadas. Enviando aviso para: ${platformNames}`);

                    // 4. Send the email
                    const success = await sendIncompleteLinkEmail(user.email, user.name || 'Usuário Nodus', platformNames);

                    if (success) {
                        // 5. Update timestamp to start the 4h count again
                        await supabase
                            .from('users')
                            .update({ last_incomplete_notification_at: new Date().toISOString() })
                            .eq('id', user.id);
                    }
                }
            }
        }
        
        console.log('🤖 [Worker] Finished check cycle.');
    } catch (err) {
        console.error('❌ [Worker] Critical error:', err);
    }
};

/**
 * Starts the worker interval (runs every 30 minutes)
 */
const startNotificationWorker = () => {
    // Run once on start
    checkAndNotifyIncompleteLinks();

    // Run every 30 minutes
    const INTERVAL_MS = 30 * 60 * 1000;
    setInterval(checkAndNotifyIncompleteLinks, INTERVAL_MS);
    
    console.log('🚀 [Worker] Notification Worker started (Interval: 30m)');
};

export default startNotificationWorker;
