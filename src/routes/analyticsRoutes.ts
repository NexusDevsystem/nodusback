import { Router } from 'express';
import { analyticsController } from '../controllers/analyticsController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import rateLimit from 'express-rate-limit';

const router = Router();
const publicAnalyticsLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many analytics events. Try again later.' }
});

router.get('/summary', authMiddleware, analyticsController.getSummary);
router.post('/track', publicAnalyticsLimiter, analyticsController.trackClick);
router.post('/track-click', publicAnalyticsLimiter, analyticsController.trackClickPublic);
router.post('/track-view', publicAnalyticsLimiter, analyticsController.trackView);

export default router;
