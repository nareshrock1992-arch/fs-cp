import { useEffect } from 'react';
import { io } from 'socket.io-client';

// Connect to the same origin as the page — no IP or port needed.
//
// Production: browser is at http://192.168.1.x:8000, so Socket.IO connects
//   to http://192.168.1.x:8000/socket.io, which Nginx proxies → backend:4000.
//
// Dev: browser is at http://localhost:5173, Vite proxies /socket.io → localhost:4000.
//
// Either way, no absolute URL or IP is required in this file.
export const socket = io('/', {
  path:             import.meta.env.VITE_SOCKET_PATH || '/socket.io',
  autoConnect:      true,
  reconnection:     true,
  reconnectionDelay: 2000,
  transports:       ['websocket', 'polling'],
});

export function useSocketEvent(eventName, handler) {
  useEffect(() => {
    socket.on(eventName, handler);
    return () => socket.off(eventName, handler);
  }, [eventName, handler]);
}
