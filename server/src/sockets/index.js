// Real-time layer. This is where "sending -> sent -> delivered -> seen"
// actually happens:
//   sending  -- client-only, optimistic, never touches this file
//   sent     -- the DB row + message_status rows exist (see messages.service)
//   delivered-- the recipient's socket was online, so we push it to them now
//   seen     -- the recipient's client told us they viewed the message
//
// Everyone connected to a conversation joins a room named
// `conversation:<id>`, so broadcasting a status change to that room is all
// that's needed to update every open chat window at once. Each user also
// joins a personal room `user:<id>`, used to check "is this person online
// right now" and for notifications outside any specific conversation.
const { Server } = require('socket.io');
const { verifyToken } = require('../utils/jwt');
const { query } = require('../config/db');
const convService = require('../services/conversations.service');
const messagesService = require('../services/messages.service');

function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_ORIGIN || '*' },
  });

  // Auth handshake: the client connects with `io(url, { auth: { token } })`.
  // Runs once per connection, before 'connection' fires.
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) throw new Error('No token provided');
      const payload = verifyToken(token);
      socket.user = { id: payload.sub, username: payload.username };
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  function isOnline(userId) {
    const room = io.sockets.adapter.rooms.get(`user:${userId}`);
    return !!room && room.size > 0;
  }

  io.on('connection', async (socket) => {
    const { id: userId } = socket.user;
    socket.join(`user:${userId}`);

    // Join every conversation this user is already part of, so messages
    // sent while they're connected reach them without extra round trips.
    const { rows } = await query(
      'SELECT conversation_id FROM conversation_participants WHERE user_id = $1',
      [userId]
    );
    rows.forEach((r) => socket.join(`conversation:${r.conversation_id}`));

    // Tell everyone sharing a conversation with this user that they're online.
    rows.forEach((r) => {
      socket.to(`conversation:${r.conversation_id}`).emit('presence', { userId, online: true });
    });

    // Any pending ('sent') messages addressed to this user become 'delivered'
    // now that they're online -- covers messages sent while they were offline.
    const { rows: nowDelivered } = await query(
      `UPDATE message_status SET status = 'delivered', updated_at = now()
       WHERE user_id = $1 AND status = 'sent'
       RETURNING message_id, (SELECT conversation_id FROM messages WHERE id = message_id) AS conversation_id`,
      [userId]
    );
    nowDelivered.forEach((row) => {
      io.to(`conversation:${row.conversation_id}`).emit('message:status', {
        messageId: row.message_id,
        userId,
        status: 'delivered',
      });
    });

    // --- Join a newly created conversation without needing to reconnect ---
    // (call this right after POST /api/conversations succeeds)
    socket.on('conversation:join', async ({ conversationId }) => {
      try {
        await convService.assertParticipant(conversationId, userId);
        socket.join(`conversation:${conversationId}`);
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // --- Sending a text message ---
    socket.on('message:send', async ({ conversationId, body, clientTempId }, ack) => {
      try {
        if (!body || !body.trim()) throw Object.assign(new Error('body is required'), { status: 400 });
        await convService.assertParticipant(conversationId, userId);

        const { message, recipientIds } = await messagesService.createMessage({
          conversationId,
          senderId: userId,
          type: 'text',
          body,
          clientTempId,
        });

        // Recipients who are online right now get 'delivered' immediately
        // instead of sitting at 'sent'.
        const onlineRecipients = recipientIds.filter(isOnline);
        let statuses = [];
        if (onlineRecipients.length > 0) {
          const { rows: updated } = await query(
            `UPDATE message_status SET status = 'delivered', updated_at = now()
             WHERE message_id = $1 AND user_id = ANY($2::uuid[])
             RETURNING user_id, status`,
            [message.id, onlineRecipients]
          );
          statuses = updated.map((u) => ({ userId: u.user_id, status: u.status }));
        }

        // Broadcast the new message to everyone in the room, sender included --
        // this is what lets the sender swap their optimistic bubble for the
        // real one (matched via clientTempId).
        io.to(`conversation:${conversationId}`).emit('message:new', { ...message, statuses });

        // Acknowledge back to the sender specifically (this is the
        // "sending -> sent" transition on their screen).
        if (typeof ack === 'function') ack({ ok: true, message });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    // --- Marking messages as seen (call when the user has the conversation open) ---
    socket.on('message:seen', async ({ conversationId, messageIds }) => {
      try {
        await convService.assertParticipant(conversationId, userId);
        if (!Array.isArray(messageIds) || messageIds.length === 0) return;

        const { rows: updated } = await query(
          `UPDATE message_status SET status = 'seen', updated_at = now()
           WHERE user_id = $1 AND message_id = ANY($2::uuid[]) AND status != 'seen'
           RETURNING message_id`,
          [userId, messageIds]
        );

        if (updated.length > 0) {
          await query(
            `UPDATE conversation_participants SET last_read_message_id = $1
             WHERE conversation_id = $2 AND user_id = $3`,
            [updated[updated.length - 1].message_id, conversationId, userId]
          );
          updated.forEach((row) => {
            io.to(`conversation:${conversationId}`).emit('message:status', {
              messageId: row.message_id,
              userId,
              status: 'seen',
            });
          });
        }
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // --- Typing indicator ---
    socket.on('typing:start', ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit('typing', { conversationId, userId, isTyping: true });
    });
    socket.on('typing:stop', ({ conversationId }) => {
      socket.to(`conversation:${conversationId}`).emit('typing', { conversationId, userId, isTyping: false });
    });

    socket.on('disconnect', () => {
      // Only announce "offline" once ALL of this user's tabs/devices have
      // disconnected, not on the first one.
      if (!isOnline(userId)) {
        rows.forEach((r) => {
          io.to(`conversation:${r.conversation_id}`).emit('presence', { userId, online: false });
        });
      }
    });
  });

  return io;
}

module.exports = initSockets;
