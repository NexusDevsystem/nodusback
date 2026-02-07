import { supabase } from '../config/supabaseClient.js';
import { Product, ProductDB, productDbToApi, productApiToDb } from '../models/types.js';

export const productService = {
    // Get all products for a profile (by user_id)
    async getProductsByProfileId(userId: string): Promise<Product[]> {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('user_id', userId)  // FK to users(id)
            .order('position', { ascending: true });

        if (error) {
            console.error('Error fetching products:', error);
            return [];
        }

        const dbProducts = data as ProductDB[];
        return dbProducts.map(db => productDbToApi(db));
    },

    // Create a new product
    async createProduct(userId: string, product: Omit<Product, 'id'>): Promise<Product | null> {
        const dbProduct = productApiToDb(product, userId);

        const { data, error } = await supabase
            .from('products')
            .insert(dbProduct)
            .select()
            .single();

        if (error) {
            console.error('Error creating product:', error);
            return null;
        }

        return productDbToApi(data as ProductDB);
    },

    // Update a product
    async updateProduct(productId: string, updates: Partial<Product>): Promise<Product | null> {
        const dbUpdates: Partial<ProductDB> = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.price !== undefined) dbUpdates.price = updates.price;
        if (updates.image !== undefined) dbUpdates.image = updates.image;
        if (updates.url !== undefined) dbUpdates.url = updates.url;
        if (updates.discountCode !== undefined) dbUpdates.discount_code = updates.discountCode;

        const { data, error } = await supabase
            .from('products')
            .update(dbUpdates)
            .eq('id', productId)
            .select()
            .single();

        if (error) {
            console.error('Error updating product:', error);
            return null;
        }

        return productDbToApi(data as ProductDB);
    },

    // Delete a product
    async deleteProduct(productId: string): Promise<boolean> {
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', productId);

        if (error) {
            console.error('Error deleting product:', error);
            return false;
        }

        return true;
    },

    // Replace all products for a profile (bulk update)
    async replaceAllProducts(userId: string, products: Product[]): Promise<Product[]> {
        try {
            // Delete existing products
            await supabase
                .from('products')
                .delete()
                .eq('user_id', userId);  // FK to users(id)

            if (products.length === 0) return [];

            // Insert new products with position
            const dbProducts = products.map((product, index) => ({
                ...productApiToDb(product, userId),
                position: index
            }));

            const { data, error } = await supabase
                .from('products')
                .insert(dbProducts)
                .select();

            if (error) {
                console.error('Error inserting products in bulk:', error);
                return [];
            }

            return (data as ProductDB[]).map(db => productDbToApi(db));
        } catch (err) {
            console.error('Unexpected error in replaceAllProducts:', err);
            return [];
        }
    }
};
