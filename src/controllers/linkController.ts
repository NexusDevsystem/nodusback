import { Request, Response } from 'express';
import { linkService } from '../services/linkService.js';

export const linkController = {
    async getAllLinks(req: Request, res: Response) {
        try {
            const links = await linkService.getAllLinks();
            res.json(links);
        } catch (error) {
            console.error('Error fetching links:', error);
            res.status(500).json({ error: 'Failed to fetch links' });
        }
    },

    async createLink(req: Request, res: Response) {
        try {
            const link = await linkService.createLink(req.body);
            res.status(201).json(link);
        } catch (error) {
            console.error('Error creating link:', error);
            res.status(500).json({ error: 'Failed to create link' });
        }
    },

    async updateLink(req: Request, res: Response) {
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

    async deleteLink(req: Request, res: Response) {
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

    async replaceAllLinks(req: Request, res: Response) {
        try {
            const links = await linkService.replaceAllLinks(req.body);
            res.json(links);
        } catch (error) {
            console.error('Error replacing links:', error);
            res.status(500).json({ error: 'Failed to replace links' });
        }
    }
};
