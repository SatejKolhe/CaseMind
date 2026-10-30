const { ObjectId } = require('mongodb');
const { getDB } = require('../config/db');

const ALLOWED_SOURCE_TYPES = ['witness', 'physical', 'digital', 'document', 'cctv'];
const ALLOWED_VERIFICATION_STATUSES = ['verified', 'unverified', 'disputed'];

/**
 * Validates whether a string is a 24-character hexadecimal ObjectId representation.
 * @param {string} id
 * @returns {boolean}
 */
function isValidObjectIdString(id) {
  return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id) && ObjectId.isValid(id);
}

/**
 * POST /api/cases/:caseId/evidence
 * Submits and persists a new piece of evidence scoped to the specified case.
 */
async function createEvidence(req, res) {
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

    // 3. Validate request payload
    const {
      title,
      content,
      source,
      sourceType,
      verificationStatus,
      occurredAt,
    } = req.body || {};

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

    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Content is required and must be a non-empty string.',
          details: { field: 'content' },
        },
      });
    }

    if (!source || typeof source !== 'string' || !source.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Source is required and must be a non-empty string.',
          details: { field: 'source' },
        },
      });
    }

    if (!sourceType || typeof sourceType !== 'string' || !ALLOWED_SOURCE_TYPES.includes(sourceType)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `sourceType must be one of: ${ALLOWED_SOURCE_TYPES.join(', ')}.`,
          details: { field: 'sourceType', allowedValues: ALLOWED_SOURCE_TYPES },
        },
      });
    }

    if (
      !verificationStatus ||
      typeof verificationStatus !== 'string' ||
      !ALLOWED_VERIFICATION_STATUSES.includes(verificationStatus)
    ) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `verificationStatus must be one of: ${ALLOWED_VERIFICATION_STATUSES.join(', ')}.`,
          details: { field: 'verificationStatus', allowedValues: ALLOWED_VERIFICATION_STATUSES },
        },
      });
    }

    if (!occurredAt || isNaN(Date.parse(occurredAt))) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'occurredAt is required and must be a valid ISO-8601 date string.',
          details: { field: 'occurredAt' },
        },
      });
    }

    const parsedOccurredAt = new Date(occurredAt);
    const now = new Date();

    // 4. Safe sequential evidence code generation with collision retry
    let attempts = 0;
    const maxAttempts = 5;
    let insertedResult = null;
    let generatedCode = '';

    while (attempts < maxAttempts) {
      attempts++;

      // Atomically increment the sequence counter on the case document
      const updatedCase = await db.collection('cases').findOneAndUpdate(
        { _id: objectId },
        { $inc: { lastEvidenceSeq: 1 } },
        { returnDocument: 'after' }
      );

      const seq = updatedCase.lastEvidenceSeq || 1;
      generatedCode = `EV-${String(seq).padStart(2, '0')}`;

      const evidenceDoc = {
        caseId: objectId,
        evidenceCode: generatedCode,
        title: title.trim(),
        content: content.trim(),
        source: source.trim(),
        sourceType,
        verificationStatus,
        occurredAt: parsedOccurredAt,
        createdAt: now,
      };

      try {
        insertedResult = await db.collection('evidence').insertOne(evidenceDoc);
        break; // Successfully inserted!
      } catch (insertErr) {
        // If duplicate key error on { caseId: 1, evidenceCode: 1 }, retry with next sequence number
        if (insertErr.code === 11000 && attempts < maxAttempts) {
          continue;
        }
        throw insertErr;
      }
    }

    if (!insertedResult) {
      throw new Error('Failed to allocate unique evidence code after maximum attempts.');
    }

    return res.status(201).json({
      success: true,
      data: {
        _id: insertedResult.insertedId.toString(),
        caseId: caseId,
        evidenceCode: generatedCode,
        title: title.trim(),
        content: content.trim(),
        source: source.trim(),
        sourceType,
        verificationStatus,
        occurredAt: parsedOccurredAt.toISOString(),
        createdAt: now.toISOString(),
      },
    });
  } catch (error) {
    console.error('[EvidenceController] Error creating evidence:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to record evidence due to an unexpected error.',
      },
    });
  }
}

/**
 * GET /api/cases/:caseId/evidence
 * Retrieves all evidence records scoped to the case, ordered by occurredAt ascending.
 */
async function getEvidenceByCase(req, res) {
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

    // 3. Retrieve evidence ordered chronologically by occurredAt ascending
    const evidenceList = await db
      .collection('evidence')
      .find({ caseId: objectId })
      .sort({ occurredAt: 1 })
      .toArray();

    const data = evidenceList.map((doc) => ({
      _id: doc._id.toString(),
      caseId: doc.caseId.toString(),
      evidenceCode: doc.evidenceCode,
      title: doc.title,
      content: doc.content,
      source: doc.source,
      sourceType: doc.sourceType,
      verificationStatus: doc.verificationStatus,
      occurredAt: doc.occurredAt instanceof Date ? doc.occurredAt.toISOString() : new Date(doc.occurredAt).toISOString(),
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date(doc.createdAt).toISOString(),
    }));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('[EvidenceController] Error fetching evidence:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve evidence records.',
      },
    });
  }
}

module.exports = {
  createEvidence,
  getEvidenceByCase,
};
