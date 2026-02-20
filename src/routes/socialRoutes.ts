import { Router } from 'express';
import { socialController } from '../controllers/socialController.js';

const router = Router();

// GET /api/social/youtube?url=<channel_url>
router.get('/youtube', socialController.getYoutubeChannelInfo);

export default router;
