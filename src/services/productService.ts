import { db } from '../config/database.js';
import { Product } from '../models/types.js';
import { v4 as uuidv4 } from 'uuid';

export const productService = {
    async getAllProducts(): Promise<Product[]> {
        await db.read();
        return db.data.products;
    },

    async createProduct(product: Omit<Product, 'id'>): Promise<Product> {
        await db.read();
        const newProduct: Product = {
            ...product,
            id: uuidv4()
        };
        db.data.products.push(newProduct);
        await db.write();
        return newProduct;
    },

    async updateProduct(id: string, updates: Partial<Product>): Promise<Product | null> {
        await db.read();
        const index = db.data.products.findIndex(p => p.id === id);
        if (index === -1) return null;

        db.data.products[index] = { ...db.data.products[index], ...updates };
        await db.write();
        return db.data.products[index];
    },

    async deleteProduct(id: string): Promise<boolean> {
        await db.read();
        const initialLength = db.data.products.length;
        db.data.products = db.data.products.filter(p => p.id !== id);
        await db.write();
        return db.data.products.length < initialLength;
    },

    async replaceAllProducts(products: Product[]): Promise<Product[]> {
        await db.read();
        db.data.products = products;
        await db.write();
        return db.data.products;
    }
};
