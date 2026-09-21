// Shared message logic. Both the text and image paths of POST
// /api/conversations/:id/messages call createMessage, so a message is created
// and fanned out to recipients exactly the same way regardless of its type.
const { pool, query } = require('../config/db');

// IMPORTANT: once a transaction is holding the pool's connection, every query
// inside it must go through that same client. The pool is capped at one
// connection per instance (see config/db.js), so a helper that reaches for
// pool.query() mid-transaction waits for a connection that only the
// transaction can release -- a self-deadlock that ends in a connection
// timeout. That's why the participant lookup below is inlined here instead of
// calling conversations.service.getParticipantIds().
async function createMessage({ conversationId, senderId, type, body = null, imageUrl = null, clientTempId = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO messages (conversation_id, sender_id, type, body, image_url, client_temp_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [conversationId, senderId, type, body, imageUrl, clientTempId]
    );
    const message = rows[0];

    // Every OTHER participant starts out with status 'sent' for this message.
    // (The sender doesn't get a status row -- you don't track "seen" against
    // yourself.)
    const { rows: participantRows } = await client.query(
      `SELECT user_id FROM conversation_participants
        WHERE conversation_id = $1 AND user_id <> $2`,
      [conversationId, senderId]
    );
    const participantIds = participantRows.map((r) => r.user_id);

    if (participantIds.length > 0) {
      const values = participantIds.map((_, i) => `($1, $${i + 2}, 'sent')`).join(', ');
      await client.query(
        `INSERT INTO message_status (message_id, user_id, status) VALUES ${values}`,
        [message.id, ...participantIds]
      );
    }

    await client.query('COMMIT');
    return { message, recipientIds: participantIds };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Advances one user's status on a set of messages and reports back which rows
// actually moved, grouped by conversation so the caller knows which channels
// to broadcast on.
//
// `only` guards against going backwards: 'delivered' may only be applied to a
// message still sitting at 'sent', so a delayed delivery acknowledgement can't
// un-see a message the user has already read. Without it, the catch-up call on
// page load would race the "mark seen" call from an open conversation.
//
// Scope the update with `messageIds`, `conversationId`, or neither (meaning
// every message addressed to this user anywhere -- the offline catch-up).
async function advanceStatus({ userId, status, messageIds = null, conversationId = null, only = null }) {
  const conditions = ['ms.user_id = $1', 'ms.status <> $2'];
  const params = [userId, status];

  if (only) {
    params.push(only);
    conditions.push(`ms.status = $${params.length}`);
  }
  if (messageIds && messageIds.length > 0) {
    params.push(messageIds);
    conditions.push(`ms.message_id = ANY($${params.length}::uuid[])`);
  }
  if (conversationId) {
    params.push(conversationId);
    conditions.push(`m.conversation_id = $${params.length}`);
  }

  const { rows } = await query(
    `UPDATE message_status ms
        SET status = $2, updated_at = now()
       FROM messages m
      WHERE ms.message_id = m.id
        AND ${conditions.join('\n        AND ')}
     RETURNING ms.message_id, m.conversation_id`,
    params
  );

  // { conversationId: [{ messageId, userId, status }] }
  const byConversation = rows.reduce((acc, row) => {
    (acc[row.conversation_id] = acc[row.conversation_id] || []).push({
      messageId: row.message_id,
      userId,
      status,
    });
    return acc;
  }, {});

  return { rows, byConversation };
}

// Keeps the denormalized read pointer on conversation_participants in step
// with the statuses we just moved to 'seen'.
//
// The pointer is recomputed from the table rather than taken from the rows the
// UPDATE just returned: RETURNING gives no ordering guarantee, so picking its
// last row could park the pointer on an older message than one already read
// and make unread counts drift.
async function updateLastRead(conversationId, userId) {
  await query(
    `UPDATE conversation_participants cp
        SET last_read_message_id = (
              SELECT m.id
                FROM messages m
                JOIN message_status ms
                  ON ms.message_id = m.id AND ms.user_id = $2
               WHERE m.conversation_id = $1 AND ms.status = 'seen'
               ORDER BY m.created_at DESC
               LIMIT 1
            )
      WHERE cp.conversation_id = $1 AND cp.user_id = $2`,
    [conversationId, userId]
  );
}

module.exports = { createMessage, advanceStatus, updateLastRead };
