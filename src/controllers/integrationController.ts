
import { Request, Response } from 'express';
import * as tiktokService from '../services/tiktokService.js';
import * as instagramService from '../services/instagramService.js';
import * as twitchService from '../services/twitchService.js';
import * as youtubeService from '../services/youtubeService.js';
import * as kickService from '../services/kickService.js';
import { supabase } from '../config/supabaseClient.js';


export const getTikTokAuthUrl = (req: Request, res: Response) => {
    try {
        const { userId, origin } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const protocol = req.protocol === 'http' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol;
        const backendBaseUrl = `${protocol}://${req.get('host')}`;

        const url = tiktokService.getAuthUrl(userId as string, origin as string, backendBaseUrl);
        res.json({ url });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const handleTikTokCallback = async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            return res.status(400).json({ error: 'Missing code' });
        }

        const parts = (state as string || '').split('_');
        const userId = parts[1];
        const verifier = parts[2];
        const origin = parts[3];

        if (!userId || !verifier) {
            return res.status(400).json({ error: 'Invalid state or missing PKCE verifier' });
        }

        const protocol = req.protocol === 'http' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol;
        const backendBaseUrl = `${protocol}://${req.get('host')}`;

        await tiktokService.handleCallback(code as string, userId, verifier, backendBaseUrl);

        const defaultFrontendUrl = process.env.FRONTEND_URL;
        if (!defaultFrontendUrl) throw new Error('FRONTEND_URL missing');
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;
        res.redirect(`${redirectUrl}/admin?success=tiktok`);
    } catch (error: any) {
        console.error('TikTok Callback error:', error);
        const state = req.query.state as string;
        const originFromState = state?.split('_')[3];
        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://www.nodus.my';
        const redirectUrl = (originFromState && originFromState !== 'production') ? originFromState : defaultFrontendUrl;
        res.redirect(`${redirectUrl}/admin?error=tiktok`);
    }
};

export const getInstagramAuthUrl = (req: Request, res: Response) => {
    try {
        const { userId, origin } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const protocol = req.protocol === 'http' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol;
        const backendBaseUrl = `${protocol}://${req.get('host')}`;

        const url = instagramService.getAuthUrl(userId as string, origin as string, backendBaseUrl);
        res.json({ url });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const handleInstagramCallback = async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            return res.status(400).json({ error: 'Missing code' });
        }

        const parts = (state as string || '').split('_');
        const userId = parts[1];
        const origin = parts[2];

        if (!userId) {
            return res.status(400).json({ error: 'Invalid state or missing userId' });
        }

        const protocol = req.protocol === 'http' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol;
        const backendBaseUrl = `${protocol}://${req.get('host')}`;

        await instagramService.handleCallback(code as string, userId, backendBaseUrl);

        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://www.nodus.my';
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;
        res.redirect(`${redirectUrl}/admin?success=instagram`);
    } catch (error: any) {
        console.error('Instagram Callback error:', error);
        const state = req.query.state as string;
        const originFromState = state?.split('_')[2];
        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://www.nodus.my';
        const redirectUrl = (originFromState && originFromState !== 'production') ? originFromState : defaultFrontendUrl;
        res.redirect(`${redirectUrl}/admin?error=instagram`);
    }
};

