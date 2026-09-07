// Shared message-creation logic. Both the Socket.IO handler (real-time text
// messages) and the REST image-upload endpoint call this, so a message is
// created and fanned out to recipients exactly the same way regardless of
// which door it came in through.
const { pool } = require('../config/db');
const { getParticipantIds } = require('./conversations.service');

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
    const participantIds = (await getParticipantIds(conversationId)).filter((id) => id !== senderId);
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

module.exports = { createMessage };
