import { supabase } from '../config/supabaseClient.js';
import { AnalyticsEvent } from '../models/types.js';

export const analyticsService = {
    // Get analytics summary for a profile
    async getAnalyticsSummary(userId: string, days: number = 14) {
        // Determine the start date
        let startDate: Date;

        if (days > 0) {
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            startDate.setDate(startDate.getDate() - days);
        } else {
            startDate = new Date('2020-01-01');
        }

        console.log(`📊 [Summary] Querying clicks for user=${userId}, days=${days}, startDate=${startDate.toISOString()}`);

        // Fetch events for this user - build query correctly
        let query = supabase
            .from('clicks')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true });

        // Apply date filter (reassign to capture the new builder)
        if (days > 0) {
            query = query.gte('created_at', startDate.toISOString());
        }

        const { data: events, error } = await query;

        if (error) {
            console.error('❌ [Summary] Error fetching events:', JSON.stringify(error));
            return { totalViews: 0, totalClicks: 0, ctr: 0, dailyData: [], topLinks: [] };
        }

        // Diagnostic: log raw events
        console.log(`📊 [Summary] Raw events returned: ${events?.length || 0}`);
        if (events && events.length > 0) {
            events.slice(0, 5).forEach((e, i) => {
                console.log(`📊 [Summary] Event[${i}]: type="${e.type}", created_at="${e.created_at}", link_id=${e.link_id || 'null'}, product_id=${e.product_id || 'null'}`);
            });
        }

        // Determine actual range for dailyMap
        let actualDays = days;
        if (days <= 0 && events && events.length > 0) {
            const firstEventDate = new Date(events[0].created_at);
            const now = new Date();
            const timeDiff = now.getTime() - firstEventDate.getTime();
            actualDays = Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1;
            startDate = firstEventDate;
        } else if (days <= 0) {
            actualDays = 30;
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
        }

        // Initialize daily map
        const dailyMap = new Map();
        for (let i = 0; i < actualDays; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            dailyMap.set(dateStr, { date: dateStr, views: 0, clicks: 0 });
        }

        let totalViews = 0;
        let totalClicks = 0;
        const linkStats = new Map();

        events?.forEach(event => {
            const ts = event.created_at;
            if (!ts) {
                console.log(`📊 [Summary] Skipping event with null created_at`);
                return;
            }

            const dateStr = new Date(ts).toISOString().split('T')[0];
            const dayData = dailyMap.get(dateStr);

            if (!dayData) {
                console.log(`📊 [Summary] Event date ${dateStr} NOT in dailyMap (range mismatch)`);
                return;
            }

            if (event.type === 'view') {
                dayData.views++;
                totalViews++;
            } else if (event.type === 'click') {
                dayData.clicks++;
                totalClicks++;

                const itemId = event.link_id || event.product_id;
                if (itemId) {
                    const stats = linkStats.get(itemId) || { id: itemId, clicks: 0 };
                    stats.clicks++;
                    linkStats.set(itemId, stats);
                }
            } else {
                console.log(`📊 [Summary] Unknown event type: "${event.type}" — not counted`);
            }
        });

        const dailyData = Array.from(dailyMap.values()).reverse();
        const ctr = totalViews > 0 ? (totalClicks / totalViews) * 100 : 0;

        return {
            totalViews,
            totalClicks,
            ctr,
            dailyData,
            topLinks: Array.from(linkStats.values())
                .sort((a, b) => b.clicks - a.clicks)
                .slice(0, 5)
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
        console.log(`📊 [Analytics] trackClick: userId=${userId}, linkId=${linkId || 'N/A'}, productId=${productId || 'N/A'}`);
        const payload = {
            user_id: userId,
            link_id: linkId || null,
            product_id: productId || null,
            type: 'click'
        };

        const { data, error } = await supabase
            .from('clicks')
            .insert(payload)
            .select();

        if (error) {
            console.error('❌ [Analytics] trackClick FAILED:', JSON.stringify(error));
            throw new Error(`Failed to track click: ${error.message}`);
        }

        console.log(`✅ [Analytics] Click tracked successfully, id=${data?.[0]?.id || 'unknown'}`);
    },

    // Track a page view event
    async trackView(userId: string): Promise<void> {
        console.log(`📊 [Analytics] trackView: userId=${userId}`);
        const payload = {
            user_id: userId,
            type: 'view'
        };

        const { data, error } = await supabase
            .from('clicks')
            .insert(payload)
            .select();

        if (error) {
            console.error('❌ [Analytics] trackView FAILED:', JSON.stringify(error));
            throw new Error(`Failed to track view: ${error.message}`);
        }

        console.log(`✅ [Analytics] View tracked successfully, id=${data?.[0]?.id || 'unknown'}`);
    },

    // Track a custom event
    async trackEvent(
        userId: string,
        eventType: string,
        linkId?: string,
        productId?: string
    ): Promise<void> {
        console.log(`📊 [Analytics] trackEvent: type=${eventType}, userId=${userId}`);
        const payload = {
            user_id: userId,
            link_id: linkId || null,
            product_id: productId || null,
            type: eventType
        };

        const { data, error } = await supabase
            .from('clicks')
            .insert(payload)
            .select();

        if (error) {
            console.error('❌ [Analytics] trackEvent FAILED:', JSON.stringify(error));
            throw new Error(`Failed to track event: ${error.message}`);
        }

        console.log(`✅ [Analytics] Event tracked successfully, id=${data?.[0]?.id || 'unknown'}`);
    },

    // Diagnostic: check if the clicks table is accessible
    async getEventCount(userId: string): Promise<number> {
        const { count, error } = await supabase
            .from('clicks')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        if (error) {
            console.error('❌ [Analytics] getEventCount FAILED:', JSON.stringify(error));
            return -1;
        }

        return count || 0;
    }
};
