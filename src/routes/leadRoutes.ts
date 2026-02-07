import { Router } from 'express';
import { leadController } from '../controllers/leadController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Public routes (for newsletter signups)
router.post('/', leadController.createLead);

// Protected routes (require authentication)
router.get('/me', authMiddleware, leadController.getMyLeads);
router.delete('/:id', authMiddleware, leadController.deleteLead);

export default router;
