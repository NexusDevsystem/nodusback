import express from 'express';
import { submitVerificationRequest, getMyVerificationRequest } from '../controllers/verificationController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Submit a new verification request (authenticated user, Pro only)
router.post('/request', authMiddleware, submitVerificationRequest);

// Get my latest verification request status
router.get('/my', authMiddleware, getMyVerificationRequest);

export default router;
