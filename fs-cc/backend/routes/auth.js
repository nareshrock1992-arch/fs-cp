import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { login, me }   from '../controllers/authController.js';

const router = Router();

router.post('/login', asyncHandler(login));
router.get('/me',     requireAuth, asyncHandler(me));

export default router;
