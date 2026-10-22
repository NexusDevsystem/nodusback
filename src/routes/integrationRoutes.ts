import express from 'express';
import * as integrationController from '../controllers/integrationController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/me', authMiddleware, integrationController.getMyIntegrations);
router.delete('/:provider', authMiddleware, integrationController.disconnectIntegration);

export default router;
