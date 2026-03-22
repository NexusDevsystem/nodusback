import { Router } from 'express';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js';
import * as blogController from '../controllers/blogController.js';

const router = Router();

// Admin routes (Protected by authMiddleware and role check in controller)
router.get('/admin', authMiddleware, blogController.getAdminPosts);
router.post('/', authMiddleware, blogController.createPost);
router.patch('/:id', authMiddleware, blogController.updatePost);
router.delete('/:id', authMiddleware, blogController.deletePost);
router.put('/reorder', authMiddleware, blogController.reorderPosts);

// Public routes
router.get('/', optionalAuthMiddleware, blogController.getAllPosts);
router.get('/:slug', optionalAuthMiddleware, blogController.getPostBySlug);
router.post('/:id/upvote', optionalAuthMiddleware, blogController.upvotePost);
router.post('/:id/view', optionalAuthMiddleware, blogController.incrementViews);

export default router;
