import { supabase } from '../config/supabaseClient.js';
// import { NewsletterLead } from '../models/types.js';

export const leadService = {
    // Get all leads for a profile (by user_id)
    async getLeadsByProfileId(userId: string): Promise<any[]> {
        const { data, error } = await supabase
            .from('leads')
            .select('*')
            .eq('user_id', userId)  // FK to users(id)
            .order('timestamp', { ascending: false });

        if (error) {
            console.error('Error fetching leads:', error);
            return [];
        }

        return (data || []) as any[];
    },

    // Create a new lead
    async createLead(userId: string, email: string, name?: string): Promise<any | null> {
        const { data: profile, error: profileError } = await supabase
            .from('users')
            .select('id')
            .eq('id', userId)
            .maybeSingle();

        if (profileError || !profile) {
            if (profileError) console.error('Error validating lead profile:', profileError);
            return null;
        }

        const { data, error } = await supabase
            .from('leads')
            .insert({
                user_id: userId,
                email,
                name,
            })
            .select('id, email, name, timestamp')
            .single();

        if (error) {
            console.error('Error creating lead:', error);
            return null;
        }

        return data as any;
    },

    // Delete a lead
    async deleteLead(userId: string, leadId: string): Promise<boolean> {
        const { data, error } = await supabase
            .from('leads')
            .delete()
            .eq('id', leadId)
            .eq('user_id', userId)
            .select('id')
            .maybeSingle();

        if (error) {
            console.error('Error deleting lead:', error);
            return false;
        }

        return Boolean(data);
    }
};
