// Single Pusher connection, created once we have a token (see AuthContext).
// Replaces the old Socket.IO client.
//
// One connection carries every channel, so subscribing to twenty conversations
// costs one WebSocket, not twenty -- which matters, because Pusher's free tier
// counts concurrent connections (100) and not channels.
import Pusher from 'pusher-js';
import { API_BASE } from './client';

let pusher = null;

export function isRealtimeConfigured() {
  return Boolean(import.meta.env.VITE_PUSHER_KEY && import.meta.env.VITE_PUSHER_CLUSTER);
}

export function connectRealtime(token) {
  if (pusher) return pusher;
  if (!isRealtimeConfigured()) {
    console.warn(
      'VITE_PUSHER_KEY / VITE_PUSHER_CLUSTER are not set — live updates are off. ' +
        'Messages still send and load, they just will not appear without a refresh.'
    );
    return null;
  }

  pusher = new Pusher(import.meta.env.VITE_PUSHER_KEY, {
    cluster: import.meta.env.VITE_PUSHER_CLUSTER,
    // Private and presence channels are authorized by our own API, which
    // checks the JWT and conversation membership before handing back a
    // signature. Pusher never sees the token itself.
    channelAuthorization: {
      endpoint: `${API_BASE}/pusher/auth`,
      headers: { Authorization: `Bearer ${token}` },
    },
  });

  return pusher;
}

export function getRealtime() {
  return pusher;
}

export function disconnectRealtime() {
  if (pusher) {
    pusher.disconnect();
    pusher = null;
  }
}

export const conversationChannelName = (conversationId) => `presence-conversation-${conversationId}`;
export const userChannelName = (userId) => `private-user-${userId}`;

// pusher-js returns the existing channel object if you're already subscribed,
// so components can call this without coordinating who subscribed first.
export function subscribe(channelName) {
  return pusher ? pusher.subscribe(channelName) : null;
}

export function unsubscribe(channelName) {
  if (pusher) pusher.unsubscribe(channelName);
}
