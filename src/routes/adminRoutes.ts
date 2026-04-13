import express from 'express';
import { 
    getPlatformStats, 
    updateUserProfile, 
    deleteUser, 
    getUserStats, 
    createUser, 
    impersonateUser 
} from '../controllers/adminController.js';
import { getAdminVerificationRequests, reviewVerificationRequest } from '../controllers/verificationController.js';
import { authMiddleware, AuthRequest } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabaseClient.js';

const router = express.Router();

// Get platform stats
router.get('/stats', authMiddleware, getPlatformStats);

// List all user emails for announcements
router.get('/users/emails', authMiddleware, (req: AuthRequest, res: any, next) => {
    if (req.role !== 'superadmin') return res.status(403).json({ error: 'Acesso negado' });
    next();
}, async (req: any, res: any) => {
    try {
        const { data, error } = await supabase.from('users').select('email').order('email');
        if (error) throw error;
        res.json(data.map((u: any) => u.email));
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Update user profile (verified, category, etc)
router.patch('/users/:targetUserId', authMiddleware, updateUserProfile);

// Create new user manually
router.post('/users', authMiddleware, createUser);

// Impersonate user (Ghost mode)
router.post('/users/:targetUserId/impersonate', authMiddleware, impersonateUser);

// Delete user
router.delete('/users/:targetUserId', authMiddleware, deleteUser);

// Get individual user stats
router.get('/users/:targetUserId/stats', authMiddleware, getUserStats);

// Verification requests management
router.get('/verifications', authMiddleware, getAdminVerificationRequests);
router.patch('/verifications/:id/review', authMiddleware, reviewVerificationRequest);

export default router;
