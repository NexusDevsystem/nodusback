import { supabase } from '../config/supabaseClient.js';
import { AnalyticsEvent } from '../models/types.js';

export const analyticsService = {
    // Get analytics summary for a profile
    async getAnalyticsSummary(userId: string, days: number = 14) {
        // If days is 0 (or 'all'), we fetch EVERYTHING
        // First, let's determine the start date if days > 0
        let startDate: Date;

        if (days > 0) {
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            startDate.setDate(startDate.getDate() - days);
        } else {
            // ALL TIME: Set to a very old date (e.g. 2020) or just null query
            startDate = new Date('2020-01-01'); // Project inception or reasonable past
        }

        // Fetch events for this user
        const query = supabase
            .from('clicks')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });

        // Only filter by date if not 'all time' (to be safe, or just use the old date)
        if (days > 0) {
            query.gte('created_at', startDate.toISOString());
        }

        const { data: events, error } = await query;

        if (error) {
            console.error('Error fetching analytics summary:', error);
            return { totalViews: 0, totalClicks: 0, ctr: 0, dailyData: [], topLinks: [] };
        }

        // If All Time (days=0), we need to determine the actual range from the first event
        let actualDays = days;
        if (days <= 0 && events && events.length > 0) {
            const firstEventDate = new Date(events[0].created_at);
            const now = new Date();
            const timeDiff = now.getTime() - firstEventDate.getTime();
            actualDays = Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1; // +1 to include today
            startDate = firstEventDate;
        } else if (days <= 0) {
            actualDays = 30; // Default if no data
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
        }

        // Initialize daily map
        const dailyMap = new Map();
        // For All Time, we might want to group differently if too large, but for now stick to daily
        // Limit to reasonable max (e.g. 365*2) to prevent UI crash?
        // Let's stick to generating days for the actual range found
        for (let i = 0; i < actualDays; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            // Only add if it's >= startDate (to be clean)
            if (date >= startDate || days > 0) { // Simple logic: just populate
                dailyMap.set(dateStr, { date: dateStr, views: 0, clicks: 0 });
            }
        }

        let totalViews = 0;
        let totalClicks = 0;
        const linkStats = new Map(); // link_id -> clicks count

        events?.forEach(event => {
            const ts = event.created_at;
            if (!ts) return;

            const dateStr = new Date(ts).toISOString().split('T')[0];
            const dayData = dailyMap.get(dateStr);

            if (dayData) {
                if (event.type === 'view') {
                    dayData.views++;
                    totalViews++;
                } else if (event.type === 'click') {
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
            .not('created_at', 'is', null)
            .order('created_at', { ascending: false });

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
                type: 'click'
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
                type: 'view',
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
                type: eventType,
                ...metadata
            });

        if (error) {
            console.error('Error tracking event:', error);
        }
    }
};
