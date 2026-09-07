const { query } = require('../config/db');
const convService = require('../services/conversations.service');
const messagesService = require('../services/messages.service');

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

// POST /api/conversations/:id/messages/image  (multipart/form-data, field "image")
// REST fallback for image messages -- text messages normally go over the
// socket (see src/sockets/index.js) for lower latency, but a file upload
// needs a proper multipart request, which sockets don't handle well.
async function sendImageMessage(req, res, next) {
  try {
    const conversationId = req.params.id;
    await convService.assertParticipant(conversationId, req.user.id);

    if (!req.file) return res.status(400).json({ error: 'image file is required (field name "image")' });

    const imageUrl = `/uploads/${req.file.filename}`;
    const { message, recipientIds } = await messagesService.createMessage({
      conversationId,
      senderId: req.user.id,
      type: 'image',
      imageUrl,
      clientTempId: req.body.clientTempId || null,
    });

    // Broadcast to anyone currently connected, same as a text message would be.
    const io = req.app.get('io');
    if (io) {
      io.to(`conversation:${conversationId}`).emit('message:new', { ...message, statuses: [] });
    }

    res.status(201).json({ message, recipientIds });
  } catch (err) {
    next(err);
  }
}

module.exports = { listMessages, sendImageMessage };
