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

            // Delete existing links
            const { error: delError } = await supabase
                .from('links')
                .delete()
                .eq('user_id', userId);

            if (delError) {
                console.error('[bulkSave] Error deleting old links:', delError);
                throw delError;
            }

            if (links.length === 0) {
                console.log('[bulkSave] No links provided, bulk delete complete.');
                return [];
            }

            // Internal helper to insert links recursively
            const saveRecursive = async (items: LinkItem[], parentId: string | null = null): Promise<LinkItem[]> => {
                if (items.length === 0) return [];

                const dbLinks = items.map((item, index) => ({
                    ...linkApiToDb(item, userId),
                    parent_id: parentId,
                    position: index
                }));

                const { data, error } = await supabase
                    .from('links')
                    .insert(dbLinks)
                    .select();

                if (error) {
                    console.error('[bulkSave] Error inserting batch:', error);
                    throw error;
                }

                const insertedLinks = data as LinkItemDB[];
                const result: LinkItem[] = [];

                for (let i = 0; i < insertedLinks.length; i++) {
                    const dbLink = insertedLinks[i];
                    const apiLink = linkDbToApi(dbLink);

                    // If the original item had children, save them too
                    const originalItem = items[i];
                    if (originalItem.children && originalItem.children.length > 0) {
                        const savedChildren = await saveRecursive(originalItem.children, dbLink.id!);
                        apiLink.children = savedChildren;
                    }

                    result.push(apiLink);
                }

                return result;
            };

            const savedTree = await saveRecursive(links);
            console.log(`[bulkSave] Successfully saved tree for user ${userId}`);
            return savedTree;
        } catch (err) {
            console.error('[bulkSave] Unexpected error:', err);
            throw err;
        }
    }
};
