import { Server } from 'socket.io';
import jwt         from 'jsonwebtoken';
import { ccEvents, isConnected } from './eslService.js';
import { config } from '../config/index.js';

let io = null;

// Events broadcast to ALL connected clients (admin + agent desktops)
const BROADCAST_EVENTS = [
  'esl:status',
  'agent:status',
  'agent:state',
  'agent:update',
  'queue:update',
  'call:enqueued',
  'call:abandoned',
  'call:bridged',
  'call:bridge-end',
  'channel:create',
  'channel:answer',
  'channel:hangup',
  'agent:offering',
  'agent:no-answer',
];

// Events also emitted to the specific agent's room so the Agent Desktop
// can subscribe to its own events without client-side filtering noise.
const AGENT_TARGETED_EVENTS = {
  'agent:status':   (p) => p.agentId,
  'agent:state':    (p) => p.agentId,
  'agent:offering': (p) => p.agentId,
  'agent:no-answer':(p) => p.agentId,
  'call:bridged':   (p) => p.agentId,
};

export function initSocket(httpServer, corsOrigin) {
  io = new Server(httpServer, {
    path: process.env.SOCKET_PATH || '/socket.io',
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`[socket] client connected: ${socket.id}`);

    // Send current ESL status immediately
    socket.emit('esl:status', { connected: isConnected() });

    // ── Agent Desktop authentication ──────────────────────────────────────────
    // Agent Desktop clients authenticate after connecting by sending their JWT.
    // On success the socket joins room agent:{agentId} and agent-specific events
    // are also emitted there, so the Agent Desktop only needs to listen to its room.
    socket.on('agent:authenticate', ({ token } = {}) => {
      if (!token) return;
      try {
        const decoded = jwt.verify(token, config.jwt.secret);
        if (decoded.role !== 'agent') return;
        socket.join(`agent:${decoded.agentId}`);
        socket.agentId = decoded.agentId;
        socket.emit('agent:authenticated', { agentId: decoded.agentId });
        console.log(`[socket] agent ${decoded.agentId} joined room agent:${decoded.agentId}`);
      } catch {
        socket.emit('agent:auth-failed');
      }
    });

    socket.on('disconnect', () => {
      console.log(`[socket] client disconnected: ${socket.id}`);
    });
  });

  // ── Broadcast all normalized CC events to every connected client ──────────
  BROADCAST_EVENTS.forEach((eventName) => {
    ccEvents.on(eventName, (payload) => {
      io.emit(eventName, payload);

      // Also emit agent-specific events to the agent's private room
      const getAgentId = AGENT_TARGETED_EVENTS[eventName];
      if (getAgentId) {
        const agentId = getAgentId(payload);
        if (agentId) {
          io.to(`agent:${agentId}`).emit(eventName, payload);
        }
      }
    });
  });

  return io;
}

export function getIO() {
  if (!io) throw new Error('Socket.IO not initialized yet');
  return io;
}
