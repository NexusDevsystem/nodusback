import { Router } from 'express';
import { billingController } from '../controllers/billingController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Checkout session creation (authenticated) - Now default is AbacatePay
router.post('/checkout', authMiddleware, billingController.createCheckout);

// Webhook endpoint (AbacatePay)
router.post('/webhook', billingController.handleWebhook);

// Auto-reconcile (Check payment status manually)
router.post('/auto-reconcile', authMiddleware, billingController.handleAutoReconcile);

// Get Public Config (Public)
router.get('/config', billingController.getConfig);

// Test Ping (Public)
router.get('/ping', (req, res) => res.json({ message: 'billing router is alive' }));

export default router;
