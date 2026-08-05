import { Router } from 'express';
import * as agents from '../controllers/agentsController.js';
import { setAgentPin } from '../controllers/agentDeskController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(agents.listAgents));
router.get('/:agentId', asyncHandler(agents.getAgent));
router.get('/:agentId/history', asyncHandler(agents.getAgentHistory));
router.post('/', asyncHandler(agents.createAgent));
router.put('/:agentId', asyncHandler(agents.updateAgent));
router.delete('/:agentId', asyncHandler(agents.deleteAgent));
router.post('/:agentId/status', asyncHandler(agents.setAgentStatus));
router.post('/:agentId/state', asyncHandler(agents.setAgentState));
router.post('/:agentId/set-pin', asyncHandler(setAgentPin));

export default router;
