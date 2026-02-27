import { supabase } from '../config/supabaseClient.js';
import { SocialIntegrationDB } from '../models/types.js';

// Environment variables access inside functions to ensure they are loaded after dotenv.config()
const getTwitchConfig = () => ({
    CLIENT_ID: process.env.TWITCH_CLIENT_ID,
    CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
    REDIRECT_URI: process.env.TWITCH_REDIRECT_URI
});

/**
 * Ensures a Twitch social link exists in the user's links list.
 * Creates it if it doesn't exist, updates the URL if it does.
 */
export const ensureTwitchLink = async (userId: string, twitchUsername: string) => {
    try {
        const twitchUrl = `https://twitch.tv/${twitchUsername}`;

        // Check if a Twitch social link already exists
        const { data: existing } = await supabase
            .from('links')
            .select('id')
            .eq('user_id', userId)
            .eq('platform', 'twitch')
            .eq('type', 'social')
            .maybeSingle();

        if (existing) {
            // Update it with the correct URL
            await supabase
                .from('links')
                .update({ url: twitchUrl, title: 'Twitch', is_active: true })
                .eq('id', existing.id);
            console.log(`[TwitchService] Updated Twitch social link for user ${userId}`);
        } else {
            // Get the current highest position to place this at the end
            const { data: lastLink } = await supabase
                .from('links')
                .select('position')
                .eq('user_id', userId)
                .is('parent_id', null)
                .order('position', { ascending: false })
                .limit(1)
                .maybeSingle();

            const position = lastLink ? (lastLink.position ?? 0) + 1 : 0;

            await supabase.from('links').insert({
                user_id: userId,
                title: 'Twitch',
                url: twitchUrl,
                is_active: true,
                is_archived: false,
                type: 'social',
                platform: 'twitch',
                layout: 'social',
                position
            });
            console.log(`[TwitchService] Created Twitch social link for user ${userId}`);
        }

        // Also update the users table integrations cache
        const { data: allIntegrations } = await supabase
            .from('social_integrations')
            .select('provider, profile_data')
            .eq('user_id', userId);

        if (allIntegrations) {
            await supabase
                .from('users')
                .update({ integrations: allIntegrations })
                .eq('id', userId);
        }
    } catch (err) {
        console.error('[TwitchService] ensureTwitchLink error:', err);
    }
};

/**
 * Generates the Twitch Auth URL
 */
export const getAuthUrl = (userId: string, origin?: string) => {
    const state = Buffer.from(JSON.stringify({ userId, origin: origin || 'production' })).toString('base64');

    const { CLIENT_ID, REDIRECT_URI } = getTwitchConfig();

    console.log('[TwitchService] Generating Auth URL with:', {
        clientId: CLIENT_ID ? 'set' : 'MISSING',
        redirectUri: REDIRECT_URI
    });

    const scopes = [
        'user:read:email',
        'moderator:read:followers'
    ].join(' ');

    const baseUrl = 'https://id.twitch.tv/oauth2/authorize';
    const params = new URLSearchParams({
        client_id: CLIENT_ID || '',
        redirect_uri: REDIRECT_URI || '',
        response_type: 'code',
        scope: scopes,
        state: state
    });

    return `${baseUrl}?${params.toString()}`;
};

/**
 * Handles the OAuth callback from Twitch
 */
