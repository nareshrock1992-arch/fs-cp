import { io } from 'socket.io-client';

// Connect to the current page origin — Nginx (prod) and Vite proxy (dev)
// both forward /socket.io to the backend.
export const socket = io('/', {
  path:              import.meta.env.VITE_SOCKET_PATH || '/socket.io',
  autoConnect:       true,
  reconnection:      true,
  reconnectionDelay: 2000,
  transports:        ['websocket', 'polling'],
});

// Authenticate the socket connection as an agent so the backend
// adds this socket to room agent:{agentId} for targeted events.
export function authenticateAgent(token) {
  if (!token) return;
  socket.emit('agent:authenticate', { token });
}
