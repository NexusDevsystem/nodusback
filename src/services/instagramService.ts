import { supabase } from '../config/supabaseClient.js';
import { SocialIntegrationDB } from '../models/types.js';

const APP_ID = process.env.INSTAGRAM_APP_ID;
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET;
const REDIRECT_URI = process.env.INSTAGRAM_REDIRECT_URI;

/**
 * Generates the Instagram Professional Auth URL (via Facebook Login)
 */
export const getAuthUrl = (userId: string, origin?: string) => {
    const csrfState = Math.random().toString(36).substring(7);
    const state = `${csrfState}_${userId}_${origin || 'production'}`;

    // Scopes for Instagram Professional (via Facebook Login)
    const scopes = [
        'instagram_basic',
        'pages_show_list',
        'pages_read_engagement',
        'public_profile'
    ].join(',');

    const baseUrl = 'https://www.facebook.com/v18.0/dialog/oauth';
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
 * Handles the OAuth callback for Professional API (Facebook)
 */
export const handleCallback = async (code: string, userId: string): Promise<SocialIntegrationDB | null> => {
    try {
        const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${APP_ID}&redirect_uri=${REDIRECT_URI}&client_secret=${APP_SECRET}&code=${code}`;
        const tokenResponse = await fetch(tokenUrl);
        const tokenData = await tokenResponse.json() as any;

        if (tokenData.error) {
            throw new Error(`Facebook Token Error: ${tokenData.error.message}`);
        }

        const userAccessToken = tokenData.access_token;

        const pagesUrl = `https://graph.facebook.com/v18.0/me/accounts?access_token=${userAccessToken}`;
        const pagesResponse = await fetch(pagesUrl);
        const pagesData = await pagesResponse.json() as any;

        if (!pagesData.data || pagesData.data.length === 0) {
            throw new Error('No Facebook pages found. Make sure your Instagram is linked to a Facebook Page.');
        }

        const availableAccounts: any[] = [];

        for (const page of pagesData.data) {
            const igUrl = `https://graph.facebook.com/v18.0/${page.id}?fields=instagram_business_account&access_token=${userAccessToken}`;
            const igResponse = await fetch(igUrl);
            const igData = await igResponse.json() as any;

            if (igData.instagram_business_account) {
                const igId = igData.instagram_business_account.id;
                const profileUrl = `https://graph.facebook.com/v18.0/${igId}?fields=username,profile_picture_url,followers_count&access_token=${userAccessToken}`;
                const profileRes = await fetch(profileUrl);
                const profile = await profileRes.json() as any;

                availableAccounts.push({
                    username: profile.username,
                    avatar_url: profile.profile_picture_url,
                    follower_count: profile.followers_count,
                    channel_id: igId,
                    page_id: page.id
                });
            }
        }

        if (availableAccounts.length === 0) {
            throw new Error('No Instagram Business Accounts linked to your Facebook Pages.');
        }

        // Default to the first account
        const activeAccount = availableAccounts[0];

        const profileData = {
            username: activeAccount.username,
            avatar_url: activeAccount.avatar_url,
            follower_count: activeAccount.follower_count,
            channel_id: activeAccount.channel_id,
            available_accounts: availableAccounts // Store all for selection
        };

        const integrationData: SocialIntegrationDB = {
            user_id: userId,
            provider: 'instagram',
            access_token: userAccessToken,
            profile_data: profileData
        };

        const { data, error } = await supabase
            .from('social_integrations')
            .upsert(integrationData, { onConflict: 'user_id,provider' })
            .select()
            .single();

        if (error) throw error;

        await syncFeed(userId);

        return data;
    } catch (error) {
        console.error('Instagram Auth Error:', error);
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
 * Syncs the Instagram media feed to the 'links' table as social links
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

        // Fetch media from Instagram Graph API (Professional)
        const igUserId = integration.profile_data.channel_id;
        const mediaUrl = `https://graph.facebook.com/v18.0/${igUserId}/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp&access_token=${integration.access_token}&limit=6`;
        const response = await fetch(mediaUrl);
        const data = (await response.json()) as any;

        if (data.error) {
            console.error('Instagram API error:', data.error);
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
