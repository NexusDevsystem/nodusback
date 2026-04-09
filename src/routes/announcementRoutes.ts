import express from 'express';
import { announcementController } from '../controllers/announcementController.js';
import { authMiddleware, optionalAuthMiddleware, AuthRequest } from '../middleware/authMiddleware.js';
import { Response, NextFunction } from 'express';

const router = express.Router();

// Middleware to check for superadmin role
const superadminOnly = (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.role !== 'superadmin') {
        return res.status(403).json({ error: 'Acesso negado. Apenas superadmins podem realizar esta ação.' });
    }
    next();
};

// Public/User Route: Get the current active announcement
router.get('/active', optionalAuthMiddleware, announcementController.getActiveAnnouncement);
router.post('/:id/dismiss', authMiddleware, announcementController.dismissAnnouncement);

// Admin Routes (Superadmin only)
router.get('/', authMiddleware, superadminOnly, announcementController.getAllAnnouncements);
router.post('/', authMiddleware, superadminOnly, announcementController.createAnnouncement);
router.patch('/:id', authMiddleware, superadminOnly, announcementController.updateAnnouncement);
router.delete('/:id', authMiddleware, superadminOnly, announcementController.deleteAnnouncement);

export default router;
