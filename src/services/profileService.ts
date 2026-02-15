import { supabase } from '../config/supabaseClient.js';
import { UserProfile, UserProfileDB, dbToApi, apiToDb } from '../models/types.js';

export const profileService = {
    // Get profile by username (public access)
    async getProfileByUsername(username: string): Promise<UserProfile | null> {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .single();

        if (error) {
            console.error('Error fetching profile by username:', error);
            return null;
        }

        return dbToApi(data as UserProfileDB);
    },

    // Get profile by user_id (authenticated access)
    async getProfileByUserId(userId: string): Promise<UserProfile | null> {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) {
            console.error('Error fetching profile by user_id:', error);
            return null;
        }

        return dbToApi(data as UserProfileDB);
    },

    // Get profile by email
    async getProfileByEmail(email: string): Promise<UserProfile | null> {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .maybeSingle();

        if (error) {
            console.error('Error fetching profile by email:', error);
            return null;
        }

        return data ? dbToApi(data as UserProfileDB) : null;
    },

    // Get profile by stripe_customer_id
    async getProfileByStripeCustomerId(customerId: string): Promise<UserProfile | null> {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('stripe_customer_id', customerId)
            .maybeSingle();

        if (error) {
            console.error('Error fetching profile by stripe_customer_id:', error);
            return null;
        }

        return data ? dbToApi(data as UserProfileDB) : null;
    },

    // Update profile
    async updateProfile(userId: string, updates: Partial<UserProfile>): Promise<UserProfile | null> {
        const dbUpdates = apiToDb(updates);

        const { data, error } = await supabase
            .from('users')
            .update(dbUpdates)
            .eq('id', userId)
            .select()
            .single();

        if (error) {
            console.error('Error updating profile:', error);
            return null;
        }

        return dbToApi(data as UserProfileDB);
    },

    // Create profile
    async createProfile(userId: string, profileData: Partial<UserProfile>): Promise<UserProfile | null> {
        // Convert camelCase to snake_case for database
        const dbData = apiToDb(profileData);
        dbData.id = userId;

        // Default settings
        // if (dbData.show_newsletter === undefined) {
        //     dbData.show_newsletter = false;
        // }

        const { data, error } = await supabase
            .from('users')
            .insert(dbData)
            .select()
            .single();

        if (error) {
            console.error('Error creating profile:', error);
            return null;
        }

        return dbToApi(data as UserProfileDB);
    },

    // Check username availability
    async isUsernameAvailable(username: string): Promise<boolean> {
        const { data, error } = await supabase
            .from('users')
            .select('username')
            .eq('username', username)
            .maybeSingle();

        if (error) {
            console.error('Error checking username:', error);
            return false;
        }

        return !data; // Available if no data found
    }
};
