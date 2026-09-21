// Vercel serverless entry point for the whole API.
//
// The filename is a catch-all route, so Vercel's own filesystem routing sends
// /api/auth/login, /api/conversations/:id/messages and everything else here
// directly. That's deliberate: it doesn't depend on a rewrite rule firing, and
// filesystem routing is resolved BEFORE rewrites, so the SPA catch-all in
// vercel.json can never swallow an API request (including a legitimate 404).
//
// An Express app IS a (req, res) function, which is exactly what Vercel's Node
// runtime wants a handler to be, so there's no adapter in between. Keeping it
// to one function rather than one file per route means the app's own router
// stays the single source of truth for what the API exposes, and there's one
// cold start to pay for instead of one per endpoint.
const app = require('../server/src/app');

module.exports = (req, res) => {
  // The app mounts everything under /api. What exactly lands in req.url
  // depends on how the request was routed, so normalize it here rather than
  // relying on that -- a mismatch would 404 every single endpoint.
  if (!req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : `/${req.url}`);
  }
  return app(req, res);
};
