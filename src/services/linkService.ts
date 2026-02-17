import { supabase } from '../config/supabaseClient.js';
import { LinkItem, LinkItemDB, linkDbToApi, linkApiToDb } from '../models/types.js';

export const linkService = {
    // Get all links for a profile (by user_id)
    async getLinksByProfileId(userId: string, publicView = false): Promise<LinkItem[]> {
        const { data, error } = await supabase
            .from('links')
            .select('*')
            .eq('user_id', userId)  // FK to users(id)
            .is('parent_id', null) // Only top-level links
            .order('position', { ascending: true });

        if (error) {
            console.error('Error fetching links:', error);
            return [];
        }

        const dbLinks = data as LinkItemDB[];
        const now = new Date();

        // Filter and Map
        const linksWithChildren = await Promise.all(
            dbLinks.map(async (dbLink) => {
                const apiLink = linkDbToApi(dbLink);

                // --- SCHEDULE LOGIC ---
                // If it's a public view, apply schedule filtering
                if (publicView) {
                    // 1. If start data is set and FUTURE (start > now), Hide it.
                    if (apiLink.scheduleStart && new Date(apiLink.scheduleStart) > now) {
                        return null;
                    }
                    // 2. If end date is set and PAST (end < now), Hide it.
                    if (apiLink.scheduleEnd && new Date(apiLink.scheduleEnd) < now) {
                        return null;
                    }
                }
                // ----------------------

                const children = await this.getChildLinks(dbLink.id!, publicView);

                // If the item itself is valid but has children, update children list
                return { ...apiLink, children };
            })
        );

        // Remove nulls (filtered out links)
        return linksWithChildren.filter(l => l !== null) as LinkItem[];
    },

    // Get child links (for collections)
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

        // Filter for schedule if public view
        const filtered = dbLinks.filter(dbLink => {
            if (!publicView) return true;

            const start = dbLink.schedule_start ? new Date(dbLink.schedule_start) : null;
            const end = dbLink.schedule_end ? new Date(dbLink.schedule_end) : null;

            if (start && start > now) return false; // Future
            if (end && end < now) return false;   // Expired
            return true;
        });

        return filtered.map(db => linkDbToApi(db));
    },

    // Get links by username (public)
    async getLinksByUsername(username: string): Promise<LinkItem[]> {
        // First get profile ID from username - use 'users' table
        const { data: profileData, error: profileError } = await supabase
            .from('users')  // Match actual table name
            .select('id')
            .ilike('username', username)
            .single();

        if (profileError || !profileData) {
            console.error('Error fetching profile:', profileError);
            return [];
        }

        // Pass 'true' to enable Public View filtering (Schedule)
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
        // We need a userId for mapping, but update might not have it.
        // However, linkApiToDb only uses it for the user_id column.
        // We can manually handle updates to avoid overwriting user_id.
        const dbUpdates: Partial<LinkItemDB> = {};
        if (updates.title !== undefined) dbUpdates.title = updates.title;
        if (updates.url !== undefined) dbUpdates.url = updates.url;
        if (updates.image !== undefined) dbUpdates.icon = updates.image; // Map image to icon
        if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;
        if (updates.layout !== undefined) dbUpdates.layout = updates.layout;
        if (updates.type !== undefined) dbUpdates.type = updates.type;
        if (updates.highlight !== undefined) dbUpdates.highlight = updates.highlight;
        if (updates.embedType !== undefined) dbUpdates.embed_type = updates.embedType;
        if (updates.subtitle !== undefined) dbUpdates.subtitle = updates.subtitle;
        if (updates.isArchived !== undefined) dbUpdates.is_archived = updates.isArchived;
        if (updates.videoUrl !== undefined) dbUpdates.video_url = updates.videoUrl;

        // Schedule Updates
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
        // Manually cascade delete clicks
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
            // 1. Try to find if it's a link or product and get user_id
            let userId: string | null = null;
            let type: 'link' | 'product' = 'link';

            // Check links table
            const { data: linkData } = await supabase
                .from('links')
                .select('user_id')
                .eq('id', id)
                .single();

            if (linkData) {
                userId = linkData.user_id;
                type = 'link';
            } else {
                // Check products table
                const { data: productData } = await supabase
                    .from('products')
                    .select('user_id')
                    .eq('id', id)
                    .single();

                if (productData) {
                    userId = productData.user_id;
                    type = 'product';
                }
            }

            if (!userId) {
                console.warn(`Could not find owner for ID ${id} to track click.`);
                return;
            }

            // 2. Increment clicks in the respective table
            const table = type === 'link' ? 'links' : 'products';
            const { error: incError } = await supabase.rpc(
                type === 'link' ? 'increment_link_clicks' : 'increment_product_clicks',
                { [type === 'link' ? 'link_id' : 'product_id']: id }
            );

            // Fallback if RPC is missing (common in development)
            if (incError) {
                console.log(`RPC failed, falling back to manual increment for ${table}`);
                const { data: item } = await supabase.from(table).select('clicks').eq('id', id).single();
                await supabase.from(table).update({ clicks: (item?.clicks || 0) + 1 }).eq('id', id);
            }

            // 3. Log event in analytics table 'clicks'
            await supabase.from('clicks').insert({
                user_id: userId,
                link_id: type === 'link' ? id : null,
                product_id: type === 'product' ? id : null,
                type: 'click'
            });

        } catch (error) {
            console.error('Error in complex incrementClicks:', error);
        }
    },

    // Replace all links for a profile (bulk update)
    async replaceAllLinks(userId: string, links: LinkItem[]): Promise<LinkItem[]> {
        try {
            console.log(`[bulkSave] Replacing links for user ${userId}. Total: ${links.length}. First layout: ${links[0]?.layout}`);

            // 1. Fetch ALL currently existing link IDs for this user
            const { data: existingLinks, error: fetchError } = await supabase
                .from('links')
                .select('id')
                .eq('user_id', userId);

            if (fetchError) throw fetchError;
            const existingIds = new Set((existingLinks || []).map(l => l.id));

            // 2. Recursive function to Upsert items and collect Active IDs
            const activeIds = new Set<string>();

            const upsertRecursive = async (items: LinkItem[], parentId: string | null = null): Promise<LinkItem[]> => {
                const result: LinkItem[] = [];

                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    const dbLink = linkApiToDb(item, userId);

                    dbLink.parent_id = parentId;
                    dbLink.position = i;

                    // ID Handling:
                    // If it looks like a UUID, keep it. Otherwise remove to let DB gen new one.
                    const isUUID = item.id && item.id.length > 20 && !item.id.startsWith('temp-');
                    if (isUUID) {
                        dbLink.id = item.id;
                    } else {
                        delete dbLink.id; // DB will generate new UUID
                    }

                    // Upsert (Update if ID exists, Insert if not)
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
                    activeIds.add(savedDbLink.id!); // Mark this ID as active/kept

                    const apiLink = linkDbToApi(savedDbLink);

                    // Process chidlren
                    if (item.children && item.children.length > 0) {
                        apiLink.children = await upsertRecursive(item.children, savedDbLink.id!);
                    }

                    result.push(apiLink);
                }
                return result;
            };

            const savedTree = await upsertRecursive(links);

            // 3. Delete any link that was in DB (`existingIds`) but NOT in `activeIds`
            const idsToDelete = Array.from(existingIds).filter(id => !activeIds.has(id));

            if (idsToDelete.length > 0) {
                console.log(`[bulkSave] Pruning ${idsToDelete.length} obsolete links`);

                // CRITICAL: Delete related "clicks" first to avoid Foreign Key violations if Cascade is missing
                const { error: clicksError } = await supabase
                    .from('clicks')
                    .delete()
                    .in('link_id', idsToDelete);

                if (clicksError) {
                    console.error('[bulkSave] Failed to prune dependent clicks:', clicksError);
                }

                const { error: delError } = await supabase
                    .from('links')
                    .delete()
                    .in('id', idsToDelete);

                if (delError) {
                    console.error('[bulkSave] Prune failed:', delError);
                }
            }

            return savedTree;

        } catch (err) {
            console.error('[bulkSave] Unexpected error:', err);
            throw err;
        }
    }
};
