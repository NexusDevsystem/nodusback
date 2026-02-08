
import { google } from 'googleapis';
import { supabase } from '../config/supabaseClient.js';
import { SocialIntegrationDB } from '../models/types.js';

const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
);

export const getAuthUrl = () => {
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/youtube.readonly']
    });
};

export const handleCallback = async (code: string, userId: string): Promise<SocialIntegrationDB | null> => {
    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Fetch channel info
        const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
        const response = await youtube.channels.list({
            part: ['snippet', 'statistics'],
            mine: true
        });

        const channel = response.data.items?.[0];
        if (!channel) throw new Error('No channel found');

        const profileData = {
            username: channel.snippet?.title || '',
            follower_count: parseInt(channel.statistics?.subscriberCount || '0'),
            avatar_url: channel.snippet?.thumbnails?.default?.url || '',
            channel_id: channel.id || ''
        };

        // Save to DB
        const integrationData: SocialIntegrationDB = {
            user_id: userId,
            provider: 'youtube',
            access_token: tokens.access_token!,
            refresh_token: tokens.refresh_token!,
            expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : undefined,
            profile_data: profileData
        };

        const { data, error } = await supabase
            .from('social_integrations')
            .upsert(integrationData, { onConflict: 'user_id, provider' })
            .select()
            .single();

        if (error) throw error;
        return data;

    } catch (error) {
        console.error('YouTube Auth Error:', error);
        throw error;
    }
};
