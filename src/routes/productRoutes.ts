import { Router } from 'express';
import { productController } from '../controllers/productController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Public routes
router.get('/public/:username', productController.getProductsByUsername);

// Protected routes (require authentication)
router.get('/me', authMiddleware, productController.getMyProducts);
router.post('/', authMiddleware, productController.createProduct);
router.put('/bulk', authMiddleware, productController.replaceAllProducts);
router.put('/:id', authMiddleware, productController.updateProduct);
router.delete('/:id', authMiddleware, productController.deleteProduct);

export default router;
