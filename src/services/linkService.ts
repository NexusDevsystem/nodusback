import { supabase } from '../config/supabaseClient.js';
import { LinkItem, LinkItemDB, linkDbToApi, linkApiToDb } from '../models/types.js';
import { eventService } from './eventService.js';

export const linkService = {
    // Get all links for a profile (by user_id)
    async getLinksByProfileId(userId: string, publicView = false): Promise<LinkItem[]> {
        const [dbLinksData, events] = await Promise.all([
            supabase.from('links').select('*').eq('user_id', userId).order('position', { ascending: true }),
            eventService.getEventsByUserId(userId)
        ]);

        if (dbLinksData.error) {
            console.error('Error fetching links:', dbLinksData.error);
            return [];
        }

        const dbLinks = dbLinksData.data as LinkItemDB[];
        const now = new Date();

        // 1. Convert all DB links to API format and apply schedule filtering
        const allLinks = dbLinks.map(db => linkDbToApi(db)).filter(link => {
            if (!publicView) return true;
            if (link.scheduleStart && new Date(link.scheduleStart) > now) return false;
            if (link.scheduleEnd && new Date(link.scheduleEnd) < now) return false;
            return true;
        });

        // 2. Attach events to their collections
        const eventsByCollection = new Map<string, any[]>();
        events.forEach(event => {
            const list = eventsByCollection.get(event.collectionId) || [];
            list.push(event);
            eventsByCollection.set(event.collectionId, list);
        });

        allLinks.forEach(link => {
            if (link.type === 'agenda') {
                link.events = eventsByCollection.get(link.id!) || [];
            }
        });

        // 3. Build the hierarchy in memory
        const linkMap = new Map<string, LinkItem>();
        allLinks.forEach(link => {
            link.children = [];
            linkMap.set(link.id!, link);
        });

        const rootLinks: LinkItem[] = [];
        allLinks.forEach(link => {
            if (link.parentId) {
                const parent = linkMap.get(link.parentId);
                if (parent) {
                    parent.children = parent.children || [];
                    parent.children.push(link);
                }
            } else {
                rootLinks.push(link);
            }
        });

        return rootLinks;
    },

    // Get child links (kept for legacy or specific cases, but now redundant for profile load)
    async getChildLinks(parentId: string, publicView = false): Promise<LinkItem[]> {
        const { data, error } = await supabase
            .from('links')
            .select('*')
            .eq('parent_id', parentId)
            .order('position', { ascending: true });

        if (error) {
            console.error('Error fetching child links:', error);
            return [];
        }

        const dbLinks = data as LinkItemDB[];
        const now = new Date();

        // Filter and Map
        return dbLinks
            .map(db => linkDbToApi(db))
            .filter(link => {
                if (!publicView) return true;
                if (link.scheduleStart && new Date(link.scheduleStart) > now) return false;
                if (link.scheduleEnd && new Date(link.scheduleEnd) < now) return false;
                return true;
            });
    },

    // Get links by username (public)
    async getLinksByUsername(username: string): Promise<LinkItem[]> {
        const { data: profileData, error: profileError } = await supabase
            .from('users')
            .select('id')
            .ilike('username', username)
            .single();

        if (profileError || !profileData) {
            console.error('Error fetching profile:', profileError);
            return [];
        }

        return this.getLinksByProfileId(profileData.id, true);
    },

    // Create a new link
    async createLink(userId: string, link: Omit<LinkItem, 'id'>): Promise<LinkItem | null> {
        const dbLink = linkApiToDb(link, userId);

        const { data, error } = await supabase
            .from('links')
            .insert(dbLink)
            .select()
            .single();

        if (error) {
            console.error('Error creating link:', error);
            return null;
        }

        return linkDbToApi(data as LinkItemDB);
    },

    // Update a link
    async updateLink(linkId: string, updates: Partial<LinkItem>): Promise<LinkItem | null> {
        const dbUpdates: Partial<LinkItemDB> = {};
        if (updates.title !== undefined) dbUpdates.title = updates.title;
        if (updates.url !== undefined) dbUpdates.url = updates.url;
        if (updates.image !== undefined) dbUpdates.icon = updates.image;
        if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
        if (updates.layout !== undefined) dbUpdates.layout = updates.layout;
        if (updates.type !== undefined) dbUpdates.type = updates.type;
        if (updates.highlight !== undefined) dbUpdates.highlight = updates.highlight;
        if (updates.embedType !== undefined) dbUpdates.embed_type = updates.embedType;
        if (updates.subtitle !== undefined) dbUpdates.subtitle = updates.subtitle;
        if (updates.isArchived !== undefined) dbUpdates.is_archived = updates.isArchived;
        if (updates.videoUrl !== undefined) dbUpdates.video_url = updates.videoUrl;
        if (updates.platform !== undefined) dbUpdates.platform = updates.platform;
        if (updates.scheduleStart !== undefined) dbUpdates.schedule_start = updates.scheduleStart;
        if (updates.scheduleEnd !== undefined) dbUpdates.schedule_end = updates.scheduleEnd;

        const { data, error } = await supabase
            .from('links')
            .update(dbUpdates)
            .eq('id', linkId)
            .select()
            .single();

        if (error) {
            console.error('Error updating link:', error);
            return null;
        }

        return linkDbToApi(data as LinkItemDB);
    },

    // Delete a link
    async deleteLink(linkId: string): Promise<boolean> {
        const { error: clicksError } = await supabase
            .from('clicks')
            .delete()
            .eq('link_id', linkId);

        if (clicksError) {
            console.error('Error pruning clicks for link deletion:', clicksError);
        }

        const { error } = await supabase
            .from('links')
            .delete()
            .eq('id', linkId);

        if (error) {
            console.error('Error deleting link:', error);
            return false;
        }

        return true;
    },

    // Increment clicks and track event
    async incrementClicks(id: string): Promise<void> {
        try {
            let userId: string | null = null;
            let type: 'link' | 'product' = 'link';

            const { data: linkData, error: linkError } = await supabase
                .from('links')
                .select('user_id')
                .eq('id', id)
                .maybeSingle();

            if (linkData) {
                userId = linkData.user_id;
                type = 'link';
            } else {
                const { data: productData, error: productError } = await supabase
                    .from('products')
                    .select('user_id')
                    .eq('id', id)
                    .maybeSingle();

                if (productData) {
                    userId = productData.user_id;
                    type = 'product';
                }
            }

            if (!userId) return;

            const { error: incError } = await supabase.rpc(
                type === 'link' ? 'increment_link_clicks' : 'increment_product_clicks',
                { [type === 'link' ? 'link_id' : 'product_id']: id }
            );

            if (incError) {
                const table = type === 'link' ? 'links' : 'products';
                const { data: item } = await supabase.from(table).select('clicks').eq('id', id).maybeSingle();
                await supabase.from(table).update({ clicks: (item?.clicks || 0) + 1 }).eq('id', id);
            }

            await supabase.from('clicks').insert({
                user_id: userId,
                link_id: type === 'link' ? id : null,
                product_id: type === 'product' ? id : null,
                type: 'click'
            });

        } catch (error) {
            console.error('❌ [incrementClicks] Unexpected error:', error);
        }
    },

    // Replace all links for a profile (bulk update)
    async replaceAllLinks(userId: string, links: LinkItem[]): Promise<LinkItem[]> {
        try {
            const { data: existingLinks, error: fetchError } = await supabase
                .from('links')
                .select('id')
                .eq('user_id', userId);

            if (fetchError) throw fetchError;
            const existingIds = new Set((existingLinks || []).map(l => l.id));
            const activeIds = new Set<string>();

            const upsertRecursive = async (items: LinkItem[], parentId: string | null = null): Promise<LinkItem[]> => {
                const result: LinkItem[] = [];

                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    const dbLink = linkApiToDb(item, userId);
                    dbLink.parent_id = parentId;
                    dbLink.position = i;

                    const isUUID = item.id && item.id.length > 20 && !item.id.startsWith('temp-');
                    if (isUUID) {
                        dbLink.id = item.id;
                    } else {
                        delete dbLink.id;
                    }

                    const { data, error } = await supabase
                        .from('links')
                        .upsert(dbLink)
                        .select()
                        .single();

                    if (error) {
                        console.error('[bulkSave] Upsert failed:', error);
                        continue;
                    }

                    const savedDbLink = data as LinkItemDB;
                    activeIds.add(savedDbLink.id!);
                    const apiLink = linkDbToApi(savedDbLink);

                    if (item.children && item.children.length > 0) {
                        apiLink.children = await upsertRecursive(item.children, savedDbLink.id!);
                    }

                    // Preserve events in the response for agenda items so frontend doesn't lose them
                    if (item.type === 'agenda' && item.events) {
                        apiLink.events = item.events;
                    }

                    result.push(apiLink);
                }
                return result;
            };

            const savedTree = await upsertRecursive(links);
            const idsToDelete = Array.from(existingIds).filter(id => !activeIds.has(id));

            if (idsToDelete.length > 0) {
                await supabase.from('clicks').delete().in('link_id', idsToDelete);
                await supabase.from('links').delete().in('id', idsToDelete);
            }

            return savedTree;
        } catch (err) {
            console.error('[bulkSave] Unexpected error:', err);
            throw err;
        }
    }
};
