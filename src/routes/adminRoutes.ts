import express from 'express';
import { getPlatformStats, updateUserProfile, deleteUser, getUserStats } from '../controllers/adminController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get platform stats
router.get('/stats', authMiddleware, getPlatformStats);

// Update user profile (verified, category, etc)
router.patch('/users/:targetUserId', authMiddleware, updateUserProfile);

// Delete user
router.delete('/users/:targetUserId', authMiddleware, deleteUser);

// Get individual user stats
router.get('/users/:targetUserId/stats', authMiddleware, getUserStats);

export default router;
