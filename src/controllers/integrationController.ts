
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

        const url = tiktokService.getAuthUrl(userId as string, origin as string);
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

        // Extract userId, verifier and origin from state (format: csrf_userId_verifier_origin)
        const parts = (state as string || '').split('_');
        const userId = parts[1];
        const verifier = parts[2];
        const origin = parts[3];

        if (!userId || !verifier) {
            console.error('[TikTokController] Invalid state components:', { userId, verifier });
            return res.status(400).json({ error: 'Invalid state or missing PKCE verifier' });
        }

        await tiktokService.handleCallback(code as string, userId, verifier);

        // Redirect back to frontend
        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;
        res.redirect(`${redirectUrl}/admin?success=tiktok`);
    } catch (error: any) {
        console.error('TikTok Callback error:', error);
        const state = req.query.state as string;
        const origin = state?.split('_')[3];
        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;
        res.redirect(`${redirectUrl}/admin?error=tiktok`);
    }
};

export const getInstagramAuthUrl = (req: Request, res: Response) => {
    try {
        const { userId, origin } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const url = instagramService.getAuthUrl(userId as string, origin as string);
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

        // Extract userId and origin from state (format: csrf_userId_origin)
        const parts = (state as string || '').split('_');
        const userId = parts[1];
        const origin = parts[2];

        if (!userId) {
            return res.status(400).json({ error: 'Invalid state or missing userId' });
        }

        await instagramService.handleCallback(code as string, userId);

        // Redirect back to frontend
        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;
        res.redirect(`${redirectUrl}/admin?success=instagram`);
    } catch (error: any) {
        console.error('Instagram Callback error:', error);
        const state = req.query.state as string;
        const origin = state?.split('_')[2];
        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;
        res.redirect(`${redirectUrl}/admin?error=instagram`);
    }
};

