// The real-time layer, previously Socket.IO.
//
// Why it changed: Socket.IO needs a process that stays alive holding an open
// connection per client, plus sticky routing so a client's polling requests
// keep hitting the same process. A serverless function has neither -- it
// exists for the duration of one request. Pusher inverts the problem: the
// browser holds its WebSocket open to Pusher's servers, and this API only ever
// makes a short outbound HTTPS call to say "broadcast this". That call fits
// inside a function invocation, so it works.
//
// Channel naming maps 1:1 onto the old Socket.IO rooms:
//   room `conversation:<id>`  ->  channel `presence-conversation-<id>`
//   room `user:<id>`          ->  channel `private-user-<id>`
// The `presence-` prefix is what gives us the online/offline list for free:
// Pusher tracks who is subscribed and tells everyone else when that changes,
// which is what the old isOnline() room-size check was doing by hand.
const Pusher = require('pusher');
require('dotenv').config();

const isConfigured = Boolean(
  process.env.PUSHER_APP_ID &&
    process.env.PUSHER_KEY &&
    process.env.PUSHER_SECRET &&
    process.env.PUSHER_CLUSTER
);

const pusher = isConfigured
  ? new Pusher({
      appId: process.env.PUSHER_APP_ID,
      key: process.env.PUSHER_KEY,
      secret: process.env.PUSHER_SECRET,
      cluster: process.env.PUSHER_CLUSTER,
      useTLS: true,
    })
  : null;

const conversationChannel = (conversationId) => `presence-conversation-${conversationId}`;
const userChannel = (userId) => `private-user-${userId}`;

// A broadcast that fails must never fail the request with it. By the time we
// get here the message is already committed to Postgres, so the worst case is
// that a recipient sees it on their next refresh instead of instantly --
// which is a much better outcome than a 500 that makes the sender think the
// message was lost and send it again.
async function trigger(channel, event, payload) {
  if (!pusher) {
    console.warn(`Pusher not configured; dropped ${event} on ${channel}`);
    return;
  }
  try {
    await pusher.trigger(channel, event, payload);
  } catch (err) {
    console.error(`Pusher trigger failed (${channel} / ${event}):`, err.message);
  }
}

// Status changes arrive in bursts -- opening a conversation can mark thirty
// messages seen at once. Sending thirty separate events would burn thirty
// messages of the Pusher quota and make the client re-render thirty times, so
// they go out as one event carrying an array.
async function triggerStatuses(conversationId, updates) {
  if (updates.length === 0) return;
  await trigger(conversationChannel(conversationId), 'message-status', { updates });
}

module.exports = {
  pusher,
  isConfigured,
  trigger,
  triggerStatuses,
  conversationChannel,
  userChannel,
};
