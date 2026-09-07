// Single Socket.IO client, created lazily once we have a token (see
// AuthContext). Every component that needs real-time events imports this
// same instance instead of opening its own connection.
import { io } from 'socket.io-client';

let socket = null;

export function connectSocket(token) {
  if (socket) return socket;
  socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000', {
    auth: { token },
    autoConnect: true,
  });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
