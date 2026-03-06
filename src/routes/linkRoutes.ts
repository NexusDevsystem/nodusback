import { Router } from 'express';
import { linkController, uploadThumbnailMiddleware } from '../controllers/linkController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Public routes
router.get('/public/:username', linkController.getLinksByUsername);
router.post('/track/:id', linkController.trackClick);
router.post('/:id/verify-password', linkController.verifyLinkPassword);

// Protected routes (require authentication)
router.get('/me', authMiddleware, linkController.getMyLinks);
router.post('/', authMiddleware, linkController.createLink);
router.post('/thumbnail', authMiddleware, uploadThumbnailMiddleware.single('file'), linkController.uploadThumbnail);
router.post('/proxy-thumbnail', authMiddleware, linkController.proxyUpload);
router.put('/bulk', authMiddleware, linkController.replaceAllLinks);
router.put('/:id', authMiddleware, linkController.updateLink);
router.delete('/:id', authMiddleware, linkController.deleteLink);

export default router;
