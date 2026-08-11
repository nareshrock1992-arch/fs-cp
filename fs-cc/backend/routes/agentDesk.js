import { Router } from 'express';
import { requireAgentAuth } from '../middleware/auth.js';
import { asyncHandler }     from '../utils/asyncHandler.js';
import * as desk from '../controllers/agentDeskController.js';

const router = Router();

// Public — no JWT required
router.post('/login', asyncHandler(desk.agentLogin));

// Agent-authenticated routes (require role:'agent' JWT)
router.use(requireAgentAuth);
router.get('/me',          asyncHandler(desk.agentMe));
router.post('/status',     asyncHandler(desk.agentSetStatus));
router.get('/queues',      asyncHandler(desk.agentQueues));
router.get('/calls',       asyncHandler(desk.agentCalls));
router.get('/performance', asyncHandler(desk.agentPerformance));
router.get('/esl-status',  asyncHandler(desk.eslStatus));

export default router;
