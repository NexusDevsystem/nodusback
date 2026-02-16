import { Router } from 'express';
import fileController, { upload } from '../controllers/fileController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Apply auth middleware to all file routes
router.use(authMiddleware);

// Routes
router.post('/', upload.single('file'), fileController.uploadFile);
router.get('/', fileController.listFiles);
router.delete('/:filename', fileController.deleteFile);

export default router;
