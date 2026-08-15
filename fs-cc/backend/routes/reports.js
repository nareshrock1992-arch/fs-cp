import { Router } from 'express';
import { requirePermission } from '../middleware/auth.js';
import * as reports     from '../controllers/reportsController.js';
import * as agentReport from '../controllers/agentReportController.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Requires either admin role or the 'view_reports' permission.
// requireAuth (applied globally in server.js) already validates the JWT.
router.use(requirePermission('view_reports'));

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
