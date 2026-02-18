import { supabase } from '../config/supabaseClient.js';
import { SocialIntegrationDB } from '../models/types.js';

const APP_ID = process.env.INSTAGRAM_APP_ID;
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET;
const REDIRECT_URI = process.env.INSTAGRAM_REDIRECT_URI;

/**
 * Generates the Instagram Basic Display Auth URL
 */
export const getAuthUrl = (userId: string, origin?: string) => {
    const csrfState = Math.random().toString(36).substring(7);
    const state = `${csrfState}_${userId}_${origin || 'production'}`;

    // Scopes for Instagram Basic Display
    const scopes = [
        'user_profile',
        'user_media'
    ].join(',');

    const baseUrl = 'https://api.instagram.com/oauth/authorize';
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
 * Handles the OAuth callback for Instagram Basic Display
 */
export const handleCallback = async (code: string, userId: string): Promise<SocialIntegrationDB | null> => {
    try {
        console.log(`[InstagramService] Handling callback for user ${userId} with code ${code.substring(0, 10)}...`);

        // 1. Exchange short-lived token (POST request)
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
            throw new Error(`Instagram Token Error: ${tokenData.error_message || tokenData.error.message}`);
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
                console.log('[InstagramService] Long-lived token acquired');
            }
        } catch (err) {
            console.warn('[InstagramService] Long-lived token exchange failed, using short-lived token:', err);
        }

        // 3. Get User Profile
        const profileUrl = `https://graph.instagram.com/me?fields=id,username,account_type&access_token=${accessToken}`;
        const profileRes = await fetch(profileUrl);
        const profileDataRaw = await profileRes.json() as any;

        if (profileDataRaw.error) {
            throw new Error(`Instagram Profile Error: ${profileDataRaw.error.message}`);
        }

        const profileData = {
            username: profileDataRaw.username,
            avatar_url: null, // Basic Display API doesn't provide profile picture URL easily
            follower_count: null, // Not available in Basic Display
            channel_id: profileDataRaw.id,
            account_type: profileDataRaw.account_type
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
            .eq('title', 'Posts do Instagram')
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
 * Syncs the Instagram media feed for Basic Display API
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

        // Fetch media from Instagram Basic Display API
        const mediaUrl = `https://graph.instagram.com/me/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp&access_token=${integration.access_token}&limit=12`;
        const response = await fetch(mediaUrl);
        const data = (await response.json()) as any;

        if (data.error) {
            console.error('[InstagramService] Sync API error:', data.error);
            return;
        }

        const mediaList = data.data || [];
        if (mediaList.length === 0) return [];

        // 1. Ensure "Posts do Instagram" collection exists
        let collectionId: string;
        const { data: existingCollection } = await supabase
            .from('links')
            .select('id')
            .eq('user_id', userId)
            .eq('title', 'Posts do Instagram')
            .eq('type', 'collection')
            .maybeSingle();

        if (existingCollection) {
            collectionId = existingCollection.id;
            // Retroactively tag existing collections so the frontend filter works
            await supabase
                .from('links')
                .update({ platform: 'instagram' })
                .eq('id', collectionId);
        } else {
            const { data: newCollection, error: collError } = await supabase
                .from('links')
                .insert({
                    user_id: userId,
                    title: 'Posts do Instagram',
                    url: '#',
                    is_active: true,
                    is_archived: false,
                    type: 'collection',
                    platform: 'instagram',
                    layout: 'grid', // Useful for showing posts in a grid when clicked
                    position: 0 // Place at top for visibility
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

            if (!existing) {
                await supabase.from('links').insert(linkData);
            }
        }

        // 3. Update the integration profile_data with the latest media for the rich card
        const updatedProfileData = {
            ...integration.profile_data,
            media: mediaList
        };

        await supabase
            .from('social_integrations')
            .update({ profile_data: updatedProfileData })
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
