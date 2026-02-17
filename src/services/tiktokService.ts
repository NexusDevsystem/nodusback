import crypto from 'crypto';
import { supabase } from '../config/supabaseClient.js';
import { SocialIntegrationDB } from '../models/types.js';

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI;

// Helper to generate PKCE challenge
const generatePKCE = () => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
};

export const getAuthUrl = (userId: string) => {
    const csrfState = Math.random().toString(36).substring(7);
    const { verifier, challenge } = generatePKCE();

    // Store verifier in the state to retrieve it later (csrf_userId_verifier)
    const state = `${csrfState}_${userId}_${verifier}`;

    // Auth URL (Note: Re-adding trailing slash as per official docs)
    const baseUrl = 'https://www.tiktok.com/v2/auth/authorize/';

    const params = new URLSearchParams({
        client_key: CLIENT_KEY || '',
        scope: 'user.info.profile,user.info.stats,video.list',
        response_type: 'code',
        redirect_uri: REDIRECT_URI || '',
        state: state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
    });

    const url = `${baseUrl}?${params.toString()}`;

    return url;
};

export const handleCallback = async (code: string, userId: string, codeVerifier: string): Promise<SocialIntegrationDB | null> => {
    try {

        // Exchange code for access token (v2 API)
        const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_key: CLIENT_KEY!,
                client_secret: CLIENT_SECRET!,
                code,
                grant_type: 'authorization_code',
                redirect_uri: REDIRECT_URI!,
                code_verifier: codeVerifier,
            }),
        });

        const tokenData = await tokenResponse.json() as any;

        if (tokenData.error) {
            throw new Error(`TikTok Token Error: ${tokenData.error_description || tokenData.error || 'Unknown error'}`);
        }

        const { access_token, refresh_token, open_id, expires_in } = tokenData;

        // Fetch user info (v2 API)
        // Define fields to get followers and basic info
        const fields = 'display_name,username,avatar_url,follower_count';
        const userResponse = await fetch(`https://open.tiktokapis.com/v2/user/info/?fields=${fields}`, {
            headers: {
                'Authorization': `Bearer ${access_token}`,
            },
        });

        const userData = await userResponse.json() as any;
        const user = userData.data?.user;

        if (!user) {
            console.error('[TikTokService] User data missing:', userData);
            throw new Error('Could not fetch TikTok user info');
        }

        const profileData = {
            username: user.display_name || user.username || '',
            follower_count: user.follower_count || 0,
            avatar_url: user.avatar_url || '',
            channel_id: open_id
        };

        // Save to DB
        const integrationData: SocialIntegrationDB = {
            user_id: userId,
            provider: 'tiktok',
            access_token: access_token,
            refresh_token: refresh_token,
            expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
            profile_data: profileData
        };

        const { data, error } = await supabase
            .from('social_integrations')
            .upsert(integrationData, { onConflict: 'user_id, provider' })
            .select()
            .single();

        if (error) throw error;

        console.log('[TikTokService] Integration saved successfully for user:', userId);
        return data;

    } catch (error) {
        console.error('TikTok Auth Error:', error);
        throw error;
    }
};

export const syncFeed = async (userId: string) => {
    try {
        const { data: integration, error } = await supabase
            .from('social_integrations')
            .select('*')
            .eq('user_id', userId)
            .eq('provider', 'tiktok')
            .single();

        if (error || !integration) throw new Error('TikTok integration not found');

        // Fetch videos from TikTok (v2 API - GET)
        const fields = 'id,title,cover_image_url,share_url,video_description,duration,create_time';
        const response = await fetch(`https://open.tiktokapis.com/v2/video/list/?fields=${fields}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${integration.access_token}`,
            },
        });

        const data = (await response.json()) as any;

        if (data.error) {
            console.error('TikTok API error:', data.error);
            return;
        }

        const videos = data.data?.videos || [];

        // Save videos as links for the user
        for (const video of videos) {
            const linkData = {
                user_id: userId,
                title: video.title || 'Vídeo do TikTok',
                url: video.share_url,
                is_active: true,
                is_archived: false,
                layout: 'card',
                type: 'social',
                platform: 'tiktok',
                video_url: video.share_url,
                icon: video.cover_image_url // Use cover as icon
            };

            // Check if link already exists
            const { data: existing } = await supabase
                .from('links')
                .select('id')
                .eq('user_id', userId)
                .eq('url', video.share_url)
                .maybeSingle();

            if (!existing) {
                await supabase.from('links').insert(linkData);
            }
        }

        return videos;
    } catch (error) {
        console.error('Error syncing TikTok feed:', error);
        throw error;
    }
};
