// Process entry point: builds an HTTP server around the Express app, attaches
// Socket.IO to that SAME server (so REST and WebSocket traffic share one
// port), and starts listening.
require('dotenv').config();
const http = require('http');
const app = require('./app');
const initSockets = require('./sockets');

const PORT = process.env.PORT || 4000;

const server = http.createServer(app);
const io = initSockets(server);

// Lets REST controllers (e.g. the image-upload endpoint) broadcast over the
// same Socket.IO instance without importing sockets/index.js directly.
app.set('io', io);

server.listen(PORT, () => {
  console.log(`Chatter server listening on http://localhost:${PORT}`);
});
