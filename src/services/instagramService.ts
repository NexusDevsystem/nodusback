import { supabase } from '../config/supabaseClient.js';
import { SocialIntegrationDB } from '../models/types.js';

const APP_ID = process.env.INSTAGRAM_APP_ID;
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET;
const REDIRECT_URI = process.env.INSTAGRAM_REDIRECT_URI;

/**
 * Generates the Instagram Login (for Business/Professional) Auth URL
 * This allows professional accounts to login directly via Instagram without a Facebook Page.
 */
export const getAuthUrl = (userId: string, origin?: string) => {
    const csrfState = Math.random().toString(36).substring(7);
    const state = `${csrfState}_${userId}_${origin || 'production'}`;

    // Scopes for Instagram Login for Business
    const scopes = [
        'instagram_business_basic',
        'instagram_business_manage_messages',
        'instagram_business_manage_comments',
        'instagram_business_content_publish',
        'instagram_business_manage_insights'
    ].join(',');

    const baseUrl = 'https://www.instagram.com/oauth/authorize';
    const params = new URLSearchParams({
        client_id: APP_ID || '',
        redirect_uri: REDIRECT_URI || '',
        scope: scopes,
        response_type: 'code',
        state: state
    });

    return `${baseUrl}?${params.toString()}`;
};

/**
 * Handles the OAuth callback for Instagram Login (Professional)
 */
export const handleCallback = async (code: string, userId: string): Promise<SocialIntegrationDB | null> => {
    try {
        console.log(`[InstagramService] Handling Instagram Login callback for user ${userId}...`);

        // 1. Exchange short-lived token
        const params = new URLSearchParams();
        params.append('client_id', APP_ID || '');
        params.append('client_secret', APP_SECRET || '');
        params.append('grant_type', 'authorization_code');
        params.append('redirect_uri', REDIRECT_URI || '');
        params.append('code', code);

        const tokenResponse = await fetch('https://api.instagram.com/oauth/access_token', {
            method: 'POST',
            body: params
        });

        const tokenData = await tokenResponse.json() as any;

        if (tokenData.error_message || tokenData.error) {
            throw new Error(`Instagram Token Error: ${tokenData.error_message || tokenData.error.message || JSON.stringify(tokenData.error)}`);
        }

        let accessToken = tokenData.access_token;
        const igUserId = tokenData.user_id;

        // 2. Exchange for Long-Lived Token (60 days)
        try {
            const longLivedUrl = `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${APP_SECRET}&access_token=${accessToken}`;
            const longLivedRes = await fetch(longLivedUrl);
            const longLivedData = await longLivedRes.json() as any;

            if (longLivedData.access_token) {
                accessToken = longLivedData.access_token;
                console.log('[InstagramService] Long-lived token acquired via Instagram Login');
            }
        } catch (err) {
            console.warn('[InstagramService] Long-lived token exchange failed:', err);
        }

        // 3. Get User Profile via Instagram Graph API (Specific for Instagram Login tokens)
        // Note: For Instagram Login, we use graph.instagram.com/me even for professional data
        const profileFields = 'id,username,name,profile_picture_url,followers_count';
        const profileUrl = `https://graph.instagram.com/me?fields=${profileFields}&access_token=${accessToken}`;

        console.log('[InstagramService] Fetching profile from:', profileUrl.split('access_token=')[0] + 'access_token=***');

        const profileRes = await fetch(profileUrl);
        const profileDataRaw = await profileRes.json() as any;

        if (profileDataRaw.error) {
            console.error('[InstagramService] Profile API Error:', profileDataRaw.error);
            // Don't throw here, try to use what we have or fallbacks to avoid blocking the integration
        }

        console.log('[InstagramService] Raw profile data received:', JSON.stringify(profileDataRaw));

        const profileData = {
            username: profileDataRaw.username || 'instagram_user',
            avatar_url: profileDataRaw.profile_picture_url || null,
            follower_count: profileDataRaw.followers_count || null,
            channel_id: profileDataRaw.id || igUserId,
        };

        const integrationData: SocialIntegrationDB = {
            user_id: userId,
            provider: 'instagram',
            access_token: accessToken,
            profile_data: profileData,
            expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() // ~60 days
        };

        const { data, error } = await supabase
            .from('social_integrations')
            .upsert(integrationData, { onConflict: 'user_id,provider' })
            .select()
            .single();

        if (error) throw error;

        // Run sync in background
        syncFeed(userId).catch(syncError => {
            console.error('[InstagramService] Initial sync failed:', syncError);
        });

        return data;
    } catch (error) {
        console.error('[InstagramService] Auth Error:', error);
        throw error;
    }
};

