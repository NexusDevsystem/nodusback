import { Router } from 'express';
import { billingController } from '../controllers/billingController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// Checkout session creation (authenticated)
router.post('/checkout', authMiddleware, billingController.createCheckout);

// Webhook endpoint (must be raw body for Stripe signature)
router.post('/webhook', billingController.handleWebhook);

// Customer portal session (authenticated)
router.post('/portal', authMiddleware, billingController.createPortalSession);

// List invoices (authenticated)
router.get('/invoices', authMiddleware, billingController.getInvoices);

export default router;
