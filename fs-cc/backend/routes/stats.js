import { Router } from 'express';
import { getDashboardStats, getQueueStats } from '../controllers/statsController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.get('/dashboard', asyncHandler(getDashboardStats));
router.get('/queues',    asyncHandler(getQueueStats));

export default router;
