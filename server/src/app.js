// Express app configuration: middleware + route mounting.
//
// This module deliberately does NOT create a server or listen on a port. Two
// things consume it: server/src/index.js (local development, wraps it in a
// real listening server) and api/index.js (Vercel, hands it straight to the
// serverless runtime as the request handler). Keeping the two entry points
// this thin is what guarantees the deployed API and the local one are the
// same API.
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const conversationsRoutes = require('./routes/conversations.routes');
const messagesRoutes = require('./routes/messages.routes');
const pusherRoutes = require('./routes/pusher.routes');
const uploadsRoutes = require('./routes/uploads.routes');

const app = express();

// On Vercel the client is served from the same origin as the API, so CORS is
// a no-op there. It still matters locally, where Vite runs on :5173 and this
// runs on :4000.
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());
// pusher-js posts its channel authorization request as form data, not JSON.
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/pusher', pusherRoutes);
app.use('/api/uploads', uploadsRoutes);

// 404 handler for anything that fell through.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler -- any route that calls next(err) lands here.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
