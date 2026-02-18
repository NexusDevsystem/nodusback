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

    // Update authenticated user's profile
    async updateProfile(req: AuthRequest, res: Response) {
        try {
            if (!req.userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const updates = req.body;

            // Sanitize customCSS to prevent XSS
            if (updates.customCSS) {
                // @ts-ignore
                updates.customCSS = xss(updates.customCSS, {
                    whiteList: {}, // Minimal whitelist, strip tags mostly
                    stripIgnoreTag: true,
                    stripIgnoreTagBody: ['script'] // Explicitly remove script tags
                });
            }

            const profile = await profileService.updateProfile(req.userId, updates);

            if (!profile) {
                return res.status(404).json({ error: 'Profile not found' });
            }

            res.json(profile);
        } catch (error) {
            console.error('Error updating profile:', error);
            res.status(500).json({ error: 'Failed to update profile' });
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
    }
};
