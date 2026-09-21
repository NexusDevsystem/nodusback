import { supabase } from '../config/supabaseClient.js';
import { Store, StoreDB, storeDbToApi, storeApiToDb } from '../models/types.js';

export const storeService = {
    async getStoresByProfileId(userId: string, publicView = false): Promise<Store[]> {
        const { data, error } = await supabase
            .from('stores')
            .select('*')
            .eq('user_id', userId)
            .order('position', { ascending: true });

        if (error) {
            console.error('Error fetching stores:', error);
            return [];
        }

        const dbStores = data as StoreDB[];
        return dbStores
            .map(db => storeDbToApi(db))
            .filter(store => {
                if (!publicView) return true;
                return store.isActive !== false;
            });
    },

    async replaceAllStores(userId: string, stores: Store[]): Promise<Store[]> {
        try {
            const existingStoreIds = Array.from(new Set(
                stores
                    .map(store => store.id)
                    .filter((id): id is string => Boolean(id) && !id.startsWith('new-'))
            ));

            if (existingStoreIds.length > 0) {
                const { data: ownedStores, error: ownershipError } = await supabase
                    .from('stores')
                    .select('id')
                    .eq('user_id', userId)
                    .in('id', existingStoreIds);

                if (ownershipError) {
                    console.error('Error validating store ownership:', ownershipError);
                    throw ownershipError;
                }

                const ownedIds = new Set((ownedStores || []).map(store => store.id));
                const foreignIds = existingStoreIds.filter(id => !ownedIds.has(id));
                if (foreignIds.length > 0) {
                    const ownershipError = new Error('STORE_OWNERSHIP_VIOLATION');
                    (ownershipError as Error & { code?: string }).code = 'OWNERSHIP_VIOLATION';
                    throw ownershipError;
                }
            }

            // Transform for DB
            const dbStores = stores.map((store, index) => ({
                ...storeApiToDb(store, userId),
                position: index
            }));

            // Delete stores that are no longer in our list
            const storeIdsToKeep = stores.map(s => s.id).filter(id => id && !id.startsWith('new-'));
            if (storeIdsToKeep.length > 0) {
                await supabase
                    .from('stores')
                    .delete()
                    .eq('user_id', userId)
                    .not('id', 'in', storeIdsToKeep);
            } else {
                await supabase
                    .from('stores')
                    .delete()
                    .eq('user_id', userId);
            }

            if (dbStores.length === 0) return [];

            // Upsert all stores (updates existing, inserts new)
            const { data, error } = await supabase
                .from('stores')
                .upsert(dbStores, { onConflict: 'id' })
                .select();

            if (error) {
                console.error('Error in bulk stores update (upsert):', error);
                
                // Fallback: Delete and insert approach if upsert somehow fails (e.g. ID conflicts)
                console.log('Attempting fallback delete/insert for stores...');
                await supabase.from('stores').delete().eq('user_id', userId);
                const { data: fallbackData, error: fallbackError } = await supabase
                    .from('stores')
                    .insert(dbStores)
                    .select();
                
                if (fallbackError) {
                    console.error('Fallback failed:', fallbackError);
                    return [];
                }
                return (fallbackData as StoreDB[]).map(storeDbToApi);
            }

            return (data as StoreDB[]).map(storeDbToApi);
        } catch (error) {
            console.error('Unexpected error in replaceAllStores:', error);
            return [];
        }
    }
};
