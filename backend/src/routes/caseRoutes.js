const express = require('express');
const {
  createCase,
  getCases,
  getCaseById,
} = require('../controllers/caseController');

const router = express.Router();

router.post('/', createCase);
router.get('/', getCases);
router.get('/:caseId', getCaseById);

module.exports = router;
