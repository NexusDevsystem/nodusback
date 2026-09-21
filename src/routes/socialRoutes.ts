import { Router } from 'express';
import { socialController } from '../controllers/socialController.js';
import { optionalAuthMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// GET /api/social/youtube?url=<channel_url>
router.get('/youtube', optionalAuthMiddleware, socialController.getYoutubeChannelInfo);

// GET /api/social/instagram?url=<profile_url>
router.get('/instagram', optionalAuthMiddleware, socialController.getInstagramProfileInfo);

// GET /api/social/tiktok?url=<profile_url>
router.get('/tiktok', optionalAuthMiddleware, socialController.getTiktokProfileInfo);

// GET /api/social/discord?url=<invite_url>
router.get('/discord', optionalAuthMiddleware, socialController.getDiscordInviteInfo);

// GET /api/social/twitch?url=<channel_url>
router.get('/twitch', optionalAuthMiddleware, socialController.getTwitchProfileInfo);

// GET /api/social/kick?url=<channel_url>
router.get('/kick', optionalAuthMiddleware, socialController.getKickProfileInfo);

// GET /api/social/x?url=<profile_url>
router.get('/x', optionalAuthMiddleware, socialController.getXProfileInfo);

// GET /api/social/metadata?url=<profile_url>
router.get('/metadata', optionalAuthMiddleware, socialController.getSocialMetadata);


// GET /api/social/share/:username (Bot-friendly OG redirector)
router.get('/share/:username', socialController.shareProfile);

// GET /api/social/blog/:slug (Bot-friendly OG redirector for articles)
router.get('/blog/:slug', socialController.shareBlog);

export default router;
