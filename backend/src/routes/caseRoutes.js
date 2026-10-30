const express = require('express');
const {
  createCase,
  getCases,
  getCaseById,
} = require('../controllers/caseController');
const evidenceRoutes = require('./evidenceRoutes');
const memoryRoutes = require('./memoryRoutes');

const router = express.Router();

// Mount Case-scoped sub-routes
router.use('/:caseId/evidence', evidenceRoutes);
router.use('/:caseId/memories', memoryRoutes);

router.post('/', createCase);
router.get('/', getCases);
router.get('/:caseId', getCaseById);

module.exports = router;
