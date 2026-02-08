import { supabase } from '../config/supabaseClient.js';
import { LinkItem, LinkItemDB, linkDbToApi, linkApiToDb } from '../models/types.js';

export const linkService = {
    // Get all links for a profile (by user_id)
    async getLinksByProfileId(userId: string): Promise<LinkItem[]> {
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

        // Fetch children for each link and map to API format
        const linksWithChildren = await Promise.all(
            dbLinks.map(async (dbLink) => {
                const apiLink = linkDbToApi(dbLink);
                const children = await this.getChildLinks(dbLink.id!);
                return { ...apiLink, children };
            })
        );

        return linksWithChildren;
    },

    // Get child links (for collections)
    async getChildLinks(parentId: string): Promise<LinkItem[]> {
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
        return dbLinks.map(db => linkDbToApi(db));
    },

    // Get links by username (public)
    async getLinksByUsername(username: string): Promise<LinkItem[]> {
        // First get profile ID from username - use 'users' table
        const { data: profileData, error: profileError } = await supabase
            .from('users')  // Match actual table name
            .select('id')
            .eq('username', username)
            .single();

        if (profileError || !profileData) {
            console.error('Error fetching profile:', profileError);
            return [];
        }

        return this.getLinksByProfileId(profileData.id);
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

    // Increment clicks
    async incrementClicks(linkId: string): Promise<void> {
        const { error } = await supabase.rpc('increment_link_clicks', {
            link_id: linkId
        });

        if (error) {
            console.error('Error incrementing clicks:', error);
        }
    },

    // Replace all links for a profile (bulk update)
    async replaceAllLinks(userId: string, links: LinkItem[]): Promise<LinkItem[]> {
        try {
            console.log(`[bulkSave] Replacing ${links.length} top-level links for user ${userId}`);

            // 1. Get ALL existing link IDs for this user to determine what to delete
            const { data: existingLinks, error: fetchError } = await supabase
                .from('links')
                .select('id')
                .eq('user_id', userId);

            if (fetchError) {
                console.error('[bulkSave] Error fetching existing links:', fetchError);
                throw fetchError;
            }

            const existingIds = (existingLinks || []).map(l => l.id);

            // Helper to extract all IDs from the input nested structure
            const getAllInputIds = (items: LinkItem[]): string[] => {
                let ids: string[] = [];
                for (const item of items) {
                    if (item.id && !item.id.startsWith('temp-')) { // Avoid temp IDs if any
                        ids.push(item.id);
                    }
                    if (item.children && item.children.length > 0) {
                        ids = [...ids, ...getAllInputIds(item.children)];
                    }
                }
                return ids;
            };

            const inputIds = getAllInputIds(links);

            // 2. Identify IDs to delete (In DB but not in Input)
            const idsToDelete = existingIds.filter(id => !inputIds.includes(id));

            if (idsToDelete.length > 0) {
                console.log(`[bulkSave] Deleting ${idsToDelete.length} removed links`);
                const { error: delError } = await supabase
                    .from('links')
                    .delete()
                    .in('id', idsToDelete);

                if (delError) {
                    console.error('[bulkSave] Error deleting removed links:', delError);
                    // We continue even if delete fails, strict consistency is less critical than data loss
                }
            }

            // 3. Recursive Upsert Loop
            // We use 'upsert' to update existing or insert new.
            // Problem: 'upsert' requires conflict resolution on Primary Key.
            // If we have an ID, we use it. If not, we let DB generate (but we need to map children).
            // Actually, for a tree, it's safer to just upsert.

            const upsertRecursive = async (items: LinkItem[], parentId: string | null = null): Promise<LinkItem[]> => {
                if (items.length === 0) return [];

                const result: LinkItem[] = [];

                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    const dbLink = linkApiToDb(item, userId);

                    // Explicitly set parent_id and position
                    dbLink.parent_id = parentId;
                    dbLink.position = i;

                    // If it's a new item (no ID or temp ID), remove ID to let DB generate
                    // If it has a valid UUID, include it for upsert
                    if (!dbLink.id || dbLink.id.startsWith('temp-')) {
                        delete dbLink.id;
                    }

                    const { data, error } = await supabase
                        .from('links')
                        .upsert(dbLink)
                        .select()
                        .single();

                    if (error) {
                        console.error('[bulkSave] Error upserting link:', error);
                        // If one fails, we log but continue? Or throw?
                        // Throwing is safer to signal partial failure, but let's try to save as much as possible
                        continue;
                    }

                    const savedDbLink = data as LinkItemDB;
                    const apiLink = linkDbToApi(savedDbLink);

                    // Recurse for children
                    if (item.children && item.children.length > 0) {
                        apiLink.children = await upsertRecursive(item.children, savedDbLink.id!);
                    }

                    result.push(apiLink);
                }

                return result;
            };

            const savedTree = await upsertRecursive(links);
            console.log(`[bulkSave] Successfully synched tree for user ${userId}`);
            return savedTree;

        } catch (err) {
            console.error('[bulkSave] Unexpected error:', err);
            throw err;
        }
    }
};
