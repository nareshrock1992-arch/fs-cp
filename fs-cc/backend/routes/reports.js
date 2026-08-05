import { Router } from 'express';
import * as reports from '../controllers/reportsController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/queue-performance', asyncHandler(reports.queuePerformance));
router.get('/agent-performance', asyncHandler(reports.agentPerformance));
router.get('/ivr-paths', asyncHandler(reports.ivrPathDistribution));
router.get('/call-volume', asyncHandler(reports.callVolumeByDay));
router.get('/export',     asyncHandler(reports.exportReport));
router.get('/cdr',        asyncHandler(reports.getCDRReport));

export default router;
