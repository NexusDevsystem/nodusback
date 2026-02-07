import { supabase } from '../config/supabaseClient.js';
import { AnalyticsEvent } from '../models/types.js';

export const analyticsService = {
    // Get all analytics for a profile (by user_id)
    async getAnalyticsByProfileId(userId: string): Promise<AnalyticsEvent[]> {
        const { data, error } = await supabase
            .from('clicks')
            .select('*')
            .eq('user_id', userId)  // FK to users(id)
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
