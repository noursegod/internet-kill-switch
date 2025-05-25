const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

// GET /setup - Display the setup page
router.get('/', settingsController.getSetupPage);

// POST /setup - Handle submission of the setup form
router.post('/', settingsController.postSetupPage);

module.exports = router;
