import { Router } from 'express';
import { leadController } from '../controllers/leadController.js';

const router = Router();

router.get('/', leadController.getAllLeads);
router.post('/', leadController.createLead);
router.delete('/:id', leadController.deleteLead);

export default router;
