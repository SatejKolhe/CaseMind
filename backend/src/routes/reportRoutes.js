const express = require('express');
const {
  getReportsByCase,
  getReportByVersion,
} = require('../controllers/reportController');

// mergeParams: true allows accessing :caseId from parent route
const router = express.Router({ mergeParams: true });

router.get('/', getReportsByCase);
router.get('/:version', getReportByVersion);

module.exports = router;
