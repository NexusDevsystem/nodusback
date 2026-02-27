import { supabase } from '../config/supabaseClient.js';
import { SocialIntegrationDB } from '../models/types.js';

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT_URI = process.env.TWITCH_REDIRECT_URI;

/**
 * Generates the Twitch Auth URL
 */
export const getAuthUrl = (userId: string, origin?: string) => {
    const state = Buffer.from(JSON.stringify({ userId, origin: origin || 'production' })).toString('base64');

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

        // Sync extra data if needed
        await syncData(userId);

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
