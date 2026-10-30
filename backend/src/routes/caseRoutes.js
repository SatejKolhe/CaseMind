const express = require('express');
const {
  createCase,
  getCases,
  getCaseById,
} = require('../controllers/caseController');
const evidenceRoutes = require('./evidenceRoutes');
const memoryRoutes = require('./memoryRoutes');
const reportRoutes = require('./reportRoutes');

const router = express.Router();

// Mount Case-scoped sub-routes
router.use('/:caseId/evidence', evidenceRoutes);
router.use('/:caseId/memories', memoryRoutes);
router.use('/:caseId/reports', reportRoutes);

router.post('/', createCase);
router.get('/', getCases);
router.get('/:caseId', getCaseById);

module.exports = router;