/**
 * Switch the active Instagram account for an existing integration
 */
export const switchInstagramAccount = async (userId: string, channelId: string) => {
    try {
        const { data: integration, error } = await supabase
            .from('social_integrations')
            .select('*')
            .eq('user_id', userId)
            .eq('provider', 'instagram')
            .single();

        if (error || !integration) throw new Error('Integration not found');

        const available = integration.profile_data.available_accounts || [];
        const newAccount = available.find((acc: any) => acc.channel_id === channelId);

        if (!newAccount) throw new Error('Account not found in available list');

        const updatedProfileData = {
            ...integration.profile_data,
            username: newAccount.username,
            avatar_url: newAccount.avatar_url,
            follower_count: newAccount.follower_count,
            channel_id: newAccount.channel_id
        };

        // Update integration
        const { error: updateError } = await supabase
            .from('social_integrations')
            .update({ profile_data: updatedProfileData })
            .eq('id', integration.id);

        if (updateError) throw updateError;

        // Clear existing Instagram links to prevent overlap
        const { data: collection } = await supabase
            .from('links')
            .select('id')
            .eq('user_id', userId)
            .eq('platform', 'instagram')
            .limit(1)
            .maybeSingle();

        if (collection) {
            await supabase
                .from('links')
                .delete()
                .eq('parent_id', collection.id);
        }

        // Trigger sync for the new account
        await syncFeed(userId);

        return updatedProfileData;
    } catch (error) {
        console.error('Error switching Instagram account:', error);
        throw error;
    }
};

/**
 * Syncs the Instagram media feed for Instagram Login (Professional) API
 */
