// Shared conversation logic used by both the REST controllers and (later)
// the socket layer, so there's one place that defines what a "conversation"
// is and who's allowed to see it.
const { query, pool } = require('../config/db');

// Finds the existing 1:1 conversation between two users, or creates one.
// Prevents duplicate DM threads from piling up every time you message the
// same person.
async function getOrCreateDirectConversation(userAId, userBId) {
  if (userAId === userBId) {
    const err = new Error('Cannot start a conversation with yourself');
    err.status = 400;
    throw err;
  }

  const existing = await query(
    `SELECT c.id FROM conversations c
     JOIN conversation_participants p1 ON p1.conversation_id = c.id AND p1.user_id = $1
     JOIN conversation_participants p2 ON p2.conversation_id = c.id AND p2.user_id = $2
     WHERE c.is_group = false
     LIMIT 1`,
    [userAId, userBId]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO conversations (is_group, created_by) VALUES (false, $1) RETURNING id`,
      [userAId]
    );
    const conversationId = rows[0].id;
    await client.query(
      `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
      [conversationId, userAId, userBId]
    );
    await client.query('COMMIT');
    return conversationId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function createGroupConversation(creatorId, name, participantIds) {
  const allIds = Array.from(new Set([creatorId, ...participantIds]));
  if (allIds.length < 3) {
    const err = new Error('A group needs at least 3 participants (including you)');
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO conversations (is_group, name, created_by) VALUES (true, $1, $2) RETURNING id`,
      [name, creatorId]
    );
    const conversationId = rows[0].id;
    const values = allIds.map((_, i) => `($1, $${i + 2})`).join(', ');
    await client.query(
      `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ${values}`,
      [conversationId, ...allIds]
    );
    await client.query('COMMIT');
    return conversationId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// All conversations a user is in, with a preview of the last message and how
// many unread messages are waiting -- exactly what a conversation list UI needs.
async function listConversationsForUser(userId) {
  const { rows } = await query(
    `SELECT
       c.id,
       c.is_group,
       c.name,
       last_msg.body        AS last_message_body,
       last_msg.type        AS last_message_type,
       last_msg.created_at  AS last_message_at,
       last_msg.sender_id   AS last_message_sender_id,
       COALESCE(unread.count, 0) AS unread_count,
       participants.others  AS other_participants
     FROM conversations c
     JOIN conversation_participants me ON me.conversation_id = c.id AND me.user_id = $1
     LEFT JOIN LATERAL (
       SELECT body, type, created_at, sender_id FROM messages
       WHERE conversation_id = c.id
       ORDER BY created_at DESC LIMIT 1
     ) last_msg ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS count FROM message_status ms
       WHERE ms.user_id = $1 AND ms.status != 'seen'
         AND ms.message_id IN (SELECT id FROM messages WHERE conversation_id = c.id)
     ) unread ON true
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'avatar_url', u.avatar_url)) AS others
       FROM conversation_participants cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.conversation_id = c.id AND cp.user_id != $1
     ) participants ON true
     ORDER BY COALESCE(last_msg.created_at, c.created_at) DESC`,
    [userId]
  );
  return rows;
}

async function assertParticipant(conversationId, userId) {
  const { rows } = await query(
    `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
    [conversationId, userId]
  );
  if (!rows[0]) {
    const err = new Error('Not a participant of this conversation');
    err.status = 403;
    throw err;
  }
}

async function getParticipantIds(conversationId) {
  const { rows } = await query(
    `SELECT user_id FROM conversation_participants WHERE conversation_id = $1`,
    [conversationId]
  );
  return rows.map((r) => r.user_id);
}

module.exports = {
  getOrCreateDirectConversation,
  createGroupConversation,
  listConversationsForUser,
  assertParticipant,
  getParticipantIds,
};
