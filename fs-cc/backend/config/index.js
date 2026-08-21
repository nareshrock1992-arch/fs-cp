/**
 * Single source of truth for all runtime configuration.
 *
 * Every backend module imports from here instead of reading
 * process.env directly. This means:
 *   - One place to audit what the app needs
 *   - Defaults that make local dev work with zero config changes
 *   - No accidental hardcoded IPs anywhere else in the codebase
 */

import 'dotenv/config';

export const config = {
  env:  process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),

  cors: {
    // Comma-separated list of allowed origins.
    // Dev:  http://localhost:5173 (admin UI) + http://localhost:8080 (agent desktop)
    // Prod: http://<SERVER_IP>:8000,http://<SERVER_IP>:8080
    // cors() and Socket.IO both accept a string array.
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : ['http://localhost:5173', 'http://localhost:8080'],
  },

  db: {
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME     || 'fs_cc',
    user:     process.env.DB_USER     || 'fs_cc',
    password: process.env.DB_PASSWORD || 'changeme',
    max:      Number(process.env.DB_POOL_MAX || 10),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis:       30_000,
  },

  esl: {
    host:        process.env.FS_ESL_HOST            || 'localhost',
    port:        Number(process.env.FS_ESL_PORT     || 8021),
    password:    process.env.FS_ESL_PASSWORD        || 'ClueCon',
    reconnectMs: Number(process.env.FS_ESL_RECONNECT_MS || 3000),
  },

  jwt: {
    // MUST be overridden in production via JWT_SECRET env var.
    secret: process.env.JWT_SECRET || 'insecure-dev-secret-CHANGE-IN-PRODUCTION',
  },

  fs: {
    // Path to FreeSWITCH conf directory (e.g. /etc/freeswitch).
    // Used by queueXml.js to write callcenter.conf.xml.
    // Leave unset to skip file write (XML still generated in memory).
    confPath: process.env.FS_CONF_PATH || null,

    // SIP domain / IP of the FreeSWITCH internal profile.
    // Used to build agent contact strings for internal (user/ext@domain) endpoints.
    // Production value supplied by fs-cp deploy/.env SIP_DOMAIN → FS_SIP_DOMAIN.
    // Dev value: the IP of the FreeSWITCH server's internal SIP profile.
    sipDomain: process.env.FS_SIP_DOMAIN || '',
  },
};

// Warn loudly if running in production with obvious insecure defaults
if (config.env === 'production') {
  if (config.jwt.secret.includes('CHANGE-IN-PRODUCTION')) {
    console.error('[config] FATAL: JWT_SECRET is not set. Set it in your .env file.');
    process.exit(1);
  }
  if (config.db.password === 'changeme') {
    console.warn('[config] WARNING: DB_PASSWORD is still "changeme". Change it in production.');
  }
}
