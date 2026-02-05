import { Router } from 'express';
import { profileController } from '../controllers/profileController.js';

const router = Router();

router.get('/', profileController.getProfile);
router.put('/', profileController.updateProfile);

export default router;
