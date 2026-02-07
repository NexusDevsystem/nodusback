import { Router } from 'express';
import { musicController } from '../controllers/musicController.js';

const router = Router();

router.get('/metadata', musicController.getMetadata);

export default router;
