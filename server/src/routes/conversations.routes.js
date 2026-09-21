const express = require('express');
const { requireAuth } = require('../middleware/auth');
const conversations = require('../controllers/conversations.controller');
const messages = require('../controllers/messages.controller');

const router = express.Router();
router.use(requireAuth);

router.get('/', conversations.list);
router.post('/', conversations.createDirect);
router.post('/group', conversations.createGroup);

router.get('/:id/messages', messages.listMessages);
router.post('/:id/messages', messages.sendMessage);
router.post('/:id/messages/seen', messages.markSeen);

// Conversation-level read receipt: the same handler with no messageIds, which
// marks everything in the conversation seen.
router.post('/:id/read', messages.markSeen);

module.exports = router;
