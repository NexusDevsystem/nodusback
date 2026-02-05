import { Router } from 'express';
import { analyticsController } from '../controllers/analyticsController.js';

const router = Router();

router.get('/', analyticsController.getAllAnalytics);
router.post('/track', analyticsController.trackClick);

export default router;
