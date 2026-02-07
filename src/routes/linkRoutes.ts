import { Router } from 'express';
import { linkController } from '../controllers/linkController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Public routes
router.get('/public/:username', linkController.getLinksByUsername);
router.post('/track/:id', linkController.trackClick);

// Protected routes (require authentication)
router.get('/me', authMiddleware, linkController.getMyLinks);
router.post('/', authMiddleware, linkController.createLink);
router.put('/bulk', authMiddleware, linkController.replaceAllLinks);
router.put('/:id', authMiddleware, linkController.updateLink);
router.delete('/:id', authMiddleware, linkController.deleteLink);

export default router;
