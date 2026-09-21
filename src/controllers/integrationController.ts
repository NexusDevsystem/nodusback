
import { Request, Response } from 'express';
import crypto from 'crypto';
import * as tiktokService from '../services/tiktokService.js';
import * as instagramService from '../services/instagramService.js';
import * as twitchService from '../services/twitchService.js';
import * as youtubeService from '../services/youtubeService.js';
import * as kickService from '../services/kickService.js';
import { supabase } from '../config/supabaseClient.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import {
    consumeOAuthState,
    createOAuthState,
    defaultFrontendOrigin,
    getBackendBaseUrl,
    resolveFrontendOrigin
} from '../utils/oauthState.js';


const createPkceVerifier = () => crypto.randomBytes(32).toString('base64url');

export const getTikTokAuthUrl = (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        const origin = resolveFrontendOrigin(req.query.origin as string | undefined);
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const verifier = createPkceVerifier();
        const state = createOAuthState('tiktok', userId, origin, verifier);
        const url = tiktokService.getAuthUrl(userId, origin, getBackendBaseUrl(req), state, verifier);
        res.json({ url });
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Invalid OAuth request' });
    }
};

export const handleTikTokCallback = async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            return res.status(400).json({ error: 'Missing code' });
        }

        const stateData = consumeOAuthState(String(state || ''), 'tiktok');
        if (!stateData.verifier) throw new Error('Missing PKCE verifier');
        await tiktokService.handleCallback(code as string, stateData.userId, stateData.verifier, getBackendBaseUrl(req));
        res.redirect(`${stateData.origin}/editor?success=tiktok`);
    } catch (error: any) {
        console.error('TikTok Callback error:', error);
        res.redirect(`${defaultFrontendOrigin()}/editor?error=tiktok`);
    }
};

export const getInstagramAuthUrl = (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        const origin = resolveFrontendOrigin(req.query.origin as string | undefined);
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const state = createOAuthState('instagram', userId, origin);
        const url = instagramService.getAuthUrl(userId, origin, getBackendBaseUrl(req), state);
        res.json({ url });
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Invalid OAuth request' });
    }
};

export const handleInstagramCallback = async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            return res.status(400).json({ error: 'Missing code' });
        }

        const stateData = consumeOAuthState(String(state || ''), 'instagram');
        await instagramService.handleCallback(code as string, stateData.userId, getBackendBaseUrl(req));
        res.redirect(`${stateData.origin}/editor?success=instagram`);
    } catch (error: any) {
        console.error('Instagram Callback error:', error);
        res.redirect(`${defaultFrontendOrigin()}/editor?error=instagram`);
    }
};

export const getTwitchAuthUrl = (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        const origin = resolveFrontendOrigin(req.query.origin as string | undefined);
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const state = createOAuthState('twitch', userId, origin);
        const url = twitchService.getAuthUrl(userId, origin, getBackendBaseUrl(req), state);
        res.json({ url });
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Invalid OAuth request' });
    }
};

export const handleTwitchCallback = async (req: Request, res: Response) => {
    try {
        const { code, state, error: authError } = req.query;
        const stateData = consumeOAuthState(String(state || ''), 'twitch');
        if (authError || !code) return res.redirect(`${stateData.origin}/editor?error=twitch_auth_denied`);
        await twitchService.handleCallback(code as string, stateData.userId, getBackendBaseUrl(req));
        res.redirect(`${stateData.origin}/editor?success=twitch`);
    } catch (error: any) {
        console.error('Twitch Callback error:', error);
        res.redirect(`${defaultFrontendOrigin()}/editor?error=twitch`);
    }
};

export const getYoutubeAuthUrl = (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        const origin = resolveFrontendOrigin(req.query.origin as string | undefined);
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const state = createOAuthState('youtube', userId, origin);
        const url = youtubeService.getAuthUrl(userId, origin, getBackendBaseUrl(req), state);
        res.json({ url });
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Invalid OAuth request' });
    }
};

export const handleYoutubeCallback = async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query;
        if (!code) return res.status(400).json({ error: 'Missing code' });

        const stateData = consumeOAuthState(String(state || ''), 'youtube');
        await youtubeService.handleCallback(code as string, stateData.userId, getBackendBaseUrl(req));
        res.redirect(`${stateData.origin}/editor?success=youtube`);
    } catch (error: any) {
        console.error('YouTube Callback error:', error);
        res.redirect(`${defaultFrontendOrigin()}/editor?error=youtube`);
    }
};

export const getKickAuthUrl = (req: AuthRequest, res: Response) => {
    try {
        const userId = req.userId;
        const origin = resolveFrontendOrigin(req.query.origin as string | undefined);
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const verifier = createPkceVerifier();
        const state = createOAuthState('kick', userId, origin, verifier);
        const url = kickService.getAuthUrl(userId, origin, getBackendBaseUrl(req), state, verifier);
        res.json({ url });
    } catch (error: any) {
        res.status(400).json({ error: error.message || 'Invalid OAuth request' });
    }
};

