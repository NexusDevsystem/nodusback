import express from 'express';
import * as integrationController from '../controllers/integrationController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/me', authMiddleware, integrationController.getMyIntegrations);

router.get('/tiktok/auth-url', integrationController.getTikTokAuthUrl);
router.get('/tiktok/callback', integrationController.handleTikTokCallback);

router.get('/instagram/auth-url', integrationController.getInstagramAuthUrl);
router.get('/instagram/callback', integrationController.handleInstagramCallback);
router.delete('/:provider', authMiddleware, integrationController.disconnectIntegration);
router.get('/instagram/webhook', integrationController.handleInstagramWebhook);
router.post('/instagram/webhook', integrationController.handleInstagramWebhook);

export default router;
