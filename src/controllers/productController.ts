import { Request, Response } from 'express';
import { productService } from '../services/productService.js';

export const productController = {
    async getAllProducts(req: Request, res: Response) {
        try {
            const products = await productService.getAllProducts();
            res.json(products);
        } catch (error) {
            res.status(500).json({ error: 'Failed to fetch products' });
        }
    },

    async createProduct(req: Request, res: Response) {
        try {
            const product = await productService.createProduct(req.body);
            res.status(201).json(product);
        } catch (error) {
            res.status(500).json({ error: 'Failed to create product' });
        }
    },

    async updateProduct(req: Request, res: Response) {
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

    async deleteProduct(req: Request, res: Response) {
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

    async replaceAllProducts(req: Request, res: Response) {
        try {
            const products = await productService.replaceAllProducts(req.body);
            res.json(products);
        } catch (error) {
            res.status(500).json({ error: 'Failed to replace products' });
        }
    }
};
