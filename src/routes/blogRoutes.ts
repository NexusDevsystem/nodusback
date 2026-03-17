import { Router } from 'express';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js';
import * as blogController from '../controllers/blogController.js';

const router = Router();

// Public routes
router.get('/', optionalAuthMiddleware, blogController.getAllPosts);
router.get('/:slug', optionalAuthMiddleware, blogController.getPostBySlug);
router.post('/:id/upvote', optionalAuthMiddleware, blogController.upvotePost);

// Admin routes (Protected by authMiddleware and role check in controller)
router.get('/admin/posts', authMiddleware, blogController.getAdminPosts);
router.post('/', authMiddleware, blogController.createPost);
router.patch('/:id', authMiddleware, blogController.updatePost);
router.delete('/:id', authMiddleware, blogController.deletePost);

export default router;
