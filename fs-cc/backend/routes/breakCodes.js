import { Router } from 'express';
import { requirePermission } from '../middleware/auth.js';
import { asyncHandler }      from '../utils/asyncHandler.js';
import * as breakCodes       from '../controllers/breakCodesController.js';

// Mounted at /api/break-codes (behind the global requireAuth in server.js).
// The ENTIRE management surface (read + write) requires the manage_break_codes
// permission (admins implicitly hold all permissions). This is deliberately
// stricter than bare requireAuth: the global /api requireAuth accepts ANY valid
// JWT — including agent-desk tokens (role:'agent') — so without this guard an
// agent token could read the full management list (incl. inactive codes).
// Agents instead consume active, selectable codes via /api/agent-desk/break-codes.
const router = Router();

router.use(requirePermission('manage_break_codes'));

router.get('/',             asyncHandler(breakCodes.listBreakCodes));
router.post('/',            asyncHandler(breakCodes.createBreakCode));
router.put('/:id',          asyncHandler(breakCodes.updateBreakCode));
router.patch('/:id/status', asyncHandler(breakCodes.setBreakCodeStatus));

export default router;
