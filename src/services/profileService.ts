import { supabase } from '../config/supabaseClient.js';
import { UserProfile, UserProfileDB, dbToApi, apiToDb } from '../models/types.js';
import { linkService } from './linkService.js';
import { productService } from './productService.js';

export const profileService = {
    // Helper to attach active integrations to a profile
    async _attachIntegrations(profile: UserProfile): Promise<UserProfile> {
        if (!profile.id) return profile;

        const { data: integrations } = await supabase
            .from('social_integrations')
            .select('provider, profile_data')
            .eq('user_id', profile.id);

        if (integrations) {
            profile.integrations = integrations;
        }

        return profile;
    },

    // Get profile by username (public access)
    async getProfileByUsername(username: string): Promise<UserProfile | null> {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .ilike('username', username)
            .single();

        if (error) {
            console.error('Error fetching profile by username:', error);
            return null;
        }

        const profile = dbToApi(data as UserProfileDB);
        return await this._attachIntegrations(profile);
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

        const profile = dbToApi(data as UserProfileDB);
        return await this._attachIntegrations(profile);
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

        const profile = dbToApi(data as UserProfileDB);
        return await this._attachIntegrations(profile);
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

        const profile = dbToApi(data as UserProfileDB);
        return await this._attachIntegrations(profile);
    },

    // Check username availability
    async isUsernameAvailable(username: string): Promise<boolean> {
        const { data, error } = await supabase
            .from('users')
            .select('username')
            .ilike('username', username)
            .maybeSingle();

        if (error) {
            console.error('Error checking username:', error);
            return false;
        }

        return !data; // Available if no data found
    },

    // Bootstrap data for Editor (Profile + Links + Products)
    async getBootstrapData(userId: string) {
        // Run all queries in parallel for maximum speed
        const [profile, links, products] = await Promise.all([
            this.getProfileByUserId(userId),
            linkService.getLinksByProfileId(userId),
            productService.getProductsByProfileId(userId)
        ]);

        return {
            profile,
            links,
            products
        };
    },

    // Public Bootstrap (Profile + Links + Products) by username
    async getPublicBootstrapData(username: string) {
        // 1. Get profile first as we need the user_id for links/products
        const profile = await this.getProfileByUsername(username);
        if (!profile) return null;

        // 2. Fetch links and products in parallel using the user_id
        const [links, products] = await Promise.all([
            linkService.getLinksByProfileId(profile.id!, true),
            productService.getProductsByProfileId(profile.id!)
        ]);

        return {
            profile,
            links,
            products
        };
    }
};
