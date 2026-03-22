import { Router } from 'express';
import fileController, { upload } from '../controllers/fileController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Routes
router.post('/sync-blog/:slug', fileController.syncBlogCard);

// Protected routes (apply auth only after the public sync route)
router.use(authMiddleware);

router.post('/', upload.single('file'), fileController.uploadFile);
router.get('/', fileController.listFiles);
router.delete('/:filename', fileController.deleteFile);

export default router;
