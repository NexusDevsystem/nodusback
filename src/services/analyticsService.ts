import { supabase } from '../config/supabaseClient.js';
import { AnalyticsEvent } from '../models/types.js';

export const analyticsService = {
    // Get analytics summary for a profile
    async getAnalyticsSummary(userId: string) {
        // Get events FROM THE LAST 14 DAYS
        // Using a generous range to ensure we capture everything
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setHours(0, 0, 0, 0);
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

        // Fetch events for this user
        // We query the 'clicks' table which stores both 'view' and 'click' events
        const { data: events, error } = await supabase
            .from('clicks')
            .select('*')
            .eq('user_id', userId)
            .gte('created_at', fourteenDaysAgo.toISOString())
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Error fetching analytics summary:', error);
            return { totalViews: 0, totalClicks: 0, ctr: 0, dailyData: [], topLinks: [] };
        }

        // Initialize daily map with zeros for the last 14 days
        const dailyMap = new Map();
        for (let i = 0; i < 14; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            dailyMap.set(dateStr, { date: dateStr, views: 0, clicks: 0 });
        }

        let totalViews = 0;
        let totalClicks = 0;
        const linkStats = new Map(); // link_id -> clicks count

        events?.forEach(event => {
            // Support both 'timestamp' and 'created_at' (Supabase default)
            const ts = event.created_at || event.timestamp;
            if (!ts) return;

            const dateStr = new Date(ts).toISOString().split('T')[0];
            const dayData = dailyMap.get(dateStr);

            if (dayData) {
                if (event.event_type === 'view') {
                    dayData.views++;
                    totalViews++;
                } else if (event.event_type === 'click') {
                    dayData.clicks++;
                    totalClicks++;

                    // If it's a specific link or product, track it
                    const itemId = event.link_id || event.product_id;
                    if (itemId) {
                        const stats = linkStats.get(itemId) || { id: itemId, clicks: 0 };
                        stats.clicks++;
                        linkStats.set(itemId, stats);
                    }
                }
            }
        });

        // Convert map to sorted array (oldest to newest for the chart)
        const dailyData = Array.from(dailyMap.values()).reverse();

        // Calculate CTR (Click-Through Rate)
        const ctr = totalViews > 0 ? (totalClicks / totalViews) * 100 : 0;

        return {
            totalViews,
            totalClicks,
            ctr,
            dailyData,
            topLinks: Array.from(linkStats.values())
                .sort((a, b) => b.clicks - a.clicks)
                .slice(0, 5) // Top 5 links
        };
    },

    // Get all analytics for a profile (by user_id)
    async getAnalyticsByProfileId(userId: string): Promise<AnalyticsEvent[]> {
        const { data, error } = await supabase
            .from('clicks')
            .select('*')
            .eq('user_id', userId)  // FK to users(id)
            .not('timestamp', 'is', null)
            .order('timestamp', { ascending: false });

        if (error) {
            console.error('Error fetching analytics:', error);
            return [];
        }

        return (data || []) as AnalyticsEvent[];
    },

    // Track a click event
    async trackClick(userId: string, linkId?: string, productId?: string): Promise<void> {
        const { error } = await supabase
            .from('clicks')
            .insert({
                user_id: userId,
                link_id: linkId || null,
                product_id: productId || null,
                event_type: 'click'
            });

        if (error) {
            console.error('Error tracking click:', error);
        }
    },

    // Track a page view event
    async trackView(userId: string, metadata?: any): Promise<void> {
        const { error } = await supabase
            .from('clicks')
            .insert({
                user_id: userId,
                event_type: 'view',
                metadata: metadata || {}
            });

        if (error) {
            console.error('Error tracking view:', error);
        }
    },

    // Track a custom event
    async trackEvent(
        userId: string,
        eventType: string,
        linkId?: string,
        productId?: string,
        metadata?: Record<string, any>
    ): Promise<void> {
        const { error } = await supabase
            .from('clicks')
            .insert({
                user_id: userId,
                link_id: linkId || null,
                product_id: productId || null,
                event_type: eventType,
                ...metadata
            });

        if (error) {
            console.error('Error tracking event:', error);
        }
    }
};
