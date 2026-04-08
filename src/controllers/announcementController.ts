import { Request, Response } from 'express';
import { announcementService } from '../services/announcementService.js';
import { announcementApiToDb } from '../models/types.js';
import { AuthRequest } from '../middleware/authMiddleware.js';

export const announcementController = {
    async getActiveAnnouncement(req: AuthRequest, res: Response) {
        try {
            const announcement = await announcementService.getActiveAnnouncement(req.email);
            if (!announcement) {
                return res.status(204).send();
            }
            res.json(announcement);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },

    async getAllAnnouncements(req: AuthRequest, res: Response) {
        try {
            const announcements = await announcementService.getAll();
            res.json(announcements);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },

    async createAnnouncement(req: AuthRequest, res: Response) {
        try {
            const dbAnnouncement = announcementApiToDb(req.body);
            const announcement = await announcementService.create(dbAnnouncement);
            res.status(201).json(announcement);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },

    async updateAnnouncement(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const dbUpdates = announcementApiToDb(req.body);
            const announcement = await announcementService.update(id, dbUpdates);
            res.json(announcement);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    },

    async deleteAnnouncement(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            await announcementService.delete(id);
            res.status(204).send();
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }
};
