
import { Request, Response } from 'express';
import * as tiktokService from '../services/tiktokService.js';
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

        // Extract userId from state (format: csrf_userId)
        const parts = (state as string || '').split('_');
        const userId = parts[parts.length - 1];

        if (!userId) {
            return res.status(400).json({ error: 'Invalid state' });
        }

        await tiktokService.handleCallback(code as string, userId);

        // Redirect back to frontend
        const frontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        res.redirect(`${frontendUrl}/editor?success=tiktok`);
    } catch (error: any) {
        console.error('TikTok Callback error:', error);
        const frontendUrl = process.env.FRONTEND_URL || 'https://noduscc.com.br';
        res.redirect(`${frontendUrl}/editor?error=tiktok`);
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
