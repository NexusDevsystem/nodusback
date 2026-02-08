
import { Request, Response } from 'express';
import * as youtubeService from '../services/youtubeService.js';

export const getYouTubeAuthUrl = (req: Request, res: Response) => {
    try {
        const url = youtubeService.getAuthUrl();
        res.json({ url });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const handleYouTubeCallback = async (req: Request, res: Response) => {
    try {
        const { code, userId } = req.body;
        if (!code || !userId) {
            return res.status(400).json({ error: 'Missing code or userId' });
        }

        const integration = await youtubeService.handleCallback(code, userId);
        res.json({ success: true, integration });
    } catch (error: any) {
        console.error('Callback error:', error);
        res.status(500).json({ error: error.message });
    }
};
