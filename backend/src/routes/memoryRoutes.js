const express = require('express');
const { getMemoriesByCase } = require('../controllers/memoryController');

// mergeParams: true allows accessing :caseId from parent route
const router = express.Router({ mergeParams: true });

router.get('/', getMemoriesByCase);

module.exports = router;
