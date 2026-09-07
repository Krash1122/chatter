const express = require('express');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const conversations = require('../controllers/conversations.controller');
const messages = require('../controllers/messages.controller');

const router = express.Router();
router.use(requireAuth);

router.get('/', conversations.list);
router.post('/', conversations.createDirect);
router.post('/group', conversations.createGroup);
router.post('/:id/read', conversations.markRead);

router.get('/:id/messages', messages.listMessages);
router.post('/:id/messages/image', upload.single('image'), messages.sendImageMessage);

module.exports = router;
