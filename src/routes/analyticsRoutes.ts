import { Router } from 'express';
import { analyticsController } from '../controllers/analyticsController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/summary', authMiddleware, analyticsController.getSummary);
router.post('/track', analyticsController.trackClick);
router.post('/track-view', analyticsController.trackView);

export default router;
