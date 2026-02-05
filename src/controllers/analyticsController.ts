import { Request, Response } from 'express';
import { analyticsService } from '../services/analyticsService.js';
import { linkService } from '../services/linkService.js';

export const analyticsController = {
    async getAllAnalytics(req: Request, res: Response) {
        try {
            const analytics = await analyticsService.getAllAnalytics();
            res.json(analytics);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch analytics' });
        }
    },

    async trackClick(req: Request, res: Response) {
        try {
            const { linkId } = req.body;
            if (!linkId) {
                return res.status(400).json({ error: 'linkId is required' });
            }

            // Track in analytics
            await analyticsService.trackClick(linkId);

            // Increment link clicks
            await linkService.incrementClicks(linkId);

            res.status(201).json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to track click' });
        }
    }
};
