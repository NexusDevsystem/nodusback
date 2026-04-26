import { supabase } from '../config/supabaseClient.js';
import { UserProfile, UserProfileDB, dbToApi, apiToDb } from '../models/types.js';
import { linkService } from './linkService.js';
import { productService } from './productService.js';
import { storeService } from './storeService.js';
import * as instagramService from './instagramService.js';
import * as tiktokService from './tiktokService.js';
import * as twitchService from './twitchService.js';
import * as kickService from './kickService.js';
import * as youtubeService from './youtubeService.js';
import { enforcePlanRestrictions } from './planGuard.js';

export const profileService = {
    // Helper to check and react to plan expiration (Business Rules - Nodus.my)
    _checkPlanExpiration(profile: UserProfile): UserProfile {
        if (profile.plan_type && profile.plan_type !== 'free' && profile.subscriptionExpiryDate) {
            const expiry = new Date(profile.subscriptionExpiryDate).getTime();
            const now = Date.now();

            // REGRA: Usuários que cancelaram voluntariamente não têm carência.
            // Usuários ativos (aguardando PIX) têm 3 dias de carência.
            const gracePeriodDays = profile.subscriptionStatus === 'canceled' ? 0 : 3;
            const gracePeriodMs = gracePeriodDays * 24 * 60 * 60 * 1000;

            if (now > (expiry + gracePeriodMs)) {
                console.log(`[ProfileService] Plan expired/downgraded for user ${profile.id} (${profile.username}).`);
                
                // SOFT DOWNGRADE: Mudamos o plano mas não deletamos dados
                profile.plan_type = 'free';
                profile.subscriptionStatus = 'expired';

                // Disparar atualização assíncrona no banco para persistir o downgrade
                supabase
                    .from('users')
                    .update({ 
                        plan_type: 'free', 
                        subscription_status: 'expired' 
                    })
                    .eq('id', profile.id)
                    .then(({ error }) => {
                        if (error) console.error(`[ProfileService] Error persisting downgrade for ${profile.id}:`, error.message);
                    });
            }
        }
        return profile;
    },

    // Helper to attach active integrations to a profile
    async _attachIntegrations(profile: UserProfile, triggerSync: boolean = true): Promise<UserProfile> {
        if (!profile.id) return profile;

        const { data: integrations } = await supabase
            .from('social_integrations')
            .select('provider, provider_account_id, profile_data')
            .eq('user_id', profile.id);

        if (integrations) {
            profile.integrations = integrations;
        }

        // Trigger background sync for social data if needed
        if (profile.id && triggerSync) {
            instagramService.checkAndSync(profile.id).catch((e: any) => console.error('[InstagramSync] Failed:', e));
            tiktokService.checkAndSync(profile.id).catch((e: any) => console.error('[TikTokSync] Failed:', e));
            twitchService.checkAndSync(profile.id).catch((e: any) => console.error('[TwitchSync] Failed:', e));
            kickService.checkAndSync(profile.id).catch((e: any) => console.error('[KickSync] Failed:', e));
            youtubeService.checkAndSync(profile.id).catch((e: any) => console.error('[YouTubeSync] Failed:', e));
        }

        return profile;
    },

    // Get profile by username (public access)
    async getProfileByUsername(username: string, triggerSync: boolean = true): Promise<UserProfile | null> {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .ilike('username', username)
            .maybeSingle();

        if (error) {
            console.error('Error fetching profile by username:', error);
            return null;
        }

        if (!data) return null;
        
        // View counting is now handled exclusively by the trackPageView endpoint 
        // to ensure uniqueness and prevent counting preview/admin views.

        const profile = profileService._checkPlanExpiration(dbToApi(data as UserProfileDB));
        return await profileService._attachIntegrations(profile, triggerSync);
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

        const profile = profileService._checkPlanExpiration(dbToApi(data as UserProfileDB));
        return await profileService._attachIntegrations(profile);
    },

    // Get profile by email
    async getProfileByEmail(email: string): Promise<UserProfile | null> {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .ilike('email', email)
            .maybeSingle();

        if (error) {
            console.error('Error fetching profile by email:', error);
            return null;
        }

        return data ? this._checkPlanExpiration(dbToApi(data as UserProfileDB)) : null;
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

        return data ? this._checkPlanExpiration(dbToApi(data as UserProfileDB)) : null;
    },

    // Update profile
    async updateProfile(userId: string, updates: Partial<UserProfile>): Promise<UserProfile | null> {
        console.log(`[ProfileService] Updating profile for user ${userId}:`, JSON.stringify(updates));

        // ── Step 1: Load the current profile from DB ──────────────────────────
        // We always need the current profile to:
        //   a) Enforce the username 7-day rule
        //   b) Read the authoritative plan_type (NEVER trust the client for this)
        const currentProfile = await this.getProfileByUserId(userId);

        // ── Step 2: Enforce plan restrictions BEFORE touching anything ────────
        // This strips PRO-only fields from `updates` if the user is FREE.
        // This happens server-side and cannot be bypassed by the client.
        const guardResult = enforcePlanRestrictions(currentProfile?.plan_type, updates as Record<string, any>);
        if (guardResult.strippedFields.length > 0) {
            console.warn(
                `[PlanGuard] Stripped PRO fields from userId=${userId} (plan=${currentProfile?.plan_type}): ` +
                guardResult.strippedFields.join(', ')
            );
        }

        // ── Step 3: Username 7-day restriction ───────────────────────────────
        if (updates.username) {
            if (currentProfile && currentProfile.username && currentProfile.username.toLowerCase() !== updates.username.toLowerCase()) {
                if (currentProfile.usernameUpdatedAt) {
                    const lastUpdate = new Date(currentProfile.usernameUpdatedAt);
                    const now = new Date();
                    const diffDays = Math.ceil((now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60 * 24));

                    if (diffDays < 7) {
                        const remainingDays = 7 - diffDays;
                        throw new Error(`O nome de usuário só pode ser alterado a cada 7 dias. Faltam ${remainingDays} ${remainingDays === 1 ? 'dia' : 'dias'}.`);
                    }
                }
                updates.usernameUpdatedAt = new Date().toISOString();
            }
        }

        const dbUpdates = apiToDb(updates);

        // ── Step 4: ONBOARDING: Track profile pic ───────────────────────────
        if (updates.avatarUrl !== undefined) {
            dbUpdates.has_profile_pic = !!updates.avatarUrl;
        }

        console.log(`[ProfileService] Converted DB updates for ${userId}:`, JSON.stringify(dbUpdates));

        const { data, error } = await supabase
            .from('users')
            .update(dbUpdates)
            .eq('id', userId)
            .select()
            .single();

        if (error) {
            console.error(`[ProfileService] Error updating user ${userId}:`, error.message);
            return null;
        }

        if (!data) {
            console.error(`[ProfileService] No data returned after update for user ${userId}`);
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
    async isUsernameAvailable(username: string, excludeUserId?: string): Promise<boolean> {
        let query = supabase
            .from('users')
            .select('id, username')
            .ilike('username', username);

        if (excludeUserId) {
            query = query.neq('id', excludeUserId);
        }

        const { data, error } = await query.maybeSingle();

        if (error) {
            console.error('Error checking username:', error);
            return false;
        }

        return !data; // Available if no data found (or if data found is from the excluded user)
    },

    // Bootstrap data for Editor (Profile + Links + Products + Stores)
    async getBootstrapData(userId: string) {
        // Run all queries in parallel for maximum speed
        const [profile, links, products, stores] = await Promise.all([
            profileService.getProfileByUserId(userId),
            linkService.getLinksByProfileId(userId, false),
            productService.getProductsByProfileId(userId, false),
            storeService.getStoresByProfileId(userId, false)
        ]);

        return {
            profile,
            links,
            products,
            stores
        };
    },

    // Public Bootstrap (Profile + Links + Products + Stores) by username
    async getPublicBootstrapData(username: string) {
        // 1. Get profile first as we need the user_id for links/products
        // Now passing true to permit background social syncing for public views if data is stale
        const profile = await profileService.getProfileByUsername(username, true);
        if (!profile) return null;

        // 2. Fetch links, products and stores in parallel using the user_id (publicView = true)
        const [links, products, stores] = await Promise.all([
            linkService.getLinksByProfileId(profile.id!, true),
            productService.getProductsByProfileId(profile.id!, true),
            storeService.getStoresByProfileId(profile.id!, true)
        ]);

        return {
            profile,
            links,
            products,
            stores
        };
    },

    // Like a profile by username
    async likeProfile(username: string): Promise<number | null> {
        // 1. Find profile first
        const { data: profile, error: findError } = await supabase
            .from('users')
            .select('id')
            .ilike('username', username)
            .maybeSingle();

        if (findError || !profile) return null;

        // 2. Increment likes using RPC (atomic)
        const { error: rpcError } = await supabase.rpc('increment_profile_likes', { 
            profile_id: profile.id 
        });

        if (rpcError) {
            console.error('Error in likeProfile RPC:', rpcError);
            throw rpcError;
        }

        // Return the NEW like count
        const { data: updatedProfile } = await supabase
            .from('users')
            .select('likes_count')
            .eq('id', profile.id)
            .single();

        return updatedProfile?.likes_count || 0;
    }
};
