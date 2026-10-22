import { Router } from 'express';

const router = Router();

// Billing routes disabled
router.post('/p', (req, res) => res.status(200).json({ disabled: true, message: 'Billing desativado.' }));
router.post('/webhook', (req, res) => res.status(200).json({ received: true }));
router.post('/cancel', (req, res) => res.status(200).json({ success: true }));
router.post('/reactivate', (req, res) => res.status(200).json({ success: true }));
router.get('/invoices', (req, res) => res.status(200).json([]));
router.post('/auto-reconcile', (req, res) => res.status(200).json({ success: true }));
router.get('/config', (req, res) => res.status(200).json({ enabled: false }));

export default router;
