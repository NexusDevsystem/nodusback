import { Router } from 'express';
import { BillingController } from '../controllers/billingController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = Router();

// 🛒 CHECKOUT: Create a billing session (PROTECTED)
// Users must be authenticated to buy a plan
router.post('/checkout', authMiddleware, BillingController.checkout);

// 🔔 WEBHOOK: Listener for AbacatePay events (PUBLIC)
// This is the endpoint you must register in AbacatePay dashboard
router.post('/webhook', BillingController.webhook);

// 🚫 CANCEL: Support for cancellation (PROTECTED)
router.post('/cancel', authMiddleware, BillingController.cancelSubscription);

// 🔄 REACTIVATE: Support for restoring canceled subscription (PROTECTED)
router.post('/reactivate', authMiddleware, BillingController.reactivateSubscription);

// 🧾 INVOICES: Get payment history (PROTECTED)
router.get('/invoices', authMiddleware, BillingController.getInvoices);

// 🔀 RECONCILE: Manually sync plan (PROTECTED)
// Used when the user comes back to the admin to check their status
router.post('/auto-reconcile', authMiddleware, BillingController.autoReconcile);

export default router;
