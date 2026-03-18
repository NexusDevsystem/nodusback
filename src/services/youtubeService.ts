
import { google } from 'googleapis';
import { supabase } from '../config/supabaseClient.js';
import 'dotenv/config';

const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
);

// Scopes needed for YouTube profile data
const SCOPES = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/userinfo.profile'
];

/**
 * Generate the Google OAuth URL
 */
export const getAuthUrl = (userId: string, origin?: string) => {
    // We pass userId and origin in the state to retrieve them in the callback
    const state = Buffer.from(JSON.stringify({ userId, origin })).toString('base64');

    return oauth2Client.generateAuthUrl({
        access_type: 'offline', // Important to get a refreshToken
        scope: SCOPES,
        state: state,
        prompt: 'consent' // Forces showing the consent screen to ensure refresh_token is provided
    });
};

/**
 * Handle the OAuth2 callback, exchange code for tokens and fetch channel data
 */
export const handleCallback = async (code: string, userId: string) => {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Fetch channel information
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const response = await youtube.channels.list({
        part: ['snippet', 'statistics'],
        mine: true
    });

    const channel = response.data.items?.[0];
    if (!channel) {
        throw new Error('No YouTube channel found for this account.');
    }

    const profileData = {
        channelId: channel.id,
        username: (channel.snippet as any)?.customUrl?.replace('@', '') || channel.snippet?.title,
        title: channel.snippet?.title,
        avatar_url: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.default?.url,
        subscriber_count: parseInt(channel.statistics?.subscriberCount || '0'),
        view_count: parseInt(channel.statistics?.viewCount || '0'),
        video_count: parseInt(channel.statistics?.videoCount || '0'),
        last_synced: new Date().toISOString()
    };

    // Save to Supabase
    const { error } = await supabase
        .from('social_integrations')
        .upsert({
            user_id: userId,
            provider: 'youtube',
            provider_account_id: channel.id,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            profile_data: profileData,
            expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
            updated_at: new Date().toISOString()
        }, {
            onConflict: 'user_id,provider,provider_account_id'
        });

    if (error) throw error;

    // Update the main 'users' table integrations array for frontend consistency
    const { data: allIntegrations } = await supabase
        .from('social_integrations')
        .select('provider, provider_account_id, profile_data')
        .eq('user_id', userId);

    if (allIntegrations) {
        // Fetch current links to check if we need to auto-create one
        const { data: userData } = await supabase
            .from('users')
            .select('links')
            .eq('id', userId)
            .single();

        let updatePayload: any = { integrations: allIntegrations };

        if (userData) {
            const links = Array.isArray(userData.links) ? userData.links : [];
            const channelId = channel.id;

            // Check if this channel is already linked
            const hasLink = links.some((l: any) =>
                l.platform === 'youtube' &&
                (l.url?.includes(channelId) || l.provider_account_id === channelId)
            );

            if (!hasLink) {
                const newLink = {
                    id: Date.now().toString(),
                    type: 'link',
                    platform: 'youtube',
                    title: profileData.title || 'YouTube',
                    url: `https://youtube.com/channel/${channelId}`,
                    isActive: true,
                    clicks: 0,
                    layout: 'classic',
                    provider_account_id: channelId,
                    image: profileData.avatar_url
                };
                updatePayload.links = [...links, newLink];
            }
        }

        await supabase
            .from('users')
            .update(updatePayload)
            .eq('id', userId);
    }

    return profileData;
};

/**
 * Sync YouTube channel data (subscribers, live status)
 */
export const syncData = async (userId: string) => {
    try {
        const { data: integration } = await supabase
            .from('social_integrations')
            .select('*')
            .eq('user_id', userId)
            .eq('provider', 'youtube')
            .single();

        if (!integration || !integration.refresh_token) return;

        // Use local client
        const client = new google.auth.OAuth2(
            process.env.YOUTUBE_CLIENT_ID,
            process.env.YOUTUBE_CLIENT_SECRET,
            process.env.YOUTUBE_REDIRECT_URI
        );

        client.setCredentials({
            access_token: integration.access_token,
            refresh_token: integration.refresh_token,
            expiry_date: integration.expires_at ? new Date(integration.expires_at).getTime() : 0
        });

        // Forced refresh if about to expire
        if (integration.expires_at && new Date(integration.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
            const { credentials } = await client.refreshAccessToken();
            client.setCredentials(credentials);

            await supabase
                .from('social_integrations')
                .update({
                    access_token: credentials.access_token,
                    expires_at: credentials.expiry_date ? new Date(credentials.expiry_date).toISOString() : null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', integration.id);
        }

        const youtube = google.youtube({ version: 'v3', auth: client });

        // 1. Get Channel Stats
        const statsResponse = await youtube.channels.list({
            part: ['snippet', 'statistics'],
            id: [integration.provider_account_id]
        });

        const channel = statsResponse.data.items?.[0];
        if (!channel) return;

        // 2. Check if Live (Fastest way is search for live videos for this channel)
        let isLive = false;
        try {
            const liveSearch = await youtube.search.list({
                part: ['snippet'],
                channelId: integration.provider_account_id,
                type: ['video'],
                eventType: 'live',
                maxResults: 1
            });
            isLive = (liveSearch.data.items?.length || 0) > 0;
        } catch (err) {
            console.error('[YouTubeService] Live check failed:', err);
        }

        const updatedProfileData = {
            ...integration.profile_data,
            subscriber_count: parseInt(channel.statistics?.subscriberCount || '0'),
            is_live: isLive,
            last_synced: new Date().toISOString()
        };

        // Update database
        await supabase
            .from('social_integrations')
            .update({
                profile_data: updatedProfileData,
                updated_at: new Date().toISOString()
            })
            .eq('id', integration.id);

        // Update integrations cache in users table
        const { data: allIntegrations } = await supabase
            .from('social_integrations')
            .select('provider, provider_account_id, profile_data')
            .eq('user_id', userId);

        if (allIntegrations) {
            await supabase
                .from('users')
                .update({ integrations: allIntegrations })
                .eq('id', userId);
        }

    } catch (err) {
        console.error('[YouTubeService] Sync Error:', err);
    }
};

/**
 * Check and trigger sync if needed (every 30 mins)
 */
export const checkAndSync = async (userId: string) => {
    try {
        const { data: integration } = await supabase
            .from('social_integrations')
            .select('id, updated_at')
            .eq('user_id', userId)
            .eq('provider', 'youtube')
            .limit(1)
            .maybeSingle();

        if (!integration) return;

        const lastSync = integration.updated_at ? new Date(integration.updated_at) : new Date(0);
        const now = new Date();
        const diffMinutes = Math.floor((now.getTime() - lastSync.getTime()) / (1000 * 60));

        // Sync every 2 mins for live detection (YouTube quota management)
        if (diffMinutes >= 2) {
            syncData(userId).catch(e => console.error('[YouTubeSync] Failed:', e));
        }
    } catch (err) {
        console.error('[YouTubeSync] Check error:', err);
    }
};
