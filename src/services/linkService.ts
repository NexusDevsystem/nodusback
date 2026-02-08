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
            console.log(`[bulkSave] Replacing links for user ${userId}`);

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
