const express = require('express');
const {
  createCase,
  getCases,
  getCaseById,
} = require('../controllers/caseController');
const evidenceRoutes = require('./evidenceRoutes');

const router = express.Router();

// Mount Evidence sub-routes: /api/cases/:caseId/evidence
router.use('/:caseId/evidence', evidenceRoutes);

router.post('/', createCase);
router.get('/', getCases);
router.get('/:caseId', getCaseById);

module.exports = router;
