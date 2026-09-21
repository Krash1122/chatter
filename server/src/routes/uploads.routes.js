const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { signature } = require('../controllers/uploads.controller');

const router = express.Router();

router.get('/signature', requireAuth, signature);

module.exports = router;
