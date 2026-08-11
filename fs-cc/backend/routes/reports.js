import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import * as reports     from '../controllers/reportsController.js';
import * as agentReport from '../controllers/agentReportController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// All reporting endpoints require admin role.
// requireAuth (applied globally in server.js) already validates the JWT;
// requireAdmin additionally verifies role === 'admin', blocking agent-role tokens.
router.use(requireAdmin);

// ── Existing reports (DO NOT MODIFY) ────────────────────────────────────────
router.get('/queue-performance', asyncHandler(reports.queuePerformance));
router.get('/agent-performance', asyncHandler(reports.agentPerformance));
router.get('/ivr-paths',         asyncHandler(reports.ivrPathDistribution));
router.get('/call-volume',       asyncHandler(reports.callVolumeByDay));
router.get('/export',            asyncHandler(reports.exportReport));
router.get('/cdr',               asyncHandler(reports.getCDRReport));

// ── Phase 2: Agent session + activity reports ────────────────────────────────
// Sessions
router.get('/agent-sessions',          asyncHandler(agentReport.sessionsSummary));
router.get('/agent-sessions/:agentId', asyncHandler(agentReport.sessionsList));

// Activity (combined metrics)
router.get('/agent-activity',          asyncHandler(agentReport.activitySummary));
router.get('/agent-activity/:agentId', asyncHandler(agentReport.activityDetail));

// State events (debug / drilldown)
router.get('/agent-state-events/:agentId', asyncHandler(agentReport.stateEventsList));

export default router;
