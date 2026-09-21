// Everything that used to be a socket.on(...) handler now lives here as a
// normal HTTP endpoint, with the broadcast that followed it turned into a
// Pusher trigger. The state machine itself is unchanged:
//
//   sending   -- client-only, optimistic, never touches the server
//   sent      -- the message row + message_status rows exist
//   delivered -- the recipient's browser has the message in hand
//   seen      -- the recipient had the conversation open and read it
//
// The one real design change is how 'delivered' is decided. Socket.IO could
// answer "is this user online right now?" by looking at the size of their room
// in its in-memory adapter. Nothing in a serverless function knows that -- and
// asking Pusher over HTTP on every send would add a round trip to the critical
// path. So delivery is now acknowledged by the recipient instead: their client
// POSTs /api/messages/delivered when a message arrives, and again with no body
// on page load to sweep up anything that piled up while they were offline
// (which is what the old on-connect UPDATE did). That's both cheaper and more
// honest -- "their browser confirmed it has the message" is a stronger claim
// than "a socket was open a moment ago".
const { query } = require('../config/db');
const convService = require('../services/conversations.service');
const messagesService = require('../services/messages.service');
const { trigger, triggerStatuses, conversationChannel } = require('../realtime/pusher');

const VALID_TYPES = new Set(['text', 'image']);

// GET /api/conversations/:id/messages?before=<ISO timestamp>&limit=30
// Cursor-based pagination (by created_at) so "load older messages" while
// scrolling up doesn't skip/repeat rows the way OFFSET pagination can once
// new messages are being inserted concurrently.
async function listMessages(req, res, next) {
  try {
    const conversationId = req.params.id;
    await convService.assertParticipant(conversationId, req.user.id);

    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const before = req.query.before ? new Date(req.query.before) : new Date();

    const { rows: messages } = await query(
      `SELECT * FROM messages
       WHERE conversation_id = $1 AND created_at < $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [conversationId, before, limit]
    );

    if (messages.length === 0) return res.json({ messages: [] });

    const messageIds = messages.map((m) => m.id);
    const { rows: statuses } = await query(
      `SELECT * FROM message_status WHERE message_id = ANY($1::uuid[])`,
      [messageIds]
    );
    const statusesByMessage = statuses.reduce((acc, s) => {
      (acc[s.message_id] = acc[s.message_id] || []).push({ userId: s.user_id, status: s.status });
      return acc;
    }, {});

    const enriched = messages
      .map((m) => ({ ...m, statuses: statusesByMessage[m.id] || [] }))
      .reverse(); // oldest -> newest, the order a chat window renders in

    res.json({ messages: enriched });
  } catch (err) {
    next(err);
  }
}

// POST /api/conversations/:id/messages
//   { type: 'text',  body, clientTempId }
//   { type: 'image', imageUrl, clientTempId }
//
// Replaces the socket 'message:send' event. The sender learns the message was
// accepted from this response (their "sending -> sent" transition) and every
// participant -- sender included -- gets it over Pusher. Both arriving is
// fine and expected: the client dedupes on client_temp_id, and whichever
// lands first wins.
async function sendMessage(req, res, next) {
  try {
    const conversationId = req.params.id;
    await convService.assertParticipant(conversationId, req.user.id);

    const { type = 'text', body = null, imageUrl = null, clientTempId = null } = req.body || {};

    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ error: "type must be 'text' or 'image'" });
    }
    if (type === 'text' && (!body || !body.trim())) {
      return res.status(400).json({ error: 'body is required for a text message' });
    }
    if (type === 'image' && !imageUrl) {
      return res.status(400).json({ error: 'imageUrl is required for an image message' });
    }

    const { message } = await messagesService.createMessage({
      conversationId,
      senderId: req.user.id,
      type,
      body: type === 'text' ? body.trim() : null,
      imageUrl: type === 'image' ? imageUrl : null,
      clientTempId,
    });

    await trigger(conversationChannel(conversationId), 'message-new', { ...message, statuses: [] });

    res.status(201).json({ message });
  } catch (err) {
    next(err);
  }
}

// POST /api/messages/delivered   { messageIds?: [...] }
//
// With ids: the recipient's client acknowledging messages it just received.
// Without: sweep every message still at 'sent' for this user, which is the
// "I was offline, catch me up" case the old socket connect handler covered.
async function markDelivered(req, res, next) {
  try {
    const { messageIds = null } = req.body || {};

    const { rows, byConversation } = await messagesService.advanceStatus({
      userId: req.user.id,
      status: 'delivered',
      messageIds: Array.isArray(messageIds) ? messageIds : null,
      only: 'sent', // never pull a message back from 'seen'
    });

    await Promise.all(
      Object.entries(byConversation).map(([conversationId, updates]) =>
        triggerStatuses(conversationId, updates)
      )
    );

    res.json({ delivered: rows.map((r) => r.message_id) });
  } catch (err) {
    next(err);
  }
}

// POST /api/conversations/:id/messages/seen   { messageIds?: [...] }
//
// Replaces the socket 'message:seen' event. Omitting messageIds marks the
// whole conversation read, which is what the conversation-level read receipt
// (POST /api/conversations/:id/read) does.
async function markSeen(req, res, next) {
  try {
    const conversationId = req.params.id;
    await convService.assertParticipant(conversationId, req.user.id);

    const { messageIds = null } = req.body || {};

    const { rows, byConversation } = await messagesService.advanceStatus({
      userId: req.user.id,
      status: 'seen',
      conversationId,
      messageIds: Array.isArray(messageIds) && messageIds.length > 0 ? messageIds : null,
    });

    if (rows.length > 0) {
      await messagesService.updateLastRead(conversationId, req.user.id);
    }

    await Promise.all(
      Object.entries(byConversation).map(([cid, updates]) => triggerStatuses(cid, updates))
    );

    res.json({ markedSeen: rows.map((r) => r.message_id) });
  } catch (err) {
    next(err);
  }
}

module.exports = { listMessages, sendMessage, markDelivered, markSeen };
