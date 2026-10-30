const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

/**
 * Validates whether a string is a 24-character hexadecimal ObjectId representation.
 * @param {string} id
 * @returns {boolean}
 */
function isValidObjectIdString(id) {
  return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id) && ObjectId.isValid(id);
}

/**
 * Validates whether a value is a positive integer (e.g. 1, 2, 3...).
 * @param {string|number} version
 * @returns {boolean}
 */
function isValidVersion(version) {
  const str = String(version).trim();
  return /^[1-9]\d*$/.test(str);
}

/**
 * GET /api/cases/:caseId/reports
 * Lists all generated report versions for the case, ordered by version descending (newest first).
 */
async function getReportsByCase(req, res) {
  try {
    const { caseId } = req.params;

    // 1. Validate caseId format
    if (!isValidObjectIdString(caseId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID_FORMAT',
          message: 'Invalid case ID format. Must be a 24-character hexadecimal string.',
          details: { caseId },
        },
      });
    }

    const objectId = new ObjectId(caseId);
    const db = getDB();

    // 2. Verify case exists
    const caseDoc = await db.collection('cases').findOne({ _id: objectId });
    if (!caseDoc) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CASE_NOT_FOUND',
          message: `Case not found with ID ${caseId}.`,
          details: { caseId },
        },
      });
    }

    // 3. Query reports strictly scoped to caseId, ordered newest first (version descending)
    const reports = await db
      .collection('reports')
      .find({ caseId: objectId })
      .sort({ version: -1 })
      .project({
        _id: 1,
        version: 1,
        summary: 1,
        triggerEvidenceCode: 1,
        createdAt: 1,
      })
      .toArray();

    // 4. Serialize response matching the API contract
    const data = reports.map((r) => {
      const item = {
        _id: r._id.toString(),
        version: r.version,
        summary: r.summary,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : new Date(r.createdAt).toISOString(),
      };

      if (r.triggerEvidenceCode) {
        item.triggerEvidenceCode = r.triggerEvidenceCode;
      }

      return item;
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[ReportController] Error fetching reports:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve reports.',
      },
    });
  }
}

/**
 * GET /api/cases/:caseId/reports/:version
 * Retrieves the complete, immutable report payload for a specific version number.
 */
async function getReportByVersion(req, res) {
  try {
    const { caseId, version } = req.params;

    // 1. Validate caseId format
    if (!isValidObjectIdString(caseId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ID_FORMAT',
          message: 'Invalid case ID format. Must be a 24-character hexadecimal string.',
          details: { caseId },
        },
      });
    }

    // 2. Validate version as a positive integer
    if (!isValidVersion(version)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_VERSION_FORMAT',
          message: 'Version must be a positive integer (e.g. 1, 2, 3).',
          details: { version },
        },
      });
    }

    const versionNum = parseInt(version, 10);
    const objectId = new ObjectId(caseId);
    const db = getDB();

    // 3. Verify case exists
    const caseDoc = await db.collection('cases').findOne({ _id: objectId });
    if (!caseDoc) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CASE_NOT_FOUND',
          message: `Case not found with ID ${caseId}.`,
          details: { caseId },
        },
      });
    }

    // 4. Retrieve specific report version scoped to caseId
    const reportDoc = await db.collection('reports').findOne({
      caseId: objectId,
      version: versionNum,
    });

    if (!reportDoc) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'REPORT_NOT_FOUND',
          message: `Report version ${versionNum} not found for case ${caseId}.`,
          details: { caseId, version: versionNum },
        },
      });
    }

    // 5. Serialize full report payload matching the contract
    const data = {
      _id: reportDoc._id.toString(),
      caseId: reportDoc.caseId.toString(),
      version: reportDoc.version,
      summary: reportDoc.summary,
      knownFacts: Array.isArray(reportDoc.knownFacts) ? reportDoc.knownFacts : [],
      unverifiedClaims: Array.isArray(reportDoc.unverifiedClaims) ? reportDoc.unverifiedClaims : [],
      evidenceConnections: Array.isArray(reportDoc.evidenceConnections) ? reportDoc.evidenceConnections : [],
      contradictions: Array.isArray(reportDoc.contradictions) ? reportDoc.contradictions : [],
      possibleHypotheses: Array.isArray(reportDoc.possibleHypotheses) ? reportDoc.possibleHypotheses : [],
      openQuestions: Array.isArray(reportDoc.openQuestions) ? reportDoc.openQuestions : [],
      suggestedNextChecks: Array.isArray(reportDoc.suggestedNextChecks) ? reportDoc.suggestedNextChecks : [],
      memoryDelta: reportDoc.memoryDelta || {
        added: [],
        updated: [],
        explanation: '',
      },
      createdAt: reportDoc.createdAt instanceof Date ? reportDoc.createdAt.toISOString() : new Date(reportDoc.createdAt).toISOString(),
    };

    if (reportDoc.triggerEvidenceCode) {
      data.triggerEvidenceCode = reportDoc.triggerEvidenceCode;
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[ReportController] Error fetching report by version:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve report version.',
      },
    });
  }
}

module.exports = {
  getReportsByCase,
  getReportByVersion,
};
