import { supabase } from '../config/supabaseClient.js';
import { announcementDbToApi, AnnouncementDB } from '../models/types.js';

export const announcementService = {
    async getActiveAnnouncement(userId?: string, userEmail?: string) {
        // Filter to announcements not seen by this user
        let query = supabase
            .from('announcements')
            .select(`
                *,
                blog_posts(slug),
                announcement_views!left(user_id)
            `)
            .eq('is_active', true);

        if (userId) {
            // Only join views for the current user
            query = query.filter('announcement_views.user_id', 'eq', userId);
            // Then check that no such view exists
            query = query.is('announcement_views.user_id', null);
        }
        
        if (userEmail) {
            query = query.or(`target_user_email.is.null,target_user_email.eq.${userEmail}`);
        } else {
            query = query.is('target_user_email', null);
        }

        const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        if (!data) return null;

        return announcementDbToApi(data as AnnouncementDB);
    },

    async dismiss(announcementId: string, userId: string) {
        const { error } = await supabase
            .from('announcement_views')
            .insert([{ announcement_id: announcementId, user_id: userId }]);

        if (error && error.code !== '23505') { // Ignore unique constraint violation (already dismissed)
            throw error;
        }
        return true;
    },

    async getAll() {
        const { data, error } = await supabase
            .from('announcements')
            .select('*, blog_posts(slug)')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return (data as AnnouncementDB[]).map(announcementDbToApi);
    },

    async create(announcement: any) {
        const { data, error } = await supabase
            .from('announcements')
            .insert([announcement])
            .select()
            .single();

        if (error) throw error;
        return announcementDbToApi(data as AnnouncementDB);
    },

    async update(id: string, updates: any) {
        const { data, error } = await supabase
            .from('announcements')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return announcementDbToApi(data as AnnouncementDB);
    },

    async delete(id: string) {
        const { error } = await supabase
            .from('announcements')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return true;
    }
};
