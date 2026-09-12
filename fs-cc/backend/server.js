import express from 'express';
import http    from 'http';
import cors    from 'cors';
import morgan  from 'morgan';

import { config, assertBusinessTimezone } from './config/index.js';
import { connectESL, isConnected } from './services/eslService.js';
import { initSocket }      from './services/socketService.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import { warmPool, pool, query } from './db/pool.js';
import { runMigrations }   from './db/migrationRunner.js';
import { writeAndReloadXml, generateCallcenterXml } from './utils/queueXml.js';
import { asyncHandler }    from './utils/asyncHandler.js';

import authRoutes      from './routes/auth.js';
import usersRoutes     from './routes/users.js';
import agentsRoutes    from './routes/agents.js';
import queuesRoutes    from './routes/queues.js';
import callsRoutes     from './routes/calls.js';
import statsRoutes     from './routes/stats.js';
import reportsRoutes   from './routes/reports.js';
import breakCodesRoutes from './routes/breakCodes.js';
import agentDeskRoutes from './routes/agentDesk.js';

const app    = express();
const server = http.createServer(app);

app.use(cors({ origin: config.cors.origin }));
app.use(express.json());
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

// ── Health check (public) ─────────────────────────────────────────────────────
// Liveness — process is up (no dependency checks).
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString(), env: config.env })
);

// Readiness — verifies the critical dependency (PostgreSQL) is actually
// reachable, plus reports ESL connectivity. Returns 503 when the DB is down so
// an orchestrator/health probe does not treat a DB-less backend as healthy.
// Exposes no secrets — only boolean dependency status.
app.get('/api/health/ready', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, db: true, esl: isConnected() });
  } catch {
    res.status(503).json({ ok: false, db: false, esl: isConnected() });
  }
});

// ── Agent Desktop (public login + agent-authenticated endpoints) ──────────────
app.use('/api/agent-desk', agentDeskRoutes);

// ── Admin API (requires admin JWT) ───────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);
app.use('/api/users',   usersRoutes);
app.use('/api/agents',  agentsRoutes);
app.use('/api/queues',  queuesRoutes);
app.use('/api/calls',   callsRoutes);
app.use('/api/stats',   statsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/break-codes', breakCodesRoutes);

// ── Queue XML export (admin only) ─────────────────────────────────────────────
app.post('/api/queues/export-xml', requireAdmin, asyncHandler(async (_req, res) => {
  const result = await writeAndReloadXml();
  res.json(result);
}));

app.get('/api/queues/preview-xml', requireAdmin, asyncHandler(async (_req, res) => {
  const xml = await generateCallcenterXml();
  res.type('text/xml').send(xml);
}));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  console.error('[api]', err.message || err);
  // Never leak internal (e.g. raw SQL/driver) error text to clients on a 5xx in
  // production; intentional 4xx messages (validation/not-found/conflict) are
  // still surfaced so clients get actionable feedback.
  const clientMessage = (status >= 500 && config.env === 'production')
    ? 'Internal server error'
    : (err.message || 'Internal server error');
  res.status(status).json({ error: clientMessage });
});

initSocket(server, config.cors.origin);

// Run DB setup before binding the port so no HTTP request can reach the
// application against a partially migrated schema.
async function start() {
  try {
    // Fail fast if the business/reporting timezone is missing or invalid — a wrong
    // BUSINESS_TIMEZONE silently corrupts every business-day report, so refuse to start.
    assertBusinessTimezone();
    await warmPool();
    await runMigrations();
  } catch (err) {
    console.error('[startup] fatal — DB setup failed:', err.message);
    process.exit(1);
  }

  server.listen(config.port, () => {
    console.log(`[server] ✓ listening on :${config.port}  env:${config.env}  cors:${config.cors.origin}`);
    connectESL();
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// On SIGTERM/SIGINT (docker stop, orchestrator drain, Ctrl-C): stop accepting
// new connections, then close the DB pool, then exit. A watchdog forces exit if
// something hangs so the container never gets stuck. Idempotent via `shuttingDown`.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received — shutting down gracefully`);
  const watchdog = setTimeout(() => {
    console.error('[server] shutdown watchdog fired — forcing exit');
    process.exit(1);
  }, 10_000);
  watchdog.unref();
  try {
    await new Promise((resolve) => server.close(resolve)); // drain in-flight HTTP
    await pool.end();                                       // close DB pool cleanly
    console.log('[server] clean shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[server] error during shutdown:', err.message);
    process.exit(1);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

start();
