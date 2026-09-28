// Vercel serverless entry point for the whole API.

const app = require('../server/src/app');

module.exports = (req, res) => {
  // A rewrite keeps the original request path in req.url, so this is normally
  // a no-op. It's here so a routing change can't silently 404 every endpoint:
  // the app mounts everything under /api.
  if (!req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : `/${req.url}`);
  }
  return app(req, res);
};
