import { Router } from 'express';
import { register, login, requestPasswordReset, verifyResetCode, resetPassword } from '../controllers/authController.js';

const router = Router();

// Public routes - no auth middleware
router.post('/register', register);
router.post('/login', login);
router.post('/request-reset', requestPasswordReset);
router.post('/verify-reset', verifyResetCode);
router.post('/reset-password', resetPassword);

export default router;
