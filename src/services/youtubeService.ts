
import { google } from 'googleapis';
import { supabase } from '../config/supabaseClient.js';
import { realtimeManager } from '../realtime/RealtimeManager.js';
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
export const getAuthUrl = (userId: string, origin?: string, backendBaseUrl?: string) => {
    const state = Buffer.from(JSON.stringify({ userId, origin })).toString('base64');

    // Always prefer the fixed YOUTUBE_REDIRECT_URI env var if set.
    // The dynamic backendBaseUrl can be wrong (http vs https) in production environments like Railway.
    const finalRedirectUri = process.env.YOUTUBE_REDIRECT_URI 
        || (backendBaseUrl ? `${backendBaseUrl}/api/integrations/youtube/callback` : '');

    console.log(`[YouTubeService] Auth URL redirect_uri: ${finalRedirectUri}`);

    const client = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        finalRedirectUri
    );

    return client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        state: state,
        prompt: 'consent'
    });
};

/**
 * Handle the OAuth2 callback, exchange code for tokens and fetch channel data
 */
export const handleCallback = async (code: string, userId: string, backendBaseUrl?: string) => {
    // Always prefer the fixed YOUTUBE_REDIRECT_URI env var if set.
    // The dynamic backendBaseUrl can be wrong (http vs https) in Railway.
    const finalRedirectUri = process.env.YOUTUBE_REDIRECT_URI 
        || (backendBaseUrl ? `${backendBaseUrl}/api/integrations/youtube/callback` : '');

    console.log(`[YouTubeService] Callback redirect_uri: ${finalRedirectUri}`);

    const client = new google.auth.OAuth2(
        process.env.YOUTUBE_CLIENT_ID,
        process.env.YOUTUBE_CLIENT_SECRET,
        finalRedirectUri
    );

    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    let profileData: any = {
        last_synced: new Date().toISOString()
    };

    try {
        const youtube = google.youtube({ version: 'v3', auth: client });
        const response = await youtube.channels.list({
            part: ['snippet', 'statistics'],
            mine: true
        });

        const channel = response.data.items?.[0];
        if (channel) {
            profileData = {
                channelId: channel.id,
                username: (channel.snippet as any)?.customUrl?.replace('@', '') || channel.snippet?.title,
                title: channel.snippet?.title,
                avatar_url: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.standard?.url || channel.snippet?.thumbnails?.medium?.url || channel.snippet?.thumbnails?.default?.url,
                subscriber_count: parseInt(channel.statistics?.subscriberCount || '0'),
                view_count: parseInt(channel.statistics?.viewCount || '0'),
                video_count: parseInt(channel.statistics?.videoCount || '0'),
                last_synced: new Date().toISOString()
            };
        }
    } catch (channelError: any) {
        console.warn('⚠️ [YouTubeService] Could not fetch channel data (quota?). Saving tokens only.', channelError?.message);
    }

    // Save to Supabase
    // Manual upsert: check if existing row for this user+provider, then update or insert
    const { data: existingIntegration } = await supabase
        .from('social_integrations')
        .select('id')
        .eq('user_id', userId)
        .eq('provider', 'youtube')
        .maybeSingle();

    const integrationPayload = {
        user_id: userId,
        provider: 'youtube',
        provider_account_id: profileData.channelId || null,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        profile_data: profileData,
        expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        updated_at: new Date().toISOString()
    };

    let saveError: any = null;
    if (existingIntegration) {
        const { error } = await supabase
            .from('social_integrations')
            .update(integrationPayload)
            .eq('id', existingIntegration.id);
        saveError = error;
    } else {
        const { error } = await supabase
            .from('social_integrations')
            .insert(integrationPayload);
        saveError = error;
    }

    if (saveError) {
        console.error('❌ [YouTubeService] Supabase Save Error:', saveError);
        throw saveError;
    }

    // Update the main 'users' table integrations array for frontend consistency
    const { data: allIntegrations } = await supabase
        .from('social_integrations')
        .select('provider, provider_account_id, profile_data')
        .eq('user_id', userId);

    if (allIntegrations) {
        // Update user's integration cache
        await supabase
            .from('users')
            .update({ integrations: allIntegrations })
            .eq('id', userId);

        const channelId = profileData.channelId;

        if (!channelId) {
            console.warn('⚠️ [youtubeService] No channelId available (quota hit?), skipping link upsert.');
            return profileData;
        }

        // Check if this channel is already linked in the links table
        console.log(`🎬 [youtubeService] Handling callback for user: ${userId}, channel: ${channelId}`);
        const { data: existingLink } = await supabase
            .from('links')
            .select('id, type, platform')
            .eq('user_id', userId)
            .or(`url.ilike.%${channelId}%,provider_account_id.eq.${channelId}`)
            .maybeSingle();

        if (existingLink) {
            console.log(`📝 [youtubeService] Updating existing link: ${existingLink.id}`);
            const { error: updateError } = await supabase
                .from('links')
                .update({ 
                    type: 'social', 
                    layout: 'social',
                    platform: 'youtube', // Crucial for frontend detection
                    url: `https://youtube.com/channel/${channelId}`,
                    icon: profileData.avatar_url, // Correct column name is 'icon'
                    provider_account_id: channelId,
                    title: profileData.title || 'YouTube',
                    is_active: true,
                    is_archived: false,
                })
                .eq('id', existingLink.id);
            
            if (updateError) console.error('❌ [youtubeService] Update error:', updateError);
            else console.log('✅ [youtubeService] Update successful');
        } else {
            console.log('✨ [youtubeService] Creating new YouTube link');
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

            const { error: insertError } = await supabase.from('links').insert({
                user_id: userId,
                title: profileData.title || 'YouTube',
                url: `https://youtube.com/channel/${channelId}`,
                is_active: true,
                is_archived: false,
                type: 'social',
                platform: 'youtube',
                layout: 'social',
                position,
                icon: profileData.avatar_url, // Correct column name is 'icon'
                provider_account_id: channelId
            });

            if (insertError) console.error('❌ [youtubeService] Insert error:', insertError);
            else console.log('✅ [youtubeService] Insert successful');
        }
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
            title: channel.snippet?.title || integration.profile_data?.title,
            avatar_url: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.medium?.url || integration.profile_data?.avatar_url,
            subscriber_count: parseInt(channel.statistics?.subscriberCount || '0'),
            is_live: isLive,
            channelId: channel.id,
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
            const { data: userData } = await supabase
                .from('users')
                .update({ integrations: allIntegrations })
                .eq('id', userId)
                .select('username')
                .single();

            // NOTIFY REALTIME CLIENTS
            if (userData?.username) {
                realtimeManager.notifyUpdate(userData.username);
            }
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
        const diffMinutes = Math.floor((now.getTime() - lastSync.getTime()) / 1000 / 60);

        // Sync every 6 hours to avoid burning the YouTube API free quota (10,000 units/day)
        if (diffMinutes >= 360) {
            syncData(userId).catch(e => console.error('[YouTubeSync] Failed:', e));
        }
    } catch (err) {
        console.error('[YouTubeSync] Check error:', err);
    }
};
