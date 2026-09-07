const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { search } = require('../controllers/users.controller');

const router = express.Router();

router.get('/search', requireAuth, search);

module.exports = router;
