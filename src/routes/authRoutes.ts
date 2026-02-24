import { Router } from 'express';
import { register, login } from '../controllers/authController.js';

const router = Router();

// Public routes - no auth middleware
router.post('/register', register);
router.post('/login', login);

export default router;