export const syncFeed = async (userId: string) => {
    try {
        const { data: integration, error } = await supabase
            .from('social_integrations')
            .select('*')
            .eq('user_id', userId)
            .eq('provider', 'instagram')
            .single();

        if (error || !integration) throw new Error('Instagram integration not found');

        // Fetch media from Instagram Graph API (Specific for Instagram Login tokens)
        // Note: For Instagram Login, we use graph.instagram.com/me/media even for professional data
        const mediaUrl = `https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp&access_token=${integration.access_token}&limit=24`;

        console.log('[InstagramService] Syncing media from:', mediaUrl.split('access_token=')[0] + 'access_token=***');

        // 0. Fetch latest profile info (followers, etc.)
        const profileFields = 'id,username,name,profile_picture_url,followers_count';
        const profileUrl = `https://graph.instagram.com/me?fields=${profileFields}&access_token=${integration.access_token}`;
        const profileRes = await fetch(profileUrl);
        const profileDataRaw = await profileRes.json() as any;

        const mediaRes = await fetch(mediaUrl);
        const mediaData = await mediaRes.json() as any;
        const mediaList = mediaData.data || [];

        // Update profile data in the integration
        const updatedProfile = {
            ...integration.profile_data,
            username: profileDataRaw.username || integration.profile_data.username,
            avatar_url: profileDataRaw.profile_picture_url || integration.profile_data.avatar_url,
            follower_count: profileDataRaw.followers_count || integration.profile_data.follower_count,
            media: mediaList
        };

        if (mediaList.length === 0 && !profileDataRaw.followers_count) {
            // If no media and no new follower count, just update the timestamp and profile data
            await supabase
                .from('social_integrations')
                .update({
                    profile_data: updatedProfile,
                    updated_at: new Date().toISOString()
                })
                .eq('id', integration.id);
            return [];
        }

        // 1. Ensure "Posts do Instagram" collection exists
        let collectionId: string;
        let { data: existingCollection } = await supabase
            .from('links')
            .select('id, type')
            .eq('user_id', userId)
            .eq('platform', 'instagram')
            .limit(1)
            .maybeSingle();

        // Fallback to title if platform tag is missing
        if (!existingCollection) {
            const { data: byTitle } = await supabase
                .from('links')
                .select('id, type')
                .eq('user_id', userId)
                .eq('title', 'Posts do Instagram')
                .eq('type', 'collection')
                .limit(1)
                .maybeSingle();
            existingCollection = byTitle;
        }

        if (existingCollection) {
            collectionId = existingCollection.id;
            // Ensure platform tag is set
            await supabase
                .from('links')
                .update({ platform: 'instagram' })
                .eq('id', collectionId);
        } else {
            const { data: newCollection, error: collError } = await supabase
                .from('links')
                .insert({
                    user_id: userId,
                    title: 'Instagram',
                    url: `https://instagram.com/${updatedProfile.username}`,
                    is_active: true,
                    is_archived: false,
                    type: 'link',
                    platform: 'instagram',
                    layout: 'classic',
                    position: 0
                })
                .select()
                .single();

            if (collError) throw collError;
            collectionId = newCollection.id;
        }

        // 2. Save media as links within that collection
        for (const media of mediaList) {
            const linkData = {
                user_id: userId,
                parent_id: collectionId,
                title: media.caption ? media.caption.substring(0, 50) : 'Post no Instagram',
                url: media.permalink,
                is_active: true,
                is_archived: false,
                layout: 'card',
                type: 'social',
                platform: 'instagram',
                video_url: media.media_type === 'VIDEO' ? media.media_url : null,
                icon: media.media_type === 'VIDEO' ? media.thumbnail_url : media.media_url
            };

            // Check if link already exists
            const { data: existing } = await supabase
                .from('links')
                .select('id')
                .eq('user_id', userId)
                .eq('url', media.permalink)
                .maybeSingle();

            if (existing) {
                // Update existing post info to reflect caption/thumb changes
                await supabase
                    .from('links')
                    .update({
                        title: linkData.title,
                        icon: linkData.icon,
                        video_url: linkData.video_url
                    })
                    .eq('id', existing.id);
            } else {
                await supabase.from('links').insert(linkData);
            }
        }

        // 3. Update the integration profile_data with the latest media for the rich card
        const updatedProfileData = {
            ...integration.profile_data,
            username: profileDataRaw.username || integration.profile_data.username,
            avatar_url: profileDataRaw.profile_picture_url || integration.profile_data.avatar_url,
            follower_count: profileDataRaw.followers_count || integration.profile_data.follower_count,
            media: mediaList
        };

        await supabase
            .from('social_integrations')
            .update({
                profile_data: updatedProfileData,
                updated_at: new Date().toISOString()
            })
            .eq('id', integration.id);

        // 4. Also sync to the main 'users' table so the frontend sees it immediately in the profile object
        const { data: allIntegrations } = await supabase
            .from('social_integrations')
            .select('provider, profile_data')
            .eq('user_id', userId);

        if (allIntegrations) {
            await supabase
                .from('users')
                .update({ integrations: allIntegrations })
                .eq('id', userId);
        }

        return mediaList;
    } catch (error) {
        console.error('Error syncing Instagram feed:', error);
        throw error;
    }
};

/**
 * Checks if a sync is needed and triggers it in the background
 */
export const checkAndSync = async (userId: string) => {
    try {
        const { data: integration } = await supabase
            .from('social_integrations')
            .select('id, updated_at')
            .eq('user_id', userId)
            .eq('provider', 'instagram')
            .maybeSingle();

        if (!integration) return;

        const lastSync = integration.updated_at ? new Date(integration.updated_at) : new Date(0);
        const now = new Date();
        const diffMinutes = Math.floor((now.getTime() - lastSync.getTime()) / (1000 * 60));

        // Sync if older than 60 minutes
        if (diffMinutes >= 60) {
            console.log(`[InstagramService] Auto-syncing for user ${userId} (Last sync: ${diffMinutes}m ago)`);
            syncFeed(userId).catch(err => console.error('[InstagramService] Background sync error:', err));
        }
    } catch (err) {
        console.error('[InstagramService] Sync check error:', err);
    }
};
