const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

const ALLOWED_STATUSES = ['active', 'resolved', 'superseded', 'all'];

/**
 * Validates whether a string is a 24-character hexadecimal ObjectId representation.
 * @param {string} id
 * @returns {boolean}
 */
function isValidObjectIdString(id) {
  return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id) && ObjectId.isValid(id);
}

/**
 * GET /api/cases/:caseId/memories
 * Retrieves working memory items scoped to the requested case.
 * Query parameters:
 *  - status: 'active' | 'resolved' | 'superseded' | 'all' (default: 'active')
 */
async function getMemoriesByCase(req, res) {
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

    // 3. Validate status query parameter (defaulting to 'active')
    const rawStatus = req.query.status;
    let targetStatus = 'active';

    if (rawStatus !== undefined && rawStatus !== '') {
      const normalizedStatus = String(rawStatus).toLowerCase().trim();
      if (!ALLOWED_STATUSES.includes(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid status filter. Allowed values: ${ALLOWED_STATUSES.join(', ')}.`,
            details: { field: 'status', allowedValues: ALLOWED_STATUSES },
          },
        });
      }
      targetStatus = normalizedStatus;
    }

    // 4. Construct query strictly scoped to caseId
    const query = { caseId: objectId };
    if (targetStatus !== 'all') {
      query.status = targetStatus;
    }

    // 5. Retrieve memories from MongoDB
    const memoryDocs = await db
      .collection('memories')
      .find(query)
      .sort({ createdAt: 1 })
      .toArray();

    // 6. Serialize document shapes to contract format
    const data = memoryDocs.map((doc) => {
      const item = {
        _id: doc._id.toString(),
        caseId: doc.caseId.toString(),
        category: doc.category,
        statement: doc.statement,
        supportingEvidenceCodes: Array.isArray(doc.supportingEvidenceCodes) ? doc.supportingEvidenceCodes : [],
        status: doc.status,
        lastUpdatedInVersion: typeof doc.lastUpdatedInVersion === 'number' ? doc.lastUpdatedInVersion : 1,
        changeReason: doc.changeReason || '',
        updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : new Date(doc.updatedAt).toISOString(),
      };

      if (Array.isArray(doc.conflictingEvidenceCodes)) {
        item.conflictingEvidenceCodes = doc.conflictingEvidenceCodes;
      }
      if (doc.hypothesisDetails && typeof doc.hypothesisDetails === 'object') {
        item.hypothesisDetails = doc.hypothesisDetails;
      }
      if (typeof doc.source === 'string') {
        item.source = doc.source;
      }
      if (doc.createdAt) {
        item.createdAt = doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date(doc.createdAt).toISOString();
      }

      return item;
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[MemoryController] Error fetching memories:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve memories.',
      },
    });
  }
}

module.exports = {
  getMemoriesByCase,
};
