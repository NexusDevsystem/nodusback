import { db } from '../config/database.js';
import { AnalyticsEvent } from '../models/types.js';

export const analyticsService = {
    async getAllAnalytics(): Promise<AnalyticsEvent[]> {
        await db.read();
        return db.data.analytics;
    },

    async trackClick(linkId: string): Promise<void> {
        await db.read();
        const event: AnalyticsEvent = {
            linkId,
            timestamp: new Date().toISOString(),
            type: 'click'
        };
        db.data.analytics.push(event);
        await db.write();
    }
};
