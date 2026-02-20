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

    async getSummary(req: AuthRequest, res: Response) {
        try {
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const days = req.query.days ? parseInt(req.query.days as string) : 14;
            console.log(`📊 [Analytics] getSummary: profileId=${req.profileId}, days=${days}`);

            // Diagnostic: check event count
            const eventCount = await analyticsService.getEventCount(req.profileId);
            console.log(`📊 [Analytics] Total events for user: ${eventCount}`);

            const summary = await analyticsService.getAnalyticsSummary(req.profileId, days);
            console.log(`📊 [Analytics] Summary result: views=${summary.totalViews}, clicks=${summary.totalClicks}, dailyData=${summary.dailyData.length} days, topLinks=${summary.topLinks.length}`);

            res.json(summary);
        } catch (error) {
            console.error('❌ [Analytics] Summary error:', error);
            res.status(500).json({ error: 'Failed to fetch analytics summary' });
        }
    },

    async trackClick(req: AuthRequest, res: Response) {
        try {
            const { linkId } = req.body;
            if (!linkId) {
                return res.status(400).json({ error: 'linkId is required' });
            }

            console.log(`📊 [Analytics] trackClick (analytics route): linkId=${linkId}`);

            // Increment link clicks AND record analytics event
            await linkService.incrementClicks(linkId);

            res.status(201).json({ success: true });
        } catch (error: any) {
            console.error('❌ [Analytics] trackClick error:', error?.message || error);
            res.status(500).json({ error: 'Failed to track click' });
        }
    },

    // New: Public endpoint for tracking clicks from frontend
    async trackClickPublic(req: AuthRequest, res: Response) {
        try {
            const { itemId } = req.body;
            if (!itemId) {
                return res.status(400).json({ error: 'itemId is required' });
            }

            console.log(`📊 [Analytics] trackClickPublic: itemId=${itemId}`);

            // This calls incrementClicks which handles both the counter and the analytics event
            await linkService.incrementClicks(itemId);

            res.status(201).json({ success: true });
        } catch (error: any) {
            console.error('❌ [Analytics] trackClickPublic error:', error?.message || error);
            res.status(500).json({ error: 'Failed to track click' });
        }
    },

    async trackView(req: AuthRequest, res: Response) {
        try {
            const { profileId } = req.body;
            if (!profileId) {
                console.error('❌ [Analytics] trackView: missing profileId in body');
                return res.status(400).json({ error: 'profileId is required' });
            }

            console.log(`📊 [Analytics] trackView: profileId=${profileId}`);

            await analyticsService.trackView(profileId);

            res.status(201).json({ success: true });
        } catch (error: any) {
            console.error('❌ [Analytics] trackView error:', error?.message || error);
            res.status(500).json({ error: 'Failed to track view', details: error?.message });
        }
    }
};
