import { Router } from 'express';
import { billingController } from '../controllers/billingController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Checkout session creation (authenticated)
router.post('/checkout', authMiddleware, billingController.createCheckout);

// Webhook endpoint (must be raw body for Stripe signature)
router.post('/webhook', billingController.handleWebhook);

export default router;
