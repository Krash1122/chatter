// Vercel serverless entry point for the whole API.
//
// Every /api/* request is sent here by the first rewrite in vercel.json. It
// used to be a catch-all file (api/[...path].js) relying on Vercel's
// filesystem routing instead, but outside Next.js Vercel only generates a
// SINGLE-segment route for that filename: /api/health and /api/conversations
// reached the function, while /api/auth/login, /api/auth/me and every other
// nested path got the platform's plain-text 404 -- which is why logging in
// and loading anything after it broke in production but never locally.
//
// An Express app IS a (req, res) function, which is exactly what Vercel's Node
// runtime wants a handler to be, so there's no adapter in between. Keeping it
// to one function rather than one file per route means the app's own router
// stays the single source of truth for what the API exposes, and there's one
// cold start to pay for instead of one per endpoint.
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
