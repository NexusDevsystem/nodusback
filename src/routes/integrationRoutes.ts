
import express from 'express';
import * as integrationController from '../controllers/integrationController.js';

const router = express.Router();

router.get('/me', integrationController.getMyIntegrations);
router.get('/youtube/auth-url', integrationController.getYouTubeAuthUrl);
router.post('/youtube/callback', integrationController.handleYouTubeCallback);

router.get('/tiktok/auth-url', integrationController.getTikTokAuthUrl);
router.get('/tiktok/callback', integrationController.handleTikTokCallback);

export default router;
