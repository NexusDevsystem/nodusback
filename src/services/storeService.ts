import { supabase } from '../config/supabaseClient.js';
import { Store, StoreDB, storeDbToApi, storeApiToDb } from '../models/types.js';

export const storeService = {
    async getStoresByProfileId(userId: string): Promise<Store[]> {
        const { data, error } = await supabase
            .from('stores')
            .select('*')
            .eq('user_id', userId)
            .order('position', { ascending: true });

        if (error) {
            console.error('Error fetching stores:', error);
            return [];
        }

        return (data as StoreDB[]).map(storeDbToApi);
    },

    async replaceAllStores(userId: string, stores: Store[]): Promise<Store[]> {
        try {
            // Delete existing
            await supabase
                .from('stores')
                .delete()
                .eq('user_id', userId);

            if (stores.length === 0) return [];

            const dbStores = stores.map((store, index) => ({
                ...storeApiToDb(store, userId),
                position: index
            }));

            const { data, error } = await supabase
                .from('stores')
                .insert(dbStores)
                .select();

            if (error) {
                console.error('Error in bulk stores update:', error);
                return [];
            }

            return (data as StoreDB[]).map(storeDbToApi);
        } catch (error) {
            console.error('Unexpected error in replaceAllStores:', error);
            return [];
        }
    }
};
