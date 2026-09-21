import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import * as roadmapController from '../controllers/roadmapController.js';
import rateLimit from 'express-rate-limit';

const router = Router();
const roadmapWriteLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas ações na roadmap. Tente novamente mais tarde.' }
});

// Public routes
router.get('/', roadmapController.getTasks);
router.post('/', roadmapWriteLimiter, roadmapController.createTask);
router.post('/:id/vote', roadmapWriteLimiter, roadmapController.voteTask);

// Admin routes
router.patch('/:id/status', authMiddleware, roadmapController.updateTaskStatus);
router.delete('/:id', authMiddleware, roadmapController.deleteTask);

export default router;
