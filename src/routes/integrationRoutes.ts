import express from 'express';
import * as integrationController from '../controllers/integrationController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/me', authMiddleware, integrationController.getMyIntegrations);

router.get('/tiktok/auth-url', integrationController.getTikTokAuthUrl);
router.get('/tiktok/callback', integrationController.handleTikTokCallback);

router.get('/instagram/auth-url', integrationController.getInstagramAuthUrl);
router.get('/instagram/callback', integrationController.handleInstagramCallback);
router.post('/instagram/switch', authMiddleware, integrationController.switchInstagramAccount);

router.get('/twitch/auth-url', integrationController.getTwitchAuthUrl);
router.get('/twitch/callback', integrationController.handleTwitchCallback);

router.get('/youtube/auth-url', integrationController.getYoutubeAuthUrl);
router.get('/youtube/callback', integrationController.handleYoutubeCallback);

router.get('/kick/auth-url', integrationController.getKickAuthUrl);
router.get('/kick/callback', integrationController.handleKickCallback);
router.post('/kick/connect', authMiddleware, integrationController.connectKickAccount);

router.delete('/:provider', authMiddleware, integrationController.disconnectIntegration);
router.get('/instagram/webhook', integrationController.handleInstagramWebhook);
router.post('/instagram/webhook', integrationController.handleInstagramWebhook);
router.post('/instagram/deauthorize', integrationController.handleInstagramDeauthorize);

export default router;
