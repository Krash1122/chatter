const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { authorize } = require('../controllers/pusher.controller');

const router = express.Router();

router.post('/auth', requireAuth, authorize);

module.exports = router;
