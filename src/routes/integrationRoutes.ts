import express from 'express';
import * as integrationController from '../controllers/integrationController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/me', authMiddleware, integrationController.getMyIntegrations);

// Twitch Integration
router.get('/twitch/auth-url', authMiddleware, integrationController.getTwitchAuthUrl);
router.get('/twitch/callback', integrationController.handleTwitchCallback);

// Kick Integration
router.get('/kick/auth-url', authMiddleware, integrationController.getKickAuthUrl);
router.get('/kick/callback', integrationController.handleKickCallback);
router.post('/kick/connect', authMiddleware, integrationController.connectKickAccount);

// Generic Disconnect
router.delete('/:provider', authMiddleware, integrationController.disconnectIntegration);

export default router;
