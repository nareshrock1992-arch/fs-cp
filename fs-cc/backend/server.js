import express from 'express';
import http    from 'http';
import cors    from 'cors';
import morgan  from 'morgan';

import { config }          from './config/index.js';
import { connectESL }      from './services/eslService.js';
import { initSocket }      from './services/socketService.js';
import { requireAuth }     from './middleware/auth.js';
import { warmPool }        from './db/pool.js';
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
import agentDeskRoutes from './routes/agentDesk.js';

const app    = express();
const server = http.createServer(app);

app.use(cors({ origin: config.cors.origin }));
app.use(express.json());
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

// ── Health check (public) ─────────────────────────────────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, ts: new Date().toISOString(), env: config.env })
);

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

// ── Queue XML export (admin only, already behind requireAuth above) ───────────
app.post('/api/queues/export-xml', asyncHandler(async (_req, res) => {
  const result = await writeAndReloadXml();
  res.json(result);
}));

app.get('/api/queues/preview-xml', asyncHandler(async (_req, res) => {
  const xml = await generateCallcenterXml();
  res.type('text/xml').send(xml);
}));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[api]', err.message || err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

initSocket(server, config.cors.origin);

server.listen(config.port, async () => {
  console.log(`[server] ✓ listening on :${config.port}  env:${config.env}  cors:${config.cors.origin}`);
  try { await warmPool(); } catch (err) { console.error('[db] warm-up failed:', err.message); }
  try { await runMigrations(); } catch (err) {
    console.error('[db] migration failed — shutting down:', err.message);
    process.exit(1);
  }
  connectESL();
});
