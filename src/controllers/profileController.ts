import { Request, Response } from 'express';
import { profileService } from '../services/profileService.js';

export const profileController = {
    async getProfile(req: Request, res: Response) {
        try {
            const profile = await profileService.getProfile();
            res.json(profile);
        } catch (error) {
            console.error('Error fetching profile:', error);
            res.status(500).json({ error: 'Failed to fetch profile' });
        }
    },

    async updateProfile(req: Request, res: Response) {
        try {
            const updates = req.body;
            const profile = await profileService.updateProfile(updates);
            res.json(profile);
        } catch (error) {
            console.error('Error updating profile:', error);
            res.status(500).json({ error: 'Failed to update profile' });
        }
    }
};
