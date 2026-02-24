import express from 'express';
import { getPlatformStats } from '../controllers/adminController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get platform stats (protected by auth middleware and admin check in controller)
router.get('/stats', authMiddleware, getPlatformStats);

export default router;
