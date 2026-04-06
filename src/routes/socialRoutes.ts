import { Router } from 'express';
import { socialController } from '../controllers/socialController.js';

const router = Router();

// GET /api/social/youtube?url=<channel_url>
router.get('/youtube', socialController.getYoutubeChannelInfo);

// GET /api/social/metadata?url=<profile_url>
router.get('/metadata', socialController.getSocialMetadata);

// GET /api/social/share/:username (Bot-friendly OG redirector)
router.get('/share/:username', socialController.shareProfile);

// GET /api/social/blog/:slug (Bot-friendly OG redirector for articles)
router.get('/blog/:slug', socialController.shareBlog);

export default router;
