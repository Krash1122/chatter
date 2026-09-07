// Express app configuration: middleware + route mounting.
// Kept separate from index.js so the app object can be imported in tests
// without also starting an HTTP server.
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const conversationsRoutes = require('./routes/conversations.routes');

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json());
app.use(morgan('dev'));

// Uploaded images are served straight off disk, e.g. GET /uploads/<filename>.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/conversations', conversationsRoutes);

// 404 handler for anything that fell through.
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler -- any route that calls next(err) lands here.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
