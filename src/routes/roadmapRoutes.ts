import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.js';
import * as roadmapController from '../controllers/roadmapController.js';

const router = Router();

// Public routes
router.get('/', roadmapController.getTasks);
router.post('/', roadmapController.createTask);
router.post('/:id/vote', roadmapController.voteTask);

// Admin routes
router.patch('/:id/status', authMiddleware, roadmapController.updateTaskStatus);
router.delete('/:id', authMiddleware, roadmapController.deleteTask);

export default router;
