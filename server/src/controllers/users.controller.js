const { query } = require('../config/db');

// Lets the logged-in user search for someone to start a conversation with.
// GET /api/users/search?q=kar
async function search(req, res) {
  const q = (req.query.q || '').trim();
  if (q.length < 1) return res.json({ users: [] });

  const { rows } = await query(
    `SELECT id, username, avatar_url FROM users
     WHERE username ILIKE $1 AND id != $2
     ORDER BY username
     LIMIT 20`,
    [`%${q}%`, req.user.id]
  );
  res.json({ users: rows });
}

module.exports = { search };
