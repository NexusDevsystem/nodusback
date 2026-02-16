import { Response } from 'express';
import { linkService } from '../services/linkService.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabaseClient.js';

export const linkController = {
    // Get all links for authenticated user
    async getMyLinks(req: AuthRequest, res: Response) {
        try {
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const links = await linkService.getLinksByProfileId(req.profileId);
            res.json(links);
        } catch (error) {
            console.error('Error fetching links:', error);
            res.status(500).json({ error: 'Failed to fetch links' });
        }
    },

    // Get links by username (public access)
    async getLinksByUsername(req: AuthRequest, res: Response) {
        try {
            const { username } = req.params;

            // First get the profile to get user_id
            const { data: profile } = await supabase
                .from('users')
                .select('id')
                .ilike('username', username)
                .single();

            if (!profile) {
                return res.status(404).json({ error: 'Profile not found' });
            }

            const links = await linkService.getLinksByProfileId(profile.id);
            res.json(links);
        } catch (error) {
            console.error('Error fetching links:', error);
            res.status(500).json({ error: 'Failed to fetch links' });
        }
    },

    // Create a new link
    async createLink(req: AuthRequest, res: Response) {
        try {
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const link = await linkService.createLink(req.profileId, req.body);

            if (!link) {
                return res.status(500).json({ error: 'Failed to create link' });
            }

            res.status(201).json(link);
        } catch (error) {
            console.error('Error creating link:', error);
            res.status(500).json({ error: 'Failed to create link' });
        }
    },

    // Update a link
    async updateLink(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const link = await linkService.updateLink(id, req.body);

            if (!link) {
                return res.status(404).json({ error: 'Link not found' });
            }

            res.json(link);
        } catch (error) {
            console.error('Error updating link:', error);
            res.status(500).json({ error: 'Failed to update link' });
        }
    },

    // Delete a link
    async deleteLink(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const deleted = await linkService.deleteLink(id);

            if (!deleted) {
                return res.status(404).json({ error: 'Link not found' });
            }

            res.status(204).send();
        } catch (error) {
            console.error('Error deleting link:', error);
            res.status(500).json({ error: 'Failed to delete link' });
        }
    },

    // Replace all links (bulk update)
    async replaceAllLinks(req: AuthRequest, res: Response) {
        try {
            if (!req.profileId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { links } = req.body;
            if (!Array.isArray(links)) {
                return res.status(400).json({ error: 'Invalid request: links must be an array' });
            }

            const savedLinks = await linkService.replaceAllLinks(req.profileId, links);
            res.json(savedLinks);
        } catch (error) {
            console.error('Error replacing links:', error);
            res.status(500).json({ error: 'Failed to replace links' });
        }
    },

    // Track click
    async trackClick(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            await linkService.incrementClicks(id);
            res.status(204).send();
        } catch (error) {
            console.error('Error tracking click:', error);
            res.status(500).json({ error: 'Failed to track click' });
        }
    }
};
