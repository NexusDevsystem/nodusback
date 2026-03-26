import { Router } from 'express';
import { billingController } from '../controllers/billingController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Checkout session creation (authenticated) - Now default is AbacatePay
router.post('/checkout', authMiddleware, billingController.createCheckout);

// Webhook endpoint (AbacatePay)
router.post('/webhook', billingController.handleWebhook);

// Get Public Config (Public)
router.get('/config', billingController.getConfig);

export default router;
