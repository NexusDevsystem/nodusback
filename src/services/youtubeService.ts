
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
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            profile_data: profileData,
            expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
            updated_at: new Date().toISOString()
        }, {
            onConflict: 'user_id,provider'
        });

    if (error) throw error;

    // Update the main 'users' table integrations array for frontend consistency
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

    return profileData;
};
