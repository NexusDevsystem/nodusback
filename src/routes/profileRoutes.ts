import { Router } from 'express';
import { profileController } from '../controllers/profileController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Public routes
router.get('/public/:username', profileController.getPublicProfile);
router.get('/public-bootstrap/:username', profileController.getPublicBootstrap);
router.get('/check-username/:username', profileController.checkUsername);

// Protected routes (require authentication)
router.get('/bootstrap', authMiddleware, profileController.getBootstrap);
router.get('/me', authMiddleware, profileController.getMyProfile);
router.put('/me', authMiddleware, profileController.updateProfile);
router.post('/', authMiddleware, profileController.createProfile);

export default router;