export const handleCallback = async (code: string, userId: string): Promise<SocialIntegrationDB | null> => {
    try {
        const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = getTwitchConfig();
        console.log(`[TwitchService] Handling callback for user ${userId}...`);

        // 1. Exchange code for tokens
        const tokenParams = new URLSearchParams({
            client_id: CLIENT_ID || '',
            client_secret: CLIENT_SECRET || '',
            code,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI || ''
        });

        const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            body: tokenParams
        });

        const tokenData = await tokenRes.json() as any;
        if (tokenData.error) {
            throw new Error(`Twitch Token Error: ${tokenData.message || tokenData.error}`);
        }

        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token;

        // 2. Get User Profile
        const userRes = await fetch('https://api.twitch.tv/helix/users', {
            headers: {
                'Client-ID': CLIENT_ID || '',
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const userDataRaw = await userRes.json() as any;
        const twitchUser = userDataRaw.data?.[0];

        if (!twitchUser) throw new Error('Could not fetch Twitch user profile');

        // 3. Get Follower Count
        let followerCount = 0;
        try {
            const followersRes = await fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${twitchUser.id}`, {
                headers: {
                    'Client-ID': CLIENT_ID || '',
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            const followersData = await followersRes.json() as any;
            followerCount = followersData.total || 0;
        } catch (err) {
            console.warn('[TwitchService] Failed to fetch followers:', err);
        }

        const profileData = {
            username: twitchUser.login,
            display_name: twitchUser.display_name,
            avatar_url: twitchUser.profile_image_url,
            follower_count: followerCount,
            channel_id: twitchUser.id,
            description: twitchUser.description
        };

        const integrationData: SocialIntegrationDB = {
            user_id: userId,
            provider: 'twitch',
            access_token: accessToken,
            refresh_token: refreshToken,
            profile_data: profileData,
            expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()
        };

        const { data, error } = await supabase
            .from('social_integrations')
            .upsert(integrationData, { onConflict: 'user_id,provider' })
            .select()
            .single();

        if (error) throw error;

        // Create or update the Twitch social link in the user's links
        await ensureTwitchLink(userId, twitchUser.login);

        // Sync extra data (followers, live status)
        syncData(userId).catch(e => console.error('[TwitchService] Background sync error:', e));

        return data;
    } catch (error) {
        console.error('[TwitchService] Auth Error:', error);
        throw error;
    }
};

/**
 * Refreshes the Twitch access token if it's expired
 */
export const refreshTokenIfNeeded = async (userId: string) => {
    const { data: integration, error } = await supabase
        .from('social_integrations')
        .select('*')
        .eq('user_id', userId)
        .eq('provider', 'twitch')
        .single();

    if (error || !integration) return null;

    const expiresAt = integration.expires_at ? new Date(integration.expires_at) : new Date(0);
    const now = new Date();

    // If it expires in less than 5 minutes, refresh
    if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
        console.log(`[TwitchService] Refreshing token for user ${userId}...`);

        const { CLIENT_ID, CLIENT_SECRET } = getTwitchConfig();
        const refreshParams = new URLSearchParams({
            client_id: CLIENT_ID || '',
            client_secret: CLIENT_SECRET || '',
            grant_type: 'refresh_token',
            refresh_token: integration.refresh_token || ''
        });

        const refreshRes = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            body: refreshParams
        });

        const refreshData = await refreshRes.json() as any;
        if (refreshData.error) {
            console.error('[TwitchService] Refresh Error:', refreshData.message);
            return null;
        }

        const { data: updated, error: updateError } = await supabase
            .from('social_integrations')
            .update({
                access_token: refreshData.access_token,
                refresh_token: refreshData.refresh_token || integration.refresh_token,
                expires_at: new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', integration.id)
            .select()
            .single();

        if (updateError) throw updateError;
        return updated;
    }

    return integration;
};

/**
 * Periodic sync for followers and stream status
 */
export const syncData = async (userId: string) => {
    try {
        const integration = await refreshTokenIfNeeded(userId);
        if (!integration) return;

        const { CLIENT_ID } = getTwitchConfig();

        // 1. Refresh followers
        const followersRes = await fetch(`https://api.twitch.tv/helix/channels/followers?broadcaster_id=${integration.profile_data.channel_id}`, {
            headers: {
                'Client-ID': CLIENT_ID || '',
                'Authorization': `Bearer ${integration.access_token}`
            }
        });

        const followersData = await followersRes.json() as any;

        // 2. Refresh stream status (Live?)
        const streamRes = await fetch(`https://api.twitch.tv/helix/streams?user_id=${integration.profile_data.channel_id}`, {
            headers: {
                'Client-ID': CLIENT_ID || '',
                'Authorization': `Bearer ${integration.access_token}`
            }
        });
        const streamData = await streamRes.json() as any;
        const isLive = streamData.data && streamData.data.length > 0;

        const updatedProfileData = {
            ...integration.profile_data,
            follower_count: followersData.total || integration.profile_data.follower_count,
            is_live: isLive,
            current_stream: isLive ? streamData.data[0] : null
        };

        await supabase
            .from('social_integrations')
            .update({
                profile_data: updatedProfileData,
                updated_at: new Date().toISOString()
            })
            .eq('id', integration.id);

        // Update main users table for fast frontend access
        const { data: allIntegrations } = await supabase
            .from('social_integrations')
            .select('provider, profile_data')
            .eq('user_id', userId);

        if (allIntegrations) {
            await supabase
                .from('users')
                .update({ integrations: allIntegrations })
                .eq('id', userId);
        }

    } catch (err) {
        console.error('[TwitchService] Sync error:', err);
    }
};

export const checkAndSync = async (userId: string) => {
    try {
        const { data: integration } = await supabase
            .from('social_integrations')
            .select('id, updated_at')
            .eq('user_id', userId)
            .eq('provider', 'twitch')
            .maybeSingle();

        if (!integration) return;

        const lastSync = integration.updated_at ? new Date(integration.updated_at) : new Date(0);
        const now = new Date();
        const diffMinutes = Math.floor((now.getTime() - lastSync.getTime()) / (1000 * 60));

        // Sync every 30 mins
        if (diffMinutes >= 30) {
            syncData(userId).catch(e => console.error('[TwitchSync] Failed:', e));
        }
    } catch (e) {
        console.error('[TwitchSync] Check error:', e);
    }
};
