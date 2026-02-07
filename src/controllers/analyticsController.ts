import { Response } from 'express';
import { analyticsService } from '../services/analyticsService.js';
import { linkService } from '../services/linkService.js';
import { AuthRequest } from '../middleware/authMiddleware.js';

export const analyticsController = {
    async getAllAnalytics(req: AuthRequest, res: Response) {
        try {
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const analytics = await analyticsService.getAnalyticsByProfileId(req.profileId);
            res.json(analytics);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch analytics' });
        }
    },

    async trackClick(req: AuthRequest, res: Response) {
        try {
            const { linkId } = req.body;
            if (!linkId) {
                return res.status(400).json({ error: 'linkId is required' });
            }

            // Track in analytics
            await analyticsService.trackClick(req.profileId || '', linkId);

            // Increment link clicks
            await linkService.incrementClicks(linkId);

            res.status(201).json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to track click' });
        }
    }
};