export const getTwitchAuthUrl = (req: Request, res: Response) => {
    try {
        const { userId, origin } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const url = twitchService.getAuthUrl(userId as string, origin as string);
        res.json({ url });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const handleTwitchCallback = async (req: Request, res: Response) => {
    try {
        const { code, state, error: authError } = req.query;

        // Extract userId and origin from state (format: { userId, origin } encoded in base64)
        let origin = '';
        let userId = '';
        try {
            if (state) {
                const base64State = (state as string).replace(/ /g, '+');
                const stateData = JSON.parse(Buffer.from(base64State, 'base64').toString());
                origin = stateData.origin;
                userId = stateData.userId;
            }
        } catch (e) {
            console.error('Twitch Callback State Parsing Error:', e);
        }

        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;

        if (authError || !code) {
            console.error(`Twitch Callback Error: Provider sent error or missing code. Error: ${authError}`);
            return res.redirect(`${redirectUrl}/admin?error=twitch_auth_denied`);
        }

        if (!userId) {
            return res.redirect(`${redirectUrl}/admin?error=twitch_invalid_state`);
        }

        await twitchService.handleCallback(code as string, userId);

        // Redirect back to frontend
        res.redirect(`${redirectUrl}/admin?success=twitch`);
    } catch (error: any) {
        console.error('Twitch Callback error:', error);

        let origin = '';
        try {
            const state = req.query.state as string;
            const base64State = state.replace(/ /g, '+');
            const stateData = JSON.parse(Buffer.from(base64State, 'base64').toString());
            origin = stateData.origin;
        } catch (e) { }

        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;
        res.redirect(`${redirectUrl}/admin?error=twitch`);
    }
};

export const getYoutubeAuthUrl = (req: Request, res: Response) => {
    try {
        const { userId, origin } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const url = youtubeService.getAuthUrl(userId as string, origin as string);
        res.json({ url });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const handleYoutubeCallback = async (req: Request, res: Response) => {
    try {
        const { code, state } = req.query;

        if (!code) {
            return res.status(400).json({ error: 'Missing code' });
        }

        // Extract userId and origin from state (JSON base64)
        const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
        const { userId, origin } = stateData;

        if (!userId) {
            return res.status(400).json({ error: 'Invalid state or missing userId' });
        }

        await youtubeService.handleCallback(code as string, userId);

        // Redirect back to frontend
        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;
        res.redirect(`${redirectUrl}/admin?success=youtube`);
    } catch (error: any) {
        console.error('YouTube Callback error:', error);

        let origin = '';
        try {
            const state = req.query.state as string;
            const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
            origin = stateData.origin;
        } catch (e) { }

        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;
        res.redirect(`${redirectUrl}/admin?error=youtube`);
    }
};

export const getKickAuthUrl = (req: Request, res: Response) => {
    try {
        const { userId, origin } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const url = kickService.getAuthUrl(userId as string, origin as string);
        res.json({ url });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const handleKickCallback = async (req: Request, res: Response) => {
    try {
        const { code, state, error: authError } = req.query;

        // Ensure we find the origin to redirect even if there's an error
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
        } catch (e) {
            console.error('Kick Callback State Parsing Error:', e);
        }

        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;

        if (authError || !code) {
            console.error(`Kick Callback Error: Provider sent error or missing code. Error: ${authError}`);
            return res.redirect(`${redirectUrl}/admin?error=kick_auth_denied`);
        }

        if (!userId) {
            return res.redirect(`${redirectUrl}/admin?error=kick_invalid_state`);
        }

        await kickService.handleCallback(code as string, userId, verifier);

        // Redirect back to frontend
        res.redirect(`${redirectUrl}/admin?success=kick`);
    } catch (error: any) {
        console.error('Kick Callback error:', error);

        let origin = '';
        try {
            const state = req.query.state as string;
            const base64State = state.replace(/ /g, '+');
            const stateData = JSON.parse(Buffer.from(base64State, 'base64').toString());
            origin = stateData.origin;
        } catch (e) { }

        const defaultFrontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        const redirectUrl = (origin && origin !== 'production') ? origin : defaultFrontendUrl;
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

        console.log(`[KickController] Connecting Kick account for ${cleanUsername}...`);

        // Fetch real data from Kick
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
        } catch (err) {
            console.warn(`[KickController] Could not fetch real-time data for ${cleanUsername}:`, err);
        }

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

        // Ensure link exists
        await kickService.ensureKickLink(userId, cleanUsername);

        res.json({ success: true, data });
    } catch (error: any) {
        console.error('Kick Connect error:', error);
        res.status(500).json({ error: error.message });
    }
};

export const handleInstagramDeauthorize = async (req: Request, res: Response) => {
    try {
        // Meta sends a signed_request in POST
        console.log('[InstagramController] Deauthorize request received:', req.body);

        // Logic to remove integration would go here if we can parse the signed_request
        // For now, returning 200 OK to satisfy Meta's requirement
        res.status(200).send('Deauthorized successfully');
    } catch (error: any) {
        console.error('Instagram Deauthorize error:', error);
        res.status(500).json({ error: error.message });
    }
};

export const handleInstagramWebhook = async (req: Request, res: Response) => {
    // Handle Verification (GET)
    if (req.method === 'GET') {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];

        // Use a secure token defined in .env
        const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'nodus_secure_token_2026';

        if (mode && token) {
            if (mode === 'subscribe' && token === verifyToken) {
                console.log('[InstagramController] Webhook verified successfully');
                res.set('Content-Type', 'text/plain');
                return res.status(200).send(challenge);
            } else {
                console.error('[InstagramController] Webhook token mismatch:', { received: token, expected: verifyToken });
                return res.status(403).send('Forbidden');
            }
        }
    }

    // Handle Notifications (POST)
    if (req.method === 'POST') {
        console.log('[InstagramController] Webhook notification received:', JSON.stringify(req.body, null, 2));
        // Logic to process data changes (e.g., deleted posts, profile changes)
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

        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        if (!provider) return res.status(400).json({ error: 'Missing provider' });

        console.log(`[IntegrationController] Disconnecting ${provider} for user:`, userId);

        // 1. Delete from social_integrations table
        const { error: deleteError } = await supabase
            .from('social_integrations')
            .delete()
            .eq('user_id', userId)
            .eq('provider', provider);

        if (deleteError) throw deleteError;

        // 2. Update redundant 'integrations' array in 'users' table
        const { data: remainingIntegrations } = await supabase
            .from('social_integrations')
            .select('provider, profile_data')
            .eq('user_id', userId);

        await supabase
            .from('users')
            .update({ integrations: remainingIntegrations || [] })
            .eq('id', userId);

        res.json({ success: true, message: `Disconnected ${provider} successfully` });
    } catch (error: any) {
        console.error('Disconnect Integration error:', error);
        res.status(500).json({ error: error.message });
    }
};
export const switchInstagramAccount = async (req: Request, res: Response) => {
    try {
        const { userId } = (req as any);
        const { channelId } = req.body;

        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        if (!channelId) return res.status(400).json({ error: 'Missing channelId' });

        const updatedProfile = await instagramService.switchInstagramAccount(userId, channelId);

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

        res.json({ success: true, profile_data: updatedProfile });
    } catch (error: any) {
        console.error('Switch Instagram Account error:', error);
        res.status(500).json({ error: error.message });
    }
};
