import { Router } from 'express';
import { linkController, uploadThumbnailMiddleware } from '../controllers/linkController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { checkOwnership } from '../middleware/ownershipMiddleware.js';

const router = Router();
// router.use(authMiddleware); // Apply globally? Let's keep selective for now.

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
router.put('/:id', authMiddleware, checkOwnership('links'), linkController.updateLink);
router.delete('/:id', authMiddleware, checkOwnership('links'), linkController.deleteLink);

export default router;