export const handleKickCallback = async (req: Request, res: Response) => {
    try {
        const { code, state, error: authError } = req.query;
        const stateData = consumeOAuthState(String(state || ''), 'kick');
        if (authError || !code) return res.redirect(`${stateData.origin}/editor?error=kick_auth_denied`);
        if (!stateData.verifier) throw new Error('Missing PKCE verifier');
        await kickService.handleCallback(code as string, stateData.userId, stateData.verifier, getBackendBaseUrl(req));
        res.redirect(`${stateData.origin}/editor?success=kick`);
    } catch (error: any) {
        console.error('Kick Callback error:', error);
        res.redirect(`${defaultFrontendOrigin()}/editor?error=kick`);
    }
};

export const connectKickAccount = async (req: Request, res: Response) => {
    try {
        const { userId } = (req as any);
        const { username } = req.body;

        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        if (!username) return res.status(400).json({ error: 'Missing Kick username' });

        const cleanUsername = username.trim().replace(/^@/, '').split('/').pop() || '';
        let profileData: any = {
            username: cleanUsername,
            display_name: cleanUsername,
            avatar_url: '',
            follower_count: 0,
            is_live: false
        };

        try {
            const channelRes = await fetch(`https://api.kick.com/v1/channels/${cleanUsername}`);
            if (channelRes.ok) {
                const channelData = await channelRes.json() as any;
                profileData = {
                    username: cleanUsername,
                    display_name: channelData.user?.username || cleanUsername,
                    avatar_url: channelData.user?.profile_pic || profileData.avatar_url,
                    follower_count: channelData.followers_count || 0,
                    is_live: channelData.livestream !== null
                };
            }
        } catch (err) { }

        const integrationData: any = {
            user_id: userId,
            provider: 'kick',
            access_token: 'manual',
            profile_data: profileData,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('social_integrations')
            .upsert(integrationData, { onConflict: 'user_id,provider' })
            .select('provider, provider_account_id, profile_data, expires_at, created_at, updated_at')
            .single();

        if (error) throw error;
        await kickService.ensureKickLink(userId, cleanUsername);
        res.json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ error: 'Falha ao processar a integração.' });
    }
};

export const handleInstagramDeauthorize = async (req: Request, res: Response) => {
    try {
        res.status(200).send('Deauthorized successfully');
    } catch (error: any) {
        res.status(500).json({ error: 'Falha ao processar a desautorização.' });
    }
};

export const handleInstagramWebhook = async (req: Request, res: Response) => {
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

        if (!verifyToken) {
            console.error('❌ META_WEBHOOK_VERIFY_TOKEN missing in .env');
            return res.status(500).send('Internal Server Error: Missing verification token');
        }

        if (mode === 'subscribe' && token === verifyToken) {
            res.set('Content-Type', 'text/plain');
            return res.status(200).send(challenge);
        }
        return res.status(403).send('Forbidden');
    }

    if (req.method === 'POST') {
        return res.status(200).send('EVENT_RECEIVED');
    }
};

export const getMyIntegrations = async (req: Request, res: Response) => {
    try {
        const { userId } = (req as any);
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const { data, error } = await supabase
            .from('social_integrations')
            .select('provider, provider_account_id, profile_data, expires_at, created_at, updated_at')
            .eq('user_id', userId);

        if (error) throw error;
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: 'Falha ao carregar integrações.' });
    }
};

export const disconnectIntegration = async (req: Request, res: Response) => {
    try {
        const { userId } = (req as any);
        const { provider } = req.params;
        const { providerAccountId } = req.body;

        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        let query = supabase.from('social_integrations').delete().eq('user_id', userId).eq('provider', provider);
        if (providerAccountId) query = query.eq('provider_account_id', providerAccountId);

        const { error: deleteError } = await query;
        if (deleteError) throw deleteError;

        let linkQuery = supabase.from('links').delete().eq('user_id', userId).eq('platform', provider);
        if (providerAccountId) linkQuery = linkQuery.eq('provider_account_id', providerAccountId);
        else linkQuery = linkQuery.eq('type', 'social');
        await linkQuery;

        const { data: userData } = await supabase.from('users').select('links').eq('id', userId).single();
        if (userData && Array.isArray(userData.links)) {
            const updatedLinks = userData.links.filter((l: any) => l.platform !== provider);
            await supabase.from('users').update({ links: updatedLinks }).eq('id', userId);
        }

        const { data: remainingIntegrations } = await supabase.from('social_integrations').select('provider, provider_account_id, profile_data').eq('user_id', userId);
        await supabase.from('users').update({ integrations: remainingIntegrations || [] }).eq('id', userId);

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: 'Falha ao desconectar integração.' });
    }
};

export const switchInstagramAccount = async (req: Request, res: Response) => {
    try {
        const { userId } = (req as any);
        const { channelId } = req.body;
        if (!userId || !channelId) return res.status(400).json({ error: 'Unauthorized or missing channelId' });

        const updatedProfile = await instagramService.switchInstagramAccount(userId, channelId);
        const { data: allIntegrations } = await supabase.from('social_integrations').select('provider, provider_account_id, profile_data').eq('user_id', userId);
        if (allIntegrations) {
            await supabase.from('users').update({ integrations: allIntegrations }).eq('id', userId);
        }
        res.json({ success: true, profile_data: updatedProfile });
    } catch (error: any) {
        res.status(500).json({ error: 'Falha ao trocar a conta do Instagram.' });
    }
};
