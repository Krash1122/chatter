// Local development entry point ONLY. On Vercel nothing runs this file --
// api/index.js takes the same Express app and lets the platform handle the
// listening. There is no Socket.IO server to attach any more, so this is just
// app.listen().
require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Chatter API listening on http://localhost:${PORT}`);
});
