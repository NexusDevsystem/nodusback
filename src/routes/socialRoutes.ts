import { Router } from 'express';
import { socialController } from '../controllers/socialController.js';

const router = Router();

// GET /api/social/youtube?url=<channel_url>
router.get('/youtube', socialController.getYoutubeChannelInfo);

// GET /api/social/instagram?url=<profile_url>
router.get('/instagram', socialController.getInstagramProfileInfo);

// GET /api/social/tiktok?url=<profile_url>
router.get('/tiktok', socialController.getTiktokProfileInfo);

// GET /api/social/discord?url=<invite_url>
router.get('/discord', socialController.getDiscordInviteInfo);

// GET /api/social/twitch?url=<channel_url>
router.get('/twitch', socialController.getTwitchProfileInfo);

// GET /api/social/kick?url=<channel_url>
router.get('/kick', socialController.getKickProfileInfo);

// GET /api/social/metadata?url=<profile_url>
router.get('/metadata', socialController.getSocialMetadata);


// GET /api/social/share/:username (Bot-friendly OG redirector)
router.get('/share/:username', socialController.shareProfile);

// GET /api/social/blog/:slug (Bot-friendly OG redirector for articles)
router.get('/blog/:slug', socialController.shareBlog);

export default router;
