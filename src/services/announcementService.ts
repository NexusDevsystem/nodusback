import { supabase } from '../config/supabaseClient.js';
import { announcementDbToApi, AnnouncementDB } from '../models/types.js';

export const announcementService = {
    async getActiveAnnouncement(userId?: string, userEmail?: string) {
        // We need to find active announcements that this user hasn't seen yet
        let query = supabase
            .from('announcements')
            .select('*, announcement_views!left(user_id)')
            .eq('is_active', true);

        if (userEmail) {
            query = query.or(`target_user_email.is.null,target_user_email.eq.${userEmail}`);
        } else {
            query = query.is('target_user_email', null);
        }

        // Filter out announcements where there is a view record for this user
        if (userId) {
            query = query.is('announcement_views.user_id', null);
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
            .select('*')
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
