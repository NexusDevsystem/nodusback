import { Router } from 'express';
import { profileController } from '../controllers/profileController.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js';
import { realtimeManager } from '../realtime/RealtimeManager.js';

const router = Router();

// Public routes
router.get('/public/:username', profileController.getPublicProfile);
router.get('/public-bootstrap/:username', profileController.getPublicBootstrap);
router.get('/check-username/:username', optionalAuthMiddleware, profileController.checkUsername);

// REALTIME SSE ENDPOINT (No keys needed on front)
router.get('/realtime/:username', (req, res) => {
    const { username } = req.params;
    realtimeManager.addClient(username, res);
});

// Protected routes (require authentication)
router.get('/bootstrap', authMiddleware, profileController.getBootstrap);
router.get('/me', authMiddleware, profileController.getMyProfile);
router.put('/me', authMiddleware, profileController.updateProfile);
router.post('/', authMiddleware, profileController.createProfile);

// Onboarding
router.patch('/onboarding/copy-url', authMiddleware, profileController.markUrlCopied);
router.patch('/onboarding/dismiss', authMiddleware, profileController.dismissOnboarding);

export default router;
