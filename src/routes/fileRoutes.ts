import { Router } from 'express';
import fileController, { upload } from '../controllers/fileController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Routes
// Protected routes (require valid JWT)
router.use(authMiddleware);

router.post('/sync-blog/:slug', fileController.syncBlogCard);
router.post('/sync-profile/:username', fileController.syncProfileCard);
router.post('/', upload.single('file'), fileController.uploadFile);
router.get('/', fileController.listFiles);
router.delete('/:filename', fileController.deleteFile);

export default router;
