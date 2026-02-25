import { Router } from 'express';
import { eventController } from '../controllers/eventController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Protected routes (require authentication)
router.post('/bulk-upsert', authMiddleware, eventController.bulkUpsertEvents);
router.post('/', authMiddleware, eventController.createEvent);
router.put('/:id', authMiddleware, eventController.updateEvent);
router.delete('/:id', authMiddleware, eventController.deleteEvent);

export default router;
