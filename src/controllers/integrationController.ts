
import { Request, Response } from 'express';
import * as tiktokService from '../services/tiktokService.js';
import * as instagramService from '../services/instagramService.js';
import { supabase } from '../config/supabaseClient.js';

export const getTikTokAuthUrl = (req: Request, res: Response) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const url = tiktokService.getAuthUrl(userId as string);
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

        // Extract userId and verifier from state (format: csrf_userId_verifier)
        const parts = (state as string || '').split('_');
        const userId = parts[1];
        const verifier = parts[2];

        if (!userId || !verifier) {
            console.error('[TikTokController] Invalid state components:', { userId, verifier });
            return res.status(400).json({ error: 'Invalid state or missing PCKE verifier' });
        }

        await tiktokService.handleCallback(code as string, userId, verifier);

        // Redirect back to frontend
        const frontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        res.redirect(`${frontendUrl}/admin?success=tiktok`);
    } catch (error: any) {
        console.error('TikTok Callback error:', error);
        const frontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        res.redirect(`${frontendUrl}/admin?error=tiktok`);
    }
};

export const getInstagramAuthUrl = (req: Request, res: Response) => {
    try {
        const { userId } = req.query;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });

        const url = instagramService.getAuthUrl(userId as string);
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

        // Extract userId from state (format: csrf_userId)
        const parts = (state as string || '').split('_');
        const userId = parts[1];

        if (!userId) {
            return res.status(400).json({ error: 'Invalid state or missing userId' });
        }

        await instagramService.handleCallback(code as string, userId);

        // Redirect back to frontend
        const frontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        res.redirect(`${frontendUrl}/admin?success=instagram`);
    } catch (error: any) {
        console.error('Instagram Callback error:', error);
        const frontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        res.redirect(`${frontendUrl}/admin?error=instagram`);
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
        const { user } = (req as any);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });

        const { data, error } = await supabase
            .from('social_integrations')
            .select('*')
            .eq('user_id', user.id);

        if (error) throw error;
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};
