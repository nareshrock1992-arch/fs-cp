import { Router } from 'express';
import { getDashboardStats, getQueueStats, getBusinessDate } from '../controllers/statsController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.get('/dashboard',     asyncHandler(getDashboardStats));
router.get('/queues',        asyncHandler(getQueueStats));
router.get('/business-date', asyncHandler(getBusinessDate));

export default router;
