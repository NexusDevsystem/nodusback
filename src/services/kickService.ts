import { supabase } from '../config/supabaseClient.js';
import { SocialIntegrationDB } from '../models/types.js';
import crypto from 'crypto';

const getKickConfig = () => ({
    CLIENT_ID: process.env.KICK_CLIENT_ID,
    CLIENT_SECRET: process.env.KICK_CLIENT_SECRET,
    REDIRECT_URI: process.env.KICK_REDIRECT_URI
});

const generateCodeVerifier = () => {
    return crypto.randomBytes(32).toString('base64url');
};

const generateCodeChallenge = (verifier: string) => {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
};

/**
 * Ensures a Kick social link exists in the user's links list.
 */
export const ensureKickLink = async (userId: string, kickUsername: string) => {
    try {
        const kickUrl = `https://kick.com/${kickUsername}`;

        // Check if a Kick social link already exists
        const { data: existing } = await supabase
            .from('links')
            .select('id')
            .eq('user_id', userId)
            .eq('platform', 'kick')
            .eq('type', 'social')
            .limit(1)
            .maybeSingle();

        if (existing) {
            // Update it with the correct URL
            await supabase
                .from('links')
                .update({ url: kickUrl, title: 'Kick', is_active: true })
                .eq('id', existing.id);
            console.log(`[KickService] Updated Kick social link for user ${userId}`);
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
                title: 'Kick',
                url: kickUrl,
                is_active: true,
                is_archived: false,
                type: 'social',
                platform: 'kick',
                layout: 'social',
                position
            });
            console.log(`[KickService] Created Kick social link for user ${userId}`);
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
        console.error('[KickService] ensureKickLink error:', err);
    }
};

/**
 * Generates the Kick Auth URL with PKCE
 */
export const getAuthUrl = (userId: string, origin?: string) => {
    const { CLIENT_ID, REDIRECT_URI } = getKickConfig();
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    // Store verifier in state to retrieve it later in the callback
    const state = Buffer.from(JSON.stringify({
        userId,
        verifier,
        origin: origin || 'production'
    })).toString('base64');

    const scopes = [
        'user:read',
        'channel:read'
    ].join(' ');

    const baseUrl = 'https://id.kick.com/oauth/authorize';
    const params = new URLSearchParams({
        client_id: CLIENT_ID || '',
        redirect_uri: REDIRECT_URI || '',
        response_type: 'code',
        scope: scopes,
        state: state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
    });

    return `${baseUrl}?${params.toString()}`;
};

/**
 * Handles the OAuth callback from Kick with PKCE
 */
export const handleCallback = async (code: string, userId: string, stateVerifier?: string): Promise<SocialIntegrationDB | null> => {
    try {
        const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = getKickConfig();
        console.log(`[KickService] Handling callback for user ${userId}...`);

        // 1. Exchange code for tokens
        const tokenParams = new URLSearchParams({
            client_id: CLIENT_ID || '',
            client_secret: CLIENT_SECRET || '',
            code,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI || '',
            code_verifier: stateVerifier || '' // Mandatory for PKCE
        });

        const tokenRes = await fetch('https://id.kick.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: tokenParams.toString()
        });

        const responseText = await tokenRes.text();
        let tokenData;
        try {
            tokenData = JSON.parse(responseText);
        } catch (e) {
            throw new Error(`Kick Token API failed to return JSON. Status: ${tokenRes.status}. Body: ${responseText}`);
        }

        if (tokenData.error) {
            throw new Error(`Kick Token Error: ${tokenData.message || tokenData.error_description || tokenData.error}`);
        }

        if (!tokenData.access_token) {
            throw new Error(`Kick Token Error: Missing access_token in response. Body data: ${JSON.stringify(tokenData)}`);
        }

        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token;

        // 2. Get User Profile
        const userRes = await fetch('https://api.kick.com/public/v1/users', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        const userDataRaw = await userRes.json() as any;

        // Kick API might return { data: [{...}] } or { data: {...} } or just {...}
        let kickUser = userDataRaw;

        if (userDataRaw.data) {
            kickUser = Array.isArray(userDataRaw.data) ? userDataRaw.data[0] : userDataRaw.data;
        }

        if (!kickUser || !kickUser.name) {
            throw new Error(`Could not fetch Kick user profile. API Response: ${JSON.stringify(userDataRaw)}`);
        }

        const kickUsername = kickUser.name || kickUser.username;

        // 3. Get Channel Info (Live Status, Followers)
        let followerCount = 0;
        let isLive = false;
        try {
            // Oficial Kick Public API fetch for channel
            const channelRes = await fetch(`https://api.kick.com/public/v1/channels`, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const channelData = await channelRes.json() as any;

            if (channelData && Array.isArray(channelData.data) && channelData.data.length > 0) {
                const c = channelData.data[0];
                // Kick's new v1 API doesn't fully expose followers_count reliably yet, 
                // but we map it if they add it, or fallback.
                followerCount = c.followers_count || 0;
                isLive = c.is_live_now || false;
            }
        } catch (err) {
            console.warn('[KickService] Failed to fetch channel info:', err);
        }

        const profileData = {
            username: kickUsername,
            display_name: kickUser.name || kickUsername,
            avatar_url: kickUser.profile_picture || kickUser.profile_pic || `https://avatar.kick.com/${kickUsername}`,
            follower_count: followerCount,
            is_live: isLive,
            id: kickUser.id || kickUser.user_id
        };

        const integrationData: SocialIntegrationDB = {
            user_id: userId,
            provider: 'kick',
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

        // Create or update the Kick social link
        await ensureKickLink(userId, kickUsername);

        return data;
    } catch (error) {
        console.error('[KickService] Auth Error:', error);
        throw error;
    }
};

/**
 * Periodic sync for followers and stream status
 */
export const syncData = async (userId: string) => {
    try {
        const { data: integration } = await supabase
            .from('social_integrations')
            .select('*')
            .eq('user_id', userId)
            .eq('provider', 'kick')
            .single();

        if (!integration) return;

        // Fetch latest channel data
        const username = integration.profile_data.username;
        const channelRes = await fetch(`https://api.kick.com/public/v1/channels/${username}`);
        const channelData = await channelRes.json() as any;

        const updatedProfileData = {
            ...integration.profile_data,
            follower_count: channelData.followers_count || integration.profile_data.follower_count,
            is_live: channelData.livestream !== null,
            current_stream: channelData.livestream
        };

        await supabase
            .from('social_integrations')
            .update({
                profile_data: updatedProfileData,
                updated_at: new Date().toISOString()
            })
            .eq('id', integration.id);

        // Update users integration cache
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
        console.error('[KickService] Sync error:', err);
    }
};
