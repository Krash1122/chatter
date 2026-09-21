// Message actions that aren't scoped to a single conversation. Delivery
// acknowledgement is the only one: a client coming back online needs to
// acknowledge everything waiting for it across every conversation at once,
// which doesn't belong under /conversations/:id.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const messages = require('../controllers/messages.controller');

const router = express.Router();

router.post('/delivered', requireAuth, messages.markDelivered);

module.exports = router;
