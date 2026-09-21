import { Request, Response } from 'express';
import { announcementService } from '../services/announcementService.js';
import { announcementApiToDb } from '../models/types.js';
import { AuthRequest } from '../middleware/authMiddleware.js';

export const announcementController = {
    async getActiveAnnouncement(req: AuthRequest, res: Response) {
        try {
            const userId = req.userId;
            const userEmail = req.email;
            
            const announcement = await announcementService.getActiveAnnouncement(userId, userEmail);
            if (!announcement) {
                return res.status(204).send();
            }
            res.json(announcement);
        } catch (error: any) {
            console.error('[Announcements] Failed to load active announcement:', error);
            res.status(500).json({ error: 'Failed to load announcement' });
        }
    },

    async dismissAnnouncement(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const userId = req.userId;
            
            if (!userId) {
                return res.status(401).json({ error: 'Não autorizado' });
            }

            await announcementService.dismiss(id, userId);
            res.json({ success: true });
        } catch (error: any) {
            console.error('[Announcements] Failed to dismiss announcement:', error);
            res.status(500).json({ error: 'Failed to dismiss announcement' });
        }
    },

    async getAllAnnouncements(req: AuthRequest, res: Response) {
        try {
            const announcements = await announcementService.getAll();
            res.json(announcements);
        } catch (error: any) {
            console.error('[Announcements] Failed to list announcements:', error);
            res.status(500).json({ error: 'Failed to list announcements' });
        }
    },

    async createAnnouncement(req: AuthRequest, res: Response) {
        try {
            const dbAnnouncement = announcementApiToDb(req.body);
            const announcement = await announcementService.create(dbAnnouncement);
            res.status(201).json(announcement);
        } catch (error: any) {
            console.error('[Announcements] Failed to create announcement:', error);
            res.status(500).json({ error: 'Failed to create announcement' });
        }
    },

    async updateAnnouncement(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            const dbUpdates = announcementApiToDb(req.body);
            const announcement = await announcementService.update(id, dbUpdates);
            res.json(announcement);
        } catch (error: any) {
            console.error('[Announcements] Failed to update announcement:', error);
            res.status(500).json({ error: 'Failed to update announcement' });
        }
    },

    async deleteAnnouncement(req: AuthRequest, res: Response) {
        try {
            const { id } = req.params;
            await announcementService.delete(id);
            res.status(204).send();
        } catch (error: any) {
            console.error('[Announcements] Failed to delete announcement:', error);
            res.status(500).json({ error: 'Failed to delete announcement' });
        }
    }
};
