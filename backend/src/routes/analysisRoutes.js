const express = require('express');
const { analyzeCase } = require('../controllers/analysisController');

// mergeParams: true allows accessing :caseId from parent route
const router = express.Router({ mergeParams: true });

router.post('/', analyzeCase);

module.exports = router;
