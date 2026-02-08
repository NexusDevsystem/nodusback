
import express from 'express';
import * as integrationController from '../controllers/integrationController.js';

const router = express.Router();

router.get('/youtube/auth-url', integrationController.getYouTubeAuthUrl);
router.post('/youtube/callback', integrationController.handleYouTubeCallback);

export default router;
