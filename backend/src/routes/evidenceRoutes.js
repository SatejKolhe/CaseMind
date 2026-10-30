const express = require('express');
const {
  createEvidence,
  getEvidenceByCase,
} = require('../controllers/evidenceController');

// mergeParams: true allows accessing :caseId from parent route
const router = express.Router({ mergeParams: true });

router.post('/', createEvidence);
router.get('/', getEvidenceByCase);

module.exports = router;
