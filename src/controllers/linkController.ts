import { Response, Request } from 'express';
import { linkService } from '../services/linkService.js';
import { AuthRequest } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabaseClient.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists - Note: link thumbnails are stored separately
// so they don't clutter the user's main file manager.
const UPLOADS_DIR = path.join(__dirname, '../../uploads/links');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure Multer Storage for Thumbnails
const storage = multer.diskStorage({
    destination: (req: Request, file: Express.Multer.File, cb) => {
        const userId = (req as AuthRequest).userId;
        if (!userId) return cb(new Error('User not authenticated'), '');

        const userDir = path.join(UPLOADS_DIR, userId);
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        cb(null, userDir);
    },
    filename: (req: Request, file: Express.Multer.File, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
        cb(null, `thumb-${name}-${uniqueSuffix}${ext}`);
    }
});

export const uploadThumbnailMiddleware = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit for thumbnails
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images are allowed for thumbnails'));
        }
    }
});

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
    },

    // Upload thumbnail (hidden from general file manager)
    async uploadThumbnail(req: AuthRequest, res: Response) {
        try {
            const file = req.file;
            if (!file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }

            const userId = req.userId;
            const baseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
            const fileUrl = `${baseUrl}/uploads/links/${userId}/${file.filename}`;

            res.json({
                success: true,
                file: {
                    url: fileUrl,
                    filename: file.filename
                }
            });
        } catch (error: any) {
            console.error('Thumbnail upload error:', error);
            res.status(500).json({ error: 'Error uploading thumbnail' });
        }
    }
};
