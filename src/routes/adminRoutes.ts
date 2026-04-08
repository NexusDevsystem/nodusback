import express from 'express';
import { getPlatformStats, updateUserProfile, deleteUser, getUserStats, createUser } from '../controllers/adminController.js';
import { getAdminVerificationRequests, reviewVerificationRequest } from '../controllers/verificationController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get platform stats
router.get('/stats', authMiddleware, getPlatformStats);

// Update user profile (verified, category, etc)
router.patch('/users/:targetUserId', authMiddleware, updateUserProfile);

// Create new user manually
router.post('/users', authMiddleware, createUser);

// Delete user
router.delete('/users/:targetUserId', authMiddleware, deleteUser);

// Get individual user stats
router.get('/users/:targetUserId/stats', authMiddleware, getUserStats);

// Verification requests management
router.get('/verifications', authMiddleware, getAdminVerificationRequests);
router.patch('/verifications/:id/review', authMiddleware, reviewVerificationRequest);

export default router;
