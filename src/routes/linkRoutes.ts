import { Router } from 'express';
import { linkController } from '../controllers/linkController.js';

const router = Router();

router.get('/', linkController.getAllLinks);
router.post('/', linkController.createLink);
router.put('/bulk', linkController.replaceAllLinks);
router.put('/:id', linkController.updateLink);
router.delete('/:id', linkController.deleteLink);

export default router;
