// bcryptjs rather than bcrypt: the latter is a native addon that has to be
// compiled or fetched as a prebuilt binary for the exact platform, which is a
// standing risk on a build image you don't control and bloats the function
// bundle. bcryptjs is pure JavaScript with the same API and the same hash
// format, so existing password hashes keep verifying.
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { signToken } = require('../utils/jwt');

const SALT_ROUNDS = 10;

async function register(req, res) {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows } = await query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username, email, passwordHash]
    );
    const user = rows[0];
    const token = signToken(user);
    res.status(201).json({ user, token });
  } catch (err) {
    // Postgres unique_violation
    if (err.code === '23505') {
      return res.status(409).json({ error: 'username or email already taken' });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to register' });
  }
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];

    // Compare against a real (but unmatchable) hash even when no user is
    // found, so the response time doesn't leak whether the email exists.
    // It has to be a well-formed bcrypt hash or the compare returns
    // immediately and the timing tell comes back.
    const passwordHash = user
      ? user.password_hash
      : '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
    const valid = await bcrypt.compare(password, passwordHash);

    if (!user || !valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    res.json({
      user: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url },
      token,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to log in' });
  }
}

async function me(req, res) {
  const { rows } = await query(
    'SELECT id, username, email, avatar_url, created_at FROM users WHERE id = $1',
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found' });
  res.json({ user: rows[0] });
}

module.exports = { register, login, me };
