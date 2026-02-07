import { Router } from 'express';
import { profileController } from '../controllers/profileController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Public routes
router.get('/public/:username', profileController.getPublicProfile);
router.get('/check-username/:username', profileController.checkUsername);

// Protected routes (require authentication)
router.get('/me', authMiddleware, profileController.getMyProfile);
router.put('/me', authMiddleware, profileController.updateProfile);
router.post('/', authMiddleware, profileController.createProfile);

export default router;
