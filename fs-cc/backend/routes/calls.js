import { Router } from 'express';
import * as calls from '../controllers/callsController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Active calls (waiting in queue + bridged to agent)
router.get('/live', asyncHandler(calls.listLiveCalls));

// Live queue snapshot direct from mod_callcenter (bypasses DB)
router.get('/live/:queueName/members', asyncHandler(calls.getQueueMembersLive));

// Recent ended calls
router.get('/recent', asyncHandler(calls.listRecentCalls));

export default router;