export const getTwitchAuthUrl = (req: Request, res: Response) => {
    try {
        const { userId, origin } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const protocol = req.protocol === 'http' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol;
        const backendBaseUrl = `${protocol}://${req.get('host')}`;

        const url = twitchService.getAuthUrl(userId as string, origin as string, backendBaseUrl);
        res.json({ url });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const handleTwitchCallback = async (req: Request, res: Response) => {
    try {
        const { code, state, error: authError } = req.query;
        let origin = '';
        let userId = '';

        try {
            if (state) {
                const base64State = (state as string).replace(/ /g, '+');
                const stateData = JSON.parse(Buffer.from(base64State, 'base64').toString());
                origin = stateData.origin;
                userId = stateData.userId;
            }
        } catch (e) { }

        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://www.nodus.my';
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;

        if (authError || !code) {
            return res.redirect(`${redirectUrl}/admin?error=twitch_auth_denied`);
        }

        if (!userId) {
            return res.redirect(`${redirectUrl}/admin?error=twitch_invalid_state`);
        }

        const protocol = req.protocol === 'http' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol;
        const backendBaseUrl = `${protocol}://${req.get('host')}`;

        await twitchService.handleCallback(code as string, userId, backendBaseUrl);
        res.redirect(`${redirectUrl}/admin?success=twitch`);
    } catch (error: any) {
        console.error('Twitch Callback error:', error);
        const state = req.query.state as string;
        let origin = '';
        try {
            if (state) {
                const base64State = state.replace(/ /g, '+');
                const stateData = JSON.parse(Buffer.from(base64State, 'base64').toString());
                origin = stateData?.origin;
            }
        } catch (e) { }
        const redirectUrl = (origin && !origin.includes('localhost')) ? origin : 'https://www.nodus.my';
        res.redirect(`${redirectUrl}/admin?error=twitch`);
    }
};

export const getYoutubeAuthUrl = (req: Request, res: Response) => {
    try {
        const { userId, origin } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const protocol = req.protocol === 'http' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol;
        const backendBaseUrl = `${protocol}://${req.get('host')}`;

        const url = youtubeService.getAuthUrl(userId as string, origin as string, backendBaseUrl);
        res.json({ url });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const handleYoutubeCallback = async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query;
        if (!code) return res.status(400).json({ error: 'Missing code' });

        const safeState = (state as string || '').replace(/ /g, '+');
        const stateData = JSON.parse(Buffer.from(safeState, 'base64').toString());
        const { userId, origin } = stateData || {};

        const protocol = req.protocol === 'http' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol;
        const backendBaseUrl = `${protocol}://${req.get('host')}`;

        await youtubeService.handleCallback(code as string, userId, backendBaseUrl);

        const redirectUrl = (origin && !origin.includes('localhost')) ? origin : 'https://www.nodus.my';
        res.redirect(`${redirectUrl}/admin?success=youtube`);
    } catch (error: any) {
        console.error('YouTube Callback error:', error);
        const state = req.query.state as string;
        let origin = '';
        try {
            if (state) {
                const safeState = state.replace(/ /g, '+');
                const stateData = JSON.parse(Buffer.from(safeState, 'base64').toString());
                origin = stateData?.origin;
            }
        } catch (e) { }
        const redirectUrl = (origin && !origin.includes('localhost')) ? origin : 'https://www.nodus.my';
        res.redirect(`${redirectUrl}/admin?error=youtube`);
    }
};

export const getKickAuthUrl = (req: Request, res: Response) => {
    try {
        const { userId, origin } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const protocol = req.protocol === 'http' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol;
        const backendBaseUrl = `${protocol}://${req.get('host')}`;

        const url = kickService.getAuthUrl(userId as string, origin as string, backendBaseUrl);
        res.json({ url });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const handleKickCallback = async (req: Request, res: Response) => {
    try {
        const { code, state, error: authError } = req.query;
        let origin = '';
        let userId = '';
        let verifier = '';

        try {
            if (state) {
                const base64State = (state as string).replace(/ /g, '+');
                const stateData = JSON.parse(Buffer.from(base64State, 'base64').toString());
                origin = stateData.origin;
                userId = stateData.userId;
                verifier = stateData.verifier;
            }
        } catch (e) { }

        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://www.nodus.my';
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;

        if (authError || !code) {
            return res.redirect(`${redirectUrl}/admin?error=kick_auth_denied`);
        }

        const protocol = req.protocol === 'http' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol;
        const backendBaseUrl = `${protocol}://${req.get('host')}`;

        await kickService.handleCallback(code as string, userId, verifier, backendBaseUrl);
        res.redirect(`${redirectUrl}/admin?success=kick`);
    } catch (error: any) {
        console.error('Kick Callback error:', error);
        const state = req.query.state as string;
        let origin = '';
        try {
            if (state) {
                const base64State = state.replace(/ /g, '+');
                const stateData = JSON.parse(Buffer.from(base64State, 'base64').toString());
                origin = stateData?.origin;
            }
        } catch (e) { }
        const redirectUrl = (origin && !origin.includes('localhost')) ? origin : 'https://www.nodus.my';
        res.redirect(`${redirectUrl}/admin?error=kick`);
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
            avatar_url: `https://avatar.kick.com/${cleanUsername}`,
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
            .select()
            .single();

        if (error) throw error;
        await kickService.ensureKickLink(userId, cleanUsername);
        res.json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const handleInstagramDeauthorize = async (req: Request, res: Response) => {
    try {
        res.status(200).send('Deauthorized successfully');
    } catch (error: any) {
        res.status(500).json({ error: error.message });
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
            .select('*')
            .eq('user_id', userId);

        if (error) throw error;
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
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
        res.status(500).json({ error: error.message });
    }
};
