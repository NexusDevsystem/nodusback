import { supabase } from '../config/supabaseClient.js';
import { SocialIntegrationDB } from '../models/types.js';
import crypto from 'crypto';

const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY;
const CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET;
const REDIRECT_URI = process.env.TIKTOK_REDIRECT_URI;

// Helper to generate PKCE verifier and challenge
const generateCodeVerifier = () => {
    return crypto.randomBytes(32).toString('base64url');
};

const generateCodeChallenge = (verifier: string) => {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
};

/**
 * Generates the TikTok Auth URL
 */
export const getAuthUrl = (userId: string, origin?: string, backendBaseUrl?: string) => {
    const csrfState = Math.random().toString(36).substring(7);
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);

    // csrf_userId_verifier_origin
    const state = `${csrfState}_${userId}_${verifier}_${origin || 'production'}`;

    const finalRedirectUri = backendBaseUrl 
        ? `${backendBaseUrl}/api/integrations/tiktok/callback` 
        : (REDIRECT_URI || '');

    const baseUrl = 'https://www.tiktok.com/v2/auth/authorize/';
    const params = new URLSearchParams({
        client_key: CLIENT_KEY || '',
        scope: 'user.info.basic,video.list',
        response_type: 'code',
        redirect_uri: finalRedirectUri,
        state: state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
    });

    return `${baseUrl}?${params.toString()}`;
};

/**
 * Handles the OAuth callback and exchanges code for tokens
 */
export const handleCallback = async (code: string, userId: string, verifier: string, backendBaseUrl?: string): Promise<SocialIntegrationDB | null> => {
    try {
        console.log(`[TikTokService] Handling callback for user ${userId}...`);

        const finalRedirectUri = backendBaseUrl 
            ? `${backendBaseUrl}/api/integrations/tiktok/callback` 
            : (REDIRECT_URI || '');

        const formData = new URLSearchParams();
        formData.append('client_key', CLIENT_KEY || '');
        formData.append('client_secret', CLIENT_SECRET || '');
        formData.append('code', code);
        formData.append('grant_type', 'authorization_code');
        formData.append('redirect_uri', finalRedirectUri);
        formData.append('code_verifier', verifier);

        // Exchange code for access token (v2 API)
        const tokenResponse = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cache-Control': 'no-cache'
            },
            body: formData.toString(),
        });

        const tokenData = await tokenResponse.json() as any;

        if (tokenData.error) {
            throw new Error(`TikTok Token Error: ${tokenData.error_description || tokenData.error}`);
        }

        const accessToken = tokenData.access_token;
        const openId = tokenData.open_id;

        // Fetch User Profile
        const profileRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,avatar_url,display_name,follower_count', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const profileDataRaw = await profileRes.json() as any;
        const user = profileDataRaw.data?.user;

        const profileData = {
            username: user?.display_name || 'TikTok User',
            avatar_url: user?.avatar_url || null,
            follower_count: user?.follower_count || 0,
            channel_id: openId,
            media: []
        };

        const integrationData: SocialIntegrationDB = {
            user_id: userId,
            provider: 'tiktok',
            provider_account_id: openId,
            access_token: accessToken,
            profile_data: profileData,
            expires_at: new Date(Date.now() + (tokenData.expires_in || 86400) * 1000).toISOString()
        };

        const { data, error } = await supabase
            .from('social_integrations')
            .upsert(integrationData, { onConflict: 'user_id,provider,provider_account_id' })
            .select()
            .single();

        if (error) throw error;

        // Run sync in background
        syncFeed(userId).catch(console.error);

        return data;
    } catch (error) {
        console.error('[TikTokService] Auth Error:', error);
        throw error;
    }
};

/**
 * Syncs the TikTok video feed
 */
export const syncFeed = async (userId: string) => {
    try {
        const { data: integration, error } = await supabase
            .from('social_integrations')
            .select('*')
            .eq('user_id', userId)
            .eq('provider', 'tiktok')
            .single();

        if (error || !integration) throw new Error('TikTok integration not found');

        // Fetch videos from TikTok API
        const videoRes = await fetch('https://open.tiktokapis.com/v2/video/list/?fields=id,cover_image_url,embed_link,title,share_url', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${integration.access_token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                max_count: 20
            })
        });

        const videoData = await videoRes.json() as any;
        const videos = videoData.data?.videos || [];

        // 1. Ensure TikTok link exists in the links table
        const { data: existingLink } = await supabase
            .from('links')
            .select('id')
            .eq('user_id', userId)
            .eq('platform', 'tiktok')
            .maybeSingle();

        if (!existingLink) {
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
                title: 'TikTok',
                url: `https://tiktok.com/@${integration.profile_data.username}`,
                is_active: true,
                isActive: true,
                is_archived: false,
                isArchived: false,
                type: 'social',
                platform: 'tiktok',
                layout: 'social',
                position,
                image: integration.profile_data.avatar_url
            });
        }

        // 2. Update user's integration cache
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

        return videos;
    } catch (error) {
        console.error('Error syncing TikTok feed:', error);
        throw error;
    }
};
/**
 * Check if we need to sync TikTok data (every 60 mins)
 */
export const checkAndSync = async (userId: string) => {
    try {
        const { data: integration } = await supabase
            .from('social_integrations')
            .select('id, updated_at')
            .eq('user_id', userId)
            .eq('provider', 'tiktok')
            .limit(1)
            .maybeSingle();

        if (!integration) return;

        const lastSync = integration.updated_at ? new Date(integration.updated_at) : new Date(0);
        const now = new Date();
        const diffMinutes = Math.floor((now.getTime() - lastSync.getTime()) / (1000 * 60));

        // Sync if older than 60 minutes
        if (diffMinutes >= 60) {
            console.log(`[TikTokService] Auto-syncing for user ${userId} (Last sync: ${diffMinutes}m ago)`);
            syncFeed(userId).catch(err => console.error('[TikTokSync] Background sync error:', err));
        }
    } catch (err) {
        console.error('[TikTokSync] Check error:', err);
    }
};
