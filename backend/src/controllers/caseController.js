const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

const COLLECTION_NAME = 'cases';

/**
 * Validates whether a string is a 24-character hexadecimal ObjectId representation.
 * @param {string} id
 * @returns {boolean}
 */
function isValidObjectIdString(id) {
  return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id) && ObjectId.isValid(id);
}

/**
 * POST /api/cases
 * Creates a new fictional investigation case.
 */
async function createCase(req, res) {
  try {
    const { title, description } = req.body || {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Title is required and must be a non-empty string.',
          details: { field: 'title' },
        },
      });
    }

    if (description !== undefined && typeof description !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Description must be a string if provided.',
          details: { field: 'description' },
        },
      });
    }

    const now = new Date();
    const newCase = {
      title: title.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };

    const db = getDB();
    const result = await db.collection(COLLECTION_NAME).insertOne(newCase);

    return res.status(201).json({
      success: true,
      data: {
        _id: result.insertedId.toString(),
        title: newCase.title,
        description: newCase.description,
        status: newCase.status,
        createdAt: newCase.createdAt.toISOString(),
        updatedAt: newCase.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error('[CaseController] Error creating case:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create case due to an unexpected error.',
      },
    });
  }
}

/**
 * GET /api/cases
 * Lists all cases ordered by newest first.
 */
async function getCases(req, res) {
  try {
    const db = getDB();
    const cases = await db
      .collection(COLLECTION_NAME)
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const data = cases.map((c) => ({
      _id: c._id.toString(),
      title: c.title,
      status: c.status,
      createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : new Date(c.createdAt).toISOString(),
    }));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[CaseController] Error fetching cases:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve cases.',
      },
    });
  }
}

/**
 * GET /api/cases/:caseId
 * Retrieves a single case by ID with counts of associated evidence, active memories, and latest report version.
 */
async function getCaseById(req, res) {
  try {
    const { caseId } = req.params;

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

    const caseDoc = await db.collection(COLLECTION_NAME).findOne({ _id: objectId });

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

    // Retrieve stats across associated case-scoped collections
    const [evidenceCount, activeMemoriesCount, latestReport] = await Promise.all([
      db.collection('evidence').countDocuments({ caseId: objectId }),
      db.collection('memories').countDocuments({ caseId: objectId, status: 'active' }),
      db.collection('reports').findOne(
        { caseId: objectId },
        { sort: { version: -1 }, projection: { version: 1 } }
      ),
    ]);

    const latestReportVersion = latestReport && typeof latestReport.version === 'number' ? latestReport.version : 0;

    return res.status(200).json({
      success: true,
      data: {
        _id: caseDoc._id.toString(),
        title: caseDoc.title,
        description: caseDoc.description || '',
        status: caseDoc.status,
        stats: {
          evidenceCount,
          activeMemoriesCount,
          latestReportVersion,
        },
        createdAt: caseDoc.createdAt instanceof Date ? caseDoc.createdAt.toISOString() : new Date(caseDoc.createdAt).toISOString(),
        updatedAt: caseDoc.updatedAt instanceof Date ? caseDoc.updatedAt.toISOString() : new Date(caseDoc.updatedAt).toISOString(),
      },
    });
  } catch (error) {
    console.error('[CaseController] Error fetching case by ID:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve case details.',
      },
    });
  }
}

module.exports = {
  createCase,
  getCases,
  getCaseById,
};
