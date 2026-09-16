import { Router } from 'express';
import { getDashboardStats, getQueueStats, getBusinessDate, getLiveAgents } from '../controllers/statsController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.get('/dashboard',     asyncHandler(getDashboardStats));
router.get('/queues',        asyncHandler(getQueueStats));
router.get('/business-date', asyncHandler(getBusinessDate));
router.get('/live-agents',   asyncHandler(getLiveAgents));

export default router;
