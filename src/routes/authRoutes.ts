import { Router } from 'express';
import { register, login, requestPasswordReset, verifyResetCode, resetPassword } from '../controllers/authController.js';
import rateLimit from 'express-rate-limit';

const router = Router();
const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de recuperação. Tente novamente mais tarde.' }
});

// Public routes - no auth middleware
router.post('/register', register);
router.post('/login', login);
router.post('/request-reset', passwordResetLimiter, requestPasswordReset);
router.post('/verify-reset', passwordResetLimiter, verifyResetCode);
router.post('/reset-password', passwordResetLimiter, resetPassword);

export default router;
