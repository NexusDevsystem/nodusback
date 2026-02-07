import { Response } from 'express';
import { productService } from '../services/productService.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabaseClient.js';

export const productController = {
    // Get all products for authenticated user
    async getMyProducts(req: AuthRequest, res: Response) {
        try {
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const products = await productService.getProductsByProfileId(req.profileId);
            res.json(products);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch products' });
        }
    },

    // Get products by username (public access)
    async getProductsByUsername(req: AuthRequest, res: Response) {
        try {
            const { username } = req.params;

            // First get the profile to get user_id
            const { data: profile } = await supabase
                .from('users')
                .select('id')
                .eq('username', username)
                .single();

            if (!profile) {
                return res.status(404).json({ error: 'Profile not found' });
            }

            const products = await productService.getProductsByProfileId(profile.id);
            res.json(products);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch products' });
        }
    },

    // Create a new product
    async createProduct(req: AuthRequest, res: Response) {
        try {
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const product = await productService.createProduct(req.profileId, req.body);

            if (!product) {
                return res.status(500).json({ error: 'Failed to create product' });
            }

            res.status(201).json(product);
        } catch (error) {
            res.status(500).json({ error: 'Failed to create product' });
        }
    },

    // Update a product
    async updateProduct(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const product = await productService.updateProduct(id, req.body);

            if (!product) {
                return res.status(404).json({ error: 'Product not found' });
            }

            res.json(product);
        } catch (error) {
            res.status(500).json({ error: 'Failed to update product' });
        }
    },

    // Delete a product
    async deleteProduct(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const deleted = await productService.deleteProduct(id);

            if (!deleted) {
                return res.status(404).json({ error: 'Product not found' });
            }

            res.status(204).send();
        } catch (error) {
            res.status(500).json({ error: 'Failed to delete product' });
        }
    },

    // Replace all products (bulk update)
    async replaceAllProducts(req: AuthRequest, res: Response) {
        try {
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { products } = req.body;
            if (!Array.isArray(products)) {
                return res.status(400).json({ error: 'Invalid request: products must be an array' });
            }

            const savedProducts = await productService.replaceAllProducts(req.profileId, products);
            res.json(savedProducts);
        } catch (error) {
            console.error('Error replacing products:', error);
            res.status(500).json({ error: 'Failed to replace products' });
        }
    }
};
