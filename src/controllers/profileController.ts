import { Response } from 'express';
import { profileService } from '../services/profileService.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import xss from 'xss';

export const profileController = {
    // Get profile by username (public access)
    async getPublicProfile(req: AuthRequest, res: Response) {
        try {
            const { username } = req.params;
            const profile = await profileService.getProfileByUsername(username);

            if (!profile) {
                return res.status(404).json({ error: 'Profile not found' });
            }

            res.json(profile);
        } catch (error) {
            console.error('Error fetching public profile:', error);
            res.status(500).json({ error: 'Failed to fetch profile' });
        }
    },

    // Unified public data fetch (Profile + Links + Products)
    async getPublicBootstrap(req: AuthRequest, res: Response) {
        try {
            const { username } = req.params;
            const data = await profileService.getPublicBootstrapData(username);

            if (!data) {
                return res.status(404).json({ error: 'Profile not found' });
            }

            res.json(data);
        } catch (error) {
            console.error('Error bootstrapping public data:', error);
            res.status(500).json({ error: 'Failed to bootstrap public data' });
        }
    },

    // Get authenticated user's profile
    async getMyProfile(req: AuthRequest, res: Response) {
        try {
            if (!req.userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const profile = await profileService.getProfileByUserId(req.userId);

            if (!profile) {
                return res.status(404).json({ error: 'Profile not found' });
            }

            res.json(profile);
        } catch (error) {
            console.error('Error fetching profile:', error);
            res.status(500).json({ error: 'Failed to fetch profile' });
        }
    },

    // Get all initial data (Profile + Links + Products)
    async getBootstrap(req: AuthRequest, res: Response) {
        try {
            if (!req.userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const data = await profileService.getBootstrapData(req.userId);
            res.json(data);
        } catch (error) {
            console.error('Error bootstrapping data:', error);
            res.status(500).json({ error: 'Failed to bootstrap data' });
        }
    },

    async updateProfile(req: AuthRequest, res: Response) {
        try {
            console.log(`[PROFILE] Initing update: userId=${req.userId}`);
            if (!req.userId) {
                console.warn('[PROFILE] updateProfile called without req.userId');
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const updates = req.body;
            delete updates.customCSS;

            const profile = await profileService.updateProfile(req.userId, updates);

            if (!profile) {
                console.error(`[PROFILE] Profile not found or failed to update for userId: ${req.userId}`);
                return res.status(404).json({ error: 'Profile not found' });
            }

            console.log(`[PROFILE] Updated success: userId=${req.userId}`);
            res.json(profile);
        } catch (error: any) {
            console.error('[PROFILE] Error updating profile:', error.message);
            const status = error.message?.includes('7 dias') ? 400 : 500;
            res.status(status).json({ error: error.message || 'Failed to update profile' });
        }
    },

    // Create profile (called during registration)
    async createProfile(req: AuthRequest, res: Response) {
        try {
            if (!req.userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const profileData = req.body;
            const profile = await profileService.createProfile(req.userId, profileData);

            if (!profile) {
                return res.status(500).json({ error: 'Failed to create profile' });
            }

            res.status(201).json(profile);
        } catch (error) {
            console.error('Error creating profile:', error);
            res.status(500).json({ error: 'Failed to create profile' });
        }
    },

    // Check username availability
    async checkUsername(req: AuthRequest, res: Response) {
        try {
            const { username } = req.params;
            const available = await profileService.isUsernameAvailable(username);
            res.json({ available });
        } catch (error) {
            console.error('Error checking username:', error);
            res.status(500).json({ error: 'Failed to check username' });
        }
    },

    // ── ONBOARDING ENDPOINTS ─────────────────────────────────────────────────

    // Mark that user has copied their Nodus URL (step 4 of onboarding)
    async markUrlCopied(req: AuthRequest, res: Response) {
        try {
            if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
            await profileService.updateProfile(req.userId, { hasCopiedUrl: true });
            res.json({ success: true });
        } catch (error) {
            console.error('Error marking URL copied:', error);
            res.status(500).json({ error: 'Failed to update onboarding status' });
        }
    },

    // Dismiss onboarding card permanently (only allowed at 100%)
    async dismissOnboarding(req: AuthRequest, res: Response) {
        try {
            if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
            await profileService.updateProfile(req.userId, { onboardingDismissed: true });
            res.json({ success: true });
        } catch (error) {
            console.error('Error dismissing onboarding:', error);
            res.status(500).json({ error: 'Failed to dismiss onboarding' });
        }
    }
};

