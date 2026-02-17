import { supabase } from '../config/supabaseClient.js';
import { SocialIntegrationDB } from '../models/types.js';

const APP_ID = process.env.INSTAGRAM_APP_ID;
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET;
const REDIRECT_URI = process.env.INSTAGRAM_REDIRECT_URI;

/**
 * Generates the Instagram/Facebook Auth URL
 */
export const getAuthUrl = (userId: string, origin?: string) => {
    const csrfState = Math.random().toString(36).substring(7);
    const state = `${csrfState}_${userId}_${origin || 'production'}`;

    // Permissions needed: instagram_basic, pages_show_list, instagram_manage_insights (optional), pages_read_engagement
    const scopes = [
        'instagram_basic',
        'pages_show_list',
        'pages_read_engagement',
        'business_management' // Sometimes needed for professional account listing
    ].join(',');

    const baseUrl = 'https://www.facebook.com/v19.0/dialog/oauth';
    const params = new URLSearchParams({
        client_id: APP_ID || '',
        redirect_uri: REDIRECT_URI || '',
        state: state,
        scope: scopes,
        response_type: 'code'
    });

    return `${baseUrl}?${params.toString()}`;
};

/**
 * Handles the OAuth callback, exchanges code for token, and fetches Instagram data
 */
export const handleCallback = async (code: string, userId: string): Promise<SocialIntegrationDB | null> => {
    try {
        // 1. Exchange code for short-lived access token
        const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${APP_ID}&redirect_uri=${REDIRECT_URI}&client_secret=${APP_SECRET}&code=${code}`;
        const shortTokenResponse = await fetch(tokenUrl);
        const shortTokenData = await shortTokenResponse.json() as any;

        if (shortTokenData.error) {
            throw new Error(`Instagram Token Error: ${shortTokenData.error.message}`);
        }

        const shortAccessToken = shortTokenData.access_token;

        // 2. Exchange short-lived token for long-lived token (60 days)
        const longTokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${shortAccessToken}`;
        const longTokenResponse = await fetch(longTokenUrl);
        const longTokenData = await longTokenResponse.json() as any;

        const accessToken = longTokenData.access_token;
        const expiresAt = new Date(Date.now() + (longTokenData.expires_in || 5184000) * 1000).toISOString();

        // 3. Get User's Pages to find the linked Instagram Business account
        const pagesUrl = `https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`;
        const pagesResponse = await fetch(pagesUrl);
        const pagesData = await pagesResponse.json() as any;

        const pages = pagesData.data || [];
        let instagramBusinessId = null;
        let pageAccessToken = null;

        // We need to find which page has a connected Instagram account
        for (const page of pages) {
            const igAccountUrl = `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${accessToken}`;
            const igResponse = await fetch(igAccountUrl);
            const igData = await igResponse.json() as any;

            if (igData.instagram_business_account) {
                instagramBusinessId = igData.instagram_business_account.id;
                pageAccessToken = accessToken; // Use the user token for now
                break;
            }
        }

        if (!instagramBusinessId) {
            throw new Error('No Instagram Business account found linked to your Facebook pages.');
        }

        // 4. Fetch Instagram Profile Info
        const profileUrl = `https://graph.facebook.com/v19.0/${instagramBusinessId}?fields=username,name,profile_picture_url,followers_count&access_token=${accessToken}`;
        const profileResponse = await fetch(profileUrl);
        const profileInfo = await profileResponse.json() as any;

        const profileData = {
            username: profileInfo.username || '',
            follower_count: profileInfo.followers_count || 0,
            avatar_url: profileInfo.profile_picture_url || '',
            channel_id: instagramBusinessId
        };

        // 5. Save to DB
        const integrationData: SocialIntegrationDB = {
            user_id: userId,
            provider: 'instagram',
            access_token: accessToken,
            expires_at: expiresAt,
            profile_data: profileData
        };

        const { data, error } = await supabase
            .from('social_integrations')
            .upsert(integrationData, { onConflict: 'user_id,provider' })
            .select()
            .single();

        if (error) throw error;

        // 6. Update the main 'users' table integrations array for redundancy/easier access
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

        // 7. Sync initial feed components (posts)
        await syncFeed(userId);

        console.log('[InstagramService] Integration saved successfully for user:', userId);
        return data;

    } catch (error) {
        console.error('Instagram Auth Error:', error);
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

        // Fetch media from Instagram Graph API
        const mediaUrl = `https://graph.facebook.com/v19.0/${integration.profile_data.channel_id}/media?fields=id,caption,media_type,media_url,permalink,thumbnail_url,timestamp&access_token=${integration.access_token}&limit=6`;
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
