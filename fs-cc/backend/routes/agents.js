import { Router } from 'express';
import * as agents from '../controllers/agentsController.js';
import { setAgentPin } from '../controllers/agentDeskController.js';
import { requireAdmin, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// ── Read-only (any authenticated user) ───────────────────────────────────────
router.get('/',                asyncHandler(agents.listAgents));
router.get('/:agentId',        asyncHandler(agents.getAgent));
router.get('/:agentId/history', asyncHandler(agents.getAgentHistory));

// ── Agent availability status (admin OR supervisor with change_agent_state) ───
// Controls Ready / On Break / Logged Out — human supervisory action.
router.post('/:agentId/status', requirePermission('change_agent_state'), asyncHandler(agents.setAgentStatus));

// ── Internal FreeSWITCH call-engagement state (admin only) ───────────────────
// Controls Waiting / Receiving / In a queue call — mod_callcenter internal state.
// Supervisor access to this endpoint is not granted even with change_agent_state.
router.post('/:agentId/state',  requireAdmin, asyncHandler(agents.setAgentState));

// ── Admin-only mutations ──────────────────────────────────────────────────────
router.post('/',                 requireAdmin, asyncHandler(agents.createAgent));
router.put('/:agentId',          requireAdmin, asyncHandler(agents.updateAgent));
router.delete('/:agentId',       requireAdmin, asyncHandler(agents.deleteAgent));
router.post('/:agentId/set-pin', requireAdmin, asyncHandler(setAgentPin));

export default router;
