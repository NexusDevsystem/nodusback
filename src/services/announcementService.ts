import { supabase } from '../config/supabaseClient.js';
import { announcementDbToApi, AnnouncementDB } from '../models/types.js';

export const announcementService = {
    async getActiveAnnouncement(userEmail?: string) {
        let query = supabase
            .from('announcements')
            .select('*')
            .eq('is_active', true);

        if (userEmail) {
            // Find announcements that are either for this specific user OR global (null)
            query = query.or(`target_user_email.is.null,target_user_email.eq.${userEmail}`);
            // Prioritize specific user announcements over global ones
            query = query.order('target_user_email', { ascending: false, nullsFirst: false });
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
