import { Router } from 'express';
import { leadController } from '../controllers/leadController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import rateLimit from 'express-rate-limit';

const router = Router();
const publicLeadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas inscrições. Tente novamente mais tarde.' }
});

// Public routes (for newsletter signups)
router.post('/', publicLeadLimiter, leadController.createLead);

// Protected routes (require authentication)
router.get('/me', authMiddleware, leadController.getMyLeads);
router.delete('/:id', authMiddleware, leadController.deleteLead);

export default router;
