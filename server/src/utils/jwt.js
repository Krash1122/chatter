// Small wrapper around jsonwebtoken so the rest of the app never touches the
// secret or the library directly.
const jwt = require('jsonwebtoken');

function signToken(user) {
  // Keep the payload small -- id is all we need to look the user up again.
  return jwt.sign({ sub: user.id, username: user.username }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET); // throws if invalid/expired
}

module.exports = { signToken, verifyToken };
