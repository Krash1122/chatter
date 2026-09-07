const { query } = require('../config/db');
const convService = require('../services/conversations.service');

// POST /api/conversations  { participantId }
async function createDirect(req, res, next) {
  try {
    const { participantId } = req.body;
    if (!participantId) return res.status(400).json({ error: 'participantId is required' });

    const conversationId = await convService.getOrCreateDirectConversation(req.user.id, participantId);
    res.status(201).json({ conversationId });
  } catch (err) {
    next(err);
  }
}

// POST /api/conversations/group  { name, participantIds: [...] }
async function createGroup(req, res, next) {
  try {
    const { name, participantIds } = req.body;
    if (!name || !Array.isArray(participantIds)) {
      return res.status(400).json({ error: 'name and participantIds[] are required' });
    }
    const conversationId = await convService.createGroupConversation(req.user.id, name, participantIds);
    res.status(201).json({ conversationId });
  } catch (err) {
    next(err);
  }
}

// GET /api/conversations
async function list(req, res, next) {
  try {
    const conversations = await convService.listConversationsForUser(req.user.id);
    res.json({ conversations });
  } catch (err) {
    next(err);
  }
}

// POST /api/conversations/:id/read  -- mark everything up to "now" as seen
async function markRead(req, res, next) {
  try {
    const conversationId = req.params.id;
    await convService.assertParticipant(conversationId, req.user.id);

    const { rows } = await query(
      `UPDATE message_status ms
       SET status = 'seen', updated_at = now()
       FROM messages m
       WHERE ms.message_id = m.id
         AND m.conversation_id = $1
         AND ms.user_id = $2
         AND ms.status != 'seen'
       RETURNING ms.message_id`,
      [conversationId, req.user.id]
    );

    if (rows[0]) {
      await query(
        `UPDATE conversation_participants SET last_read_message_id = $1
         WHERE conversation_id = $2 AND user_id = $3`,
        [rows[rows.length - 1].message_id, conversationId, req.user.id]
      );
    }

    res.json({ markedSeen: rows.map((r) => r.message_id) });
  } catch (err) {
    next(err);
  }
}

module.exports = { createDirect, createGroup, list, markRead };
