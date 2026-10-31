const { ObjectId } = require('mongodb');
const { getDB, getClient } = require('../config/db');
const { analyzeInvestigation } = require('../services/aiAdapter');

const VALID_MEMORY_CATEGORIES = ['fact', 'claim', 'contradiction', 'inference', 'hypothesis', 'open_question'];
const VALID_MEMORY_ACTIONS = ['add', 'update', 'supersede'];

/**
 * Validates whether a string is a 24-character hexadecimal ObjectId representation.
 * @param {string} id
 * @returns {boolean}
 */
function isValidObjectIdString(id) {
  return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id) && ObjectId.isValid(id);
}

/**
 * Validates the structure and types of the AI output according to API_CONTRACT.md.
 * Returns an array of validation error messages.
 *
 * @param {object} output
 * @returns {string[]}
 */
function validateAiOutputStructure(output) {
  const errors = [];

  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return ['AI output must be a non-null object.'];
  }

  // 1. summary
  if (typeof output.summary !== 'string' || !output.summary.trim()) {
    errors.push("'summary' is required and must be a non-empty string.");
  }

  // 2. knownFacts
  if (!Array.isArray(output.knownFacts)) {
    errors.push("'knownFacts' is required and must be an Array.");
  } else {
    output.knownFacts.forEach((fact, idx) => {
      if (!fact || typeof fact !== 'object') {
        errors.push(`knownFacts[${idx}] must be an object.`);
      } else {
        if (typeof fact.statement !== 'string' || !fact.statement.trim()) {
          errors.push(`knownFacts[${idx}].statement must be a non-empty string.`);
        }
        if (!Array.isArray(fact.evidenceCodes)) {
          errors.push(`knownFacts[${idx}].evidenceCodes must be an Array of evidence codes.`);
        }
      }
    });
  }

  // 3. unverifiedClaims
  if (!Array.isArray(output.unverifiedClaims)) {
    errors.push("'unverifiedClaims' is required and must be an Array.");
  } else {
    output.unverifiedClaims.forEach((claim, idx) => {
      if (!claim || typeof claim !== 'object') {
        errors.push(`unverifiedClaims[${idx}] must be an object.`);
      } else {
        if (typeof claim.statement !== 'string' || !claim.statement.trim()) {
          errors.push(`unverifiedClaims[${idx}].statement must be a non-empty string.`);
        }
        if (typeof claim.source !== 'string') {
          errors.push(`unverifiedClaims[${idx}].source must be a string.`);
        }
        if (!Array.isArray(claim.evidenceCodes)) {
          errors.push(`unverifiedClaims[${idx}].evidenceCodes must be an Array of evidence codes.`);
        }
      }
    });
  }

  // 4. evidenceConnections
  if (!Array.isArray(output.evidenceConnections)) {
    errors.push("'evidenceConnections' is required and must be an Array.");
  } else {
    output.evidenceConnections.forEach((conn, idx) => {
      if (!conn || typeof conn !== 'object') {
        errors.push(`evidenceConnections[${idx}] must be an object.`);
      } else {
        if (typeof conn.connection !== 'string' || !conn.connection.trim()) {
          errors.push(`evidenceConnections[${idx}].connection must be a non-empty string.`);
        }
        if (!Array.isArray(conn.evidenceCodes)) {
          errors.push(`evidenceConnections[${idx}].evidenceCodes must be an Array of evidence codes.`);
        }
      }
    });
  }

  // 5. contradictions
  if (!Array.isArray(output.contradictions)) {
    errors.push("'contradictions' is required and must be an Array.");
  } else {
    output.contradictions.forEach((contra, idx) => {
      if (!contra || typeof contra !== 'object') {
        errors.push(`contradictions[${idx}] must be an object.`);
      } else {
        if (typeof contra.pointOfConflict !== 'string' || !contra.pointOfConflict.trim()) {
          errors.push(`contradictions[${idx}].pointOfConflict must be a non-empty string.`);
        }
        if (!Array.isArray(contra.conflictingEvidenceCodes)) {
          errors.push(`contradictions[${idx}].conflictingEvidenceCodes must be an Array of evidence codes.`);
        }
      }
    });
  }

  // 6. possibleHypotheses
  if (!Array.isArray(output.possibleHypotheses)) {
    errors.push("'possibleHypotheses' is required and must be an Array.");
  } else {
    output.possibleHypotheses.forEach((hypo, idx) => {
      if (!hypo || typeof hypo !== 'object') {
        errors.push(`possibleHypotheses[${idx}] must be an object.`);
      } else {
        if (typeof hypo.hypothesisId !== 'string' || !hypo.hypothesisId.trim()) {
          errors.push(`possibleHypotheses[${idx}].hypothesisId must be a non-empty string.`);
        }
        if (typeof hypo.title !== 'string' || !hypo.title.trim()) {
          errors.push(`possibleHypotheses[${idx}].title must be a non-empty string.`);
        }
        if (typeof hypo.rationale !== 'string' || !hypo.rationale.trim()) {
          errors.push(`possibleHypotheses[${idx}].rationale must be a non-empty string.`);
        }
        if (!Array.isArray(hypo.supportedBy)) {
          errors.push(`possibleHypotheses[${idx}].supportedBy must be an Array of evidence codes.`);
        }
        if (!Array.isArray(hypo.unresolvedPoints)) {
          errors.push(`possibleHypotheses[${idx}].unresolvedPoints must be an Array of strings.`);
        }
      }
    });
  }

  // 7. openQuestions
  if (!Array.isArray(output.openQuestions)) {
    errors.push("'openQuestions' is required and must be an Array.");
  } else {
    output.openQuestions.forEach((q, idx) => {
      if (typeof q !== 'string') {
        errors.push(`openQuestions[${idx}] must be a string.`);
      }
    });
  }

  // 8. suggestedNextChecks
  if (!Array.isArray(output.suggestedNextChecks)) {
    errors.push("'suggestedNextChecks' is required and must be an Array.");
  } else {
    output.suggestedNextChecks.forEach((chk, idx) => {
      if (typeof chk !== 'string') {
        errors.push(`suggestedNextChecks[${idx}] must be a string.`);
      }
    });
  }

  // 9. memoryUpdates
  if (!Array.isArray(output.memoryUpdates)) {
    errors.push("'memoryUpdates' is required and must be an Array.");
  } else {
    output.memoryUpdates.forEach((upd, idx) => {
      if (!upd || typeof upd !== 'object') {
        errors.push(`memoryUpdates[${idx}] must be an object.`);
      } else {
        if (!VALID_MEMORY_CATEGORIES.includes(upd.category)) {
          errors.push(
            `memoryUpdates[${idx}].category must be one of: ${VALID_MEMORY_CATEGORIES.join(', ')}.`
          );
        }
        if (typeof upd.statement !== 'string' || !upd.statement.trim()) {
          errors.push(`memoryUpdates[${idx}].statement must be a non-empty string.`);
        }
        if (!Array.isArray(upd.supportingEvidenceCodes)) {
          errors.push(`memoryUpdates[${idx}].supportingEvidenceCodes must be an Array of evidence codes.`);
        }
        if (!VALID_MEMORY_ACTIONS.includes(upd.action)) {
          errors.push(
            `memoryUpdates[${idx}].action must be one of: ${VALID_MEMORY_ACTIONS.join(', ')}.`
          );
        }
        if (upd.changeReason !== undefined && typeof upd.changeReason !== 'string') {
          errors.push(`memoryUpdates[${idx}].changeReason must be a string if provided.`);
        }
      }
    });
  }

  // 10. explanationOfChange
  const explanation = output.explanationOfChange || (output.memoryDelta && output.memoryDelta.explanation);
  if (explanation !== undefined && typeof explanation !== 'string') {
    errors.push("'explanationOfChange' must be a string if provided.");
  }

  return errors;
}

/**
 * Traverses all sections of the AI analysis output to extract all cited evidence codes
 * and checks them against the set of valid evidence codes existing for this case.
 *
 * @param {object} aiOutput
 * @param {Set<string>} validEvidenceCodeSet
 * @returns {string[]} List of invalid / non-existent evidence codes cited by the AI
 */
function getInvalidCitedEvidenceCodes(aiOutput, validEvidenceCodeSet) {
  const citedCodes = new Set();

  function checkCodes(codes) {
    if (Array.isArray(codes)) {
      for (const code of codes) {
        if (typeof code === 'string' && code.trim()) {
          citedCodes.add(code.trim());
        }
      }
    }
  }

  // 1. knownFacts
  if (Array.isArray(aiOutput.knownFacts)) {
    for (const item of aiOutput.knownFacts) {
      if (item) checkCodes(item.evidenceCodes);
    }
  }

  // 2. unverifiedClaims
  if (Array.isArray(aiOutput.unverifiedClaims)) {
    for (const item of aiOutput.unverifiedClaims) {
      if (item) checkCodes(item.evidenceCodes);
    }
  }

  // 3. evidenceConnections
  if (Array.isArray(aiOutput.evidenceConnections)) {
    for (const item of aiOutput.evidenceConnections) {
      if (item) checkCodes(item.evidenceCodes);
    }
  }

  // 4. contradictions
  if (Array.isArray(aiOutput.contradictions)) {
    for (const item of aiOutput.contradictions) {
      if (item) {
        checkCodes(item.conflictingEvidenceCodes);
        checkCodes(item.evidenceCodes);
      }
    }
  }

  // 5. possibleHypotheses
  if (Array.isArray(aiOutput.possibleHypotheses)) {
    for (const item of aiOutput.possibleHypotheses) {
      if (item) {
        checkCodes(item.supportedBy);
        checkCodes(item.evidenceCodes);
      }
    }
  }

  // 6. memoryUpdates
  if (Array.isArray(aiOutput.memoryUpdates)) {
    for (const item of aiOutput.memoryUpdates) {
      if (item) {
        checkCodes(item.supportingEvidenceCodes);
        checkCodes(item.conflictingEvidenceCodes);
      }
    }
  }

  const invalidCodes = [];
  for (const code of citedCodes) {
    if (!validEvidenceCodeSet.has(code)) {
      invalidCodes.push(code);
    }
  }

  return invalidCodes;
}

/**
 * POST /api/cases/:caseId/analyze
 * Orchestrates AI synthesis pipeline:
 *  1. Validates case ID and verifies existence
 *  2. Retrieves case-scoped evidence and active memories
 *  3. Invokes AI adapter with strict input contract
 *  4. Validates structural schema compliance of AI output
 *  5. Validates cited evidence codes against database records
 *  6. Validates target memory references for update/supersede mutations
 *  7. Allocates report version and persists report document
 *  8. Applies memory mutations with matched-count checks
 *  9. Returns report and memory delta
 */
async function analyzeCase(req, res) {
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

  // 3. Fetch evidence records strictly scoped to this case (chronological order)
  const evidenceDocs = await db
    .collection('evidence')
    .find({ caseId: objectId })
    .sort({ occurredAt: 1 })
    .toArray();

  const validEvidenceCodeSet = new Set(evidenceDocs.map((e) => e.evidenceCode));

  // Check optional triggerEvidenceCode if provided in request body
  const { triggerEvidenceCode } = req.body || {};
  if (triggerEvidenceCode !== undefined && triggerEvidenceCode !== null && String(triggerEvidenceCode).trim()) {
    const trimmedTrigger = String(triggerEvidenceCode).trim();
    if (!validEvidenceCodeSet.has(trimmedTrigger)) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'EVIDENCE_NOT_FOUND',
          message: `Trigger evidence code ${trimmedTrigger} does not exist for this case.`,
          details: { invalidEvidenceCodes: [trimmedTrigger] },
        },
      });
    }
  }

  // 4. Fetch active working memories strictly scoped to this case
  const activeMemoryDocs = await db
    .collection('memories')
    .find({ caseId: objectId, status: 'active' })
    .sort({ createdAt: 1 })
    .toArray();

  // 5. Map database documents to the exact AI input shape specified in API_CONTRACT.md
  const caseDetails = {
    id: caseDoc._id.toString(),
    title: caseDoc.title,
    description: caseDoc.description || '',
    status: caseDoc.status || 'open',
  };

  const evidenceList = evidenceDocs.map((doc) => ({
    evidenceCode: doc.evidenceCode,
    title: doc.title,
    content: doc.content,
    source: doc.source,
    sourceType: doc.sourceType,
    verificationStatus: doc.verificationStatus,
    occurredAt: doc.occurredAt instanceof Date ? doc.occurredAt.toISOString() : new Date(doc.occurredAt).toISOString(),
  }));

  const currentMemories = activeMemoryDocs.map((doc) => {
    const mem = {
      id: doc._id.toString(),
      category: doc.category,
      statement: doc.statement,
      supportingEvidenceCodes: Array.isArray(doc.supportingEvidenceCodes) ? doc.supportingEvidenceCodes : [],
    };
    if (Array.isArray(doc.conflictingEvidenceCodes)) {
      mem.conflictingEvidenceCodes = doc.conflictingEvidenceCodes;
    }
    if (doc.hypothesisDetails && typeof doc.hypothesisDetails === 'object') {
      mem.hypothesisDetails = {
        hypothesisId: doc.hypothesisDetails.hypothesisId,
        title: doc.hypothesisDetails.title,
        rationale: doc.hypothesisDetails.rationale,
        unresolvedPoints: Array.isArray(doc.hypothesisDetails.unresolvedPoints)
          ? doc.hypothesisDetails.unresolvedPoints
          : [],
      };
    }
    if (doc.source) {
      mem.source = doc.source;
    }
    return mem;
  });

  // 6. Call the AI adapter
  let aiOutput;
  try {
    aiOutput = await analyzeInvestigation({
      caseDetails,
      evidenceList,
      currentMemories,
    });
  } catch (error) {
    console.error(`[AnalysisController] AI Adapter failure for case ${caseId}:`, error.message);
    return res.status(502).json({
      success: false,
      error: {
        code: error.code || 'AI_SERVICE_UNAVAILABLE',
        message: `External AI synthesis failed: ${error.message}`,
        details: { caseId },
      },
    });
  }

  // 7. Validate AI output structure (Reject malformed output rather than converting to empty arrays)
  const structuralErrors = validateAiOutputStructure(aiOutput);
  if (structuralErrors.length > 0) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'INVALID_AI_OUTPUT',
        message: 'AI analysis returned structurally invalid output.',
        details: {
          validationErrors: structuralErrors,
        },
      },
    });
  }

  // 8. Validate all cited evidence codes against database records for this case
  const invalidCitedCodes = getInvalidCitedEvidenceCodes(aiOutput, validEvidenceCodeSet);
  if (invalidCitedCodes.length > 0) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'EVIDENCE_NOT_FOUND',
        message: 'One or more cited evidence codes do not exist for this case.',
        details: {
          invalidEvidenceCodes: invalidCitedCodes,
        },
      },
    });
  }

  // 9. Verify target memory IDs for update / supersede operations
  const rawMemoryUpdates = aiOutput.memoryUpdates;
  const memoryModifications = [];

  for (const item of rawMemoryUpdates) {
    if (item.action === 'update' || item.action === 'supersede') {
      const explicitTargetId = item.targetMemoryId || item.memoryId || item.targetId;
      if (explicitTargetId) {
        if (!isValidObjectIdString(explicitTargetId)) {
          return res.status(422).json({
            success: false,
            error: {
              code: 'TARGET_MEMORY_NOT_FOUND',
              message: `Target memory ID "${explicitTargetId}" is not a valid ObjectId format.`,
              details: { targetMemoryId: explicitTargetId },
            },
          });
        }

        const targetObjectId = new ObjectId(explicitTargetId);
        // Verify target memory exists within the current case
        const existingTargetMemory = await db.collection('memories').findOne({
          _id: targetObjectId,
          caseId: objectId,
        });

        if (!existingTargetMemory) {
          return res.status(422).json({
            success: false,
            error: {
              code: 'TARGET_MEMORY_NOT_FOUND',
              message: `Target memory ID "${explicitTargetId}" for action '${item.action}' does not exist in case ${caseId}.`,
              details: { targetMemoryId: explicitTargetId, caseId },
            },
          });
        }

        memoryModifications.push({
          targetId: targetObjectId,
          action: item.action,
          category: item.category,
          statement: item.statement,
          supportingEvidenceCodes: item.supportingEvidenceCodes,
          conflictingEvidenceCodes: item.conflictingEvidenceCodes,
          hypothesisDetails: item.hypothesisDetails,
          source: item.source,
          changeReason: item.changeReason,
        });
      } else {
        // Per API_CONTRACT.md and instructions:
        // Do not invent matching logic when no target ID is specified.
        // It remains documented in the report's memoryDelta, but no database document is modified.
        console.warn(
          `[AnalysisController] Notice: memoryUpdate action '${item.action}' does not specify a target memory ID. ` +
          `Document mutation skipped to prevent false modification; update preserved in report memoryDelta.`
        );
      }
    }
  }

  // 10. Allocate the next report version
  const latestReports = await db
    .collection('reports')
    .find({ caseId: objectId })
    .sort({ version: -1 })
    .limit(1)
    .project({ version: 1 })
    .toArray();

  const nextVersion = latestReports.length > 0 && typeof latestReports[0].version === 'number'
    ? latestReports[0].version + 1
    : 1;

  // 11. Prepare report document
  const now = new Date();
  const reportDoc = {
    caseId: objectId,
    version: nextVersion,
    summary: aiOutput.summary.trim(),
    knownFacts: aiOutput.knownFacts,
    unverifiedClaims: aiOutput.unverifiedClaims,
    evidenceConnections: aiOutput.evidenceConnections,
    contradictions: aiOutput.contradictions,
    possibleHypotheses: aiOutput.possibleHypotheses,
    openQuestions: aiOutput.openQuestions,
    suggestedNextChecks: aiOutput.suggestedNextChecks,
    memoryDelta: aiOutput.memoryDelta && Array.isArray(aiOutput.memoryDelta.added)
      ? aiOutput.memoryDelta
      : {
          added: rawMemoryUpdates.filter((u) => u.action === 'add').map((u) => u.statement),
          updated: rawMemoryUpdates.filter((u) => u.action === 'update' || u.action === 'supersede').map((u) => u.statement),
          explanation: aiOutput.explanationOfChange || '',
        },
    createdAt: now,
  };

  if (triggerEvidenceCode !== undefined && triggerEvidenceCode !== null && String(triggerEvidenceCode).trim()) {
    reportDoc.triggerEvidenceCode = String(triggerEvidenceCode).trim();
  }

  // 12. Prepare new memory documents to insert
  const newMemoriesToInsert = [];
  for (const item of rawMemoryUpdates) {
    if (item.action === 'add') {
      const newMemory = {
        caseId: objectId,
        category: item.category,
        statement: item.statement,
        supportingEvidenceCodes: item.supportingEvidenceCodes || [],
        status: 'active',
        lastUpdatedInVersion: nextVersion,
        changeReason: item.changeReason || '',
        createdAt: now,
        updatedAt: now,
      };

      if (Array.isArray(item.conflictingEvidenceCodes) && item.conflictingEvidenceCodes.length > 0) {
        newMemory.conflictingEvidenceCodes = item.conflictingEvidenceCodes;
      }
      if (item.hypothesisDetails && typeof item.hypothesisDetails === 'object') {
        newMemory.hypothesisDetails = {
          hypothesisId: item.hypothesisDetails.hypothesisId,
          title: item.hypothesisDetails.title,
          rationale: item.hypothesisDetails.rationale,
          unresolvedPoints: Array.isArray(item.hypothesisDetails.unresolvedPoints)
            ? item.hypothesisDetails.unresolvedPoints
            : [],
        };
      }
      if (item.source && typeof item.source === 'string') {
        newMemory.source = item.source;
      }

      newMemoriesToInsert.push(newMemory);
    }
  }

  // 13. Persist report and memory updates
  const client = getClient();
  let session = null;
  let useTransaction = false;

  const isTestEnvironment = process.env.NODE_ENV === 'test';

  // Allow test hook to force standalone fallback for testing partial persistence failure
  const forceFallback =
    isTestEnvironment &&
    (req.headers['x-test-force-fallback'] === 'true' || (req.body || {})._forceFallback === true);

  if (!forceFallback && client && typeof client.startSession === 'function') {
    try {
      session = client.startSession();
      if (client.topology && client.topology.description && client.topology.description.type !== 'Single') {
        useTransaction = true;
      }
    } catch (_) {
      session = null;
      useTransaction = false;
    }
  }

  let reportInsertResult;

  try {
    if (useTransaction && session) {
      // Preferred Strategy: MongoDB Multi-Document Transaction
      await session.withTransaction(async () => {
        reportInsertResult = await db.collection('reports').insertOne(reportDoc, { session });

        if (newMemoriesToInsert.length > 0) {
          await db.collection('memories').insertMany(newMemoriesToInsert, { session });
        }

        for (const mod of memoryModifications) {
          const updateFields = {
            lastUpdatedInVersion: nextVersion,
            changeReason: mod.changeReason || '',
            updatedAt: now,
          };
          if (mod.action === 'supersede') {
            updateFields.status = 'superseded';
          }
          if (mod.statement) updateFields.statement = mod.statement;
          if (mod.supportingEvidenceCodes) updateFields.supportingEvidenceCodes = mod.supportingEvidenceCodes;
          if (mod.hypothesisDetails) updateFields.hypothesisDetails = mod.hypothesisDetails;

          const updateResult = await db.collection('memories').updateOne(
            { _id: mod.targetId, caseId: objectId },
            { $set: updateFields },
            { session }
          );

          if (updateResult.matchedCount === 0) {
            throw new Error(`Target memory ${mod.targetId} was not matched during update.`);
          }
        }
      });
    } else {
      // Fallback Strategy: Standalone MongoDB without replica set
      // Step 1: Authoritative Report write first (immutable source of truth)
      reportInsertResult = await db.collection('reports').insertOne(reportDoc);

      // Step 2: Sequential memory mutations
      try {
        // Allow test simulation of memory persistence failure after report is inserted
        if (
          isTestEnvironment &&
          (req.headers['x-test-simulate-memory-failure'] === 'true' || (req.body || {})._simulateMemoryFailure === true)
        ) {
          throw new Error('Simulated memory persistence failure after report insertion.');
        }

        if (newMemoriesToInsert.length > 0) {
          await db.collection('memories').insertMany(newMemoriesToInsert);
        }

        for (const mod of memoryModifications) {
          const updateFields = {
            lastUpdatedInVersion: nextVersion,
            changeReason: mod.changeReason || '',
            updatedAt: now,
          };
          if (mod.action === 'supersede') {
            updateFields.status = 'superseded';
          }
          if (mod.statement) updateFields.statement = mod.statement;
          if (mod.supportingEvidenceCodes) updateFields.supportingEvidenceCodes = mod.supportingEvidenceCodes;
          if (mod.hypothesisDetails) updateFields.hypothesisDetails = mod.hypothesisDetails;

          const updateResult = await db.collection('memories').updateOne(
            { _id: mod.targetId, caseId: objectId },
            { $set: updateFields }
          );

          if (updateResult.matchedCount === 0) {
            throw new Error(`Target memory ${mod.targetId} was not matched during update.`);
          }
        }
      } catch (memError) {
        // Report was successfully committed and must NOT be deleted.
        // Log structured error as required by API_CONTRACT.md Section 6.2
        const reportId = reportInsertResult.insertedId.toString();

        console.error(
          JSON.stringify({
            event: 'PARTIAL_WRITE_UNRECONCILED',
            error: 'Memory persistence failed after report was inserted.',
            reportId,
            caseId: objectId.toString(),
            version: nextVersion,
            details: memError.message,
            timestamp: new Date().toISOString(),
          })
        );

        // Do not return a success response
        return res.status(500).json({
          success: false,
          error: {
            code: 'PARTIAL_WRITE_UNRECONCILED',
            message: 'Report version was committed, but working memory mutation failed. Database reconciliation required.',
            details: {
              reportId,
              caseId: objectId.toString(),
              version: nextVersion,
              memoryError: memError.message,
            },
          },
        });
      }
    }
  } catch (persistError) {
    // Detect duplicate key conflict on unique index { caseId: 1, version: 1 }
    if (persistError.code === 11000 || (persistError.name === 'MongoServerError' && persistError.code === 11000)) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'CONCURRENT_ANALYSIS_CONFLICT',
          message: 'Concurrent report generation attempted with the same version number. Please retry.',
          details: { caseId, version: nextVersion },
        },
      });
    }

    console.error(`[AnalysisController] Report persistence failed for case ${caseId}:`, persistError);
    return res.status(500).json({
      success: false,
      error: {
        code: 'PERSISTENCE_ERROR',
        message: 'Failed to persist analysis report.',
      },
    });
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch (_) {
        // Ignore session teardown error
      }
    }
  }

  // 14. Return the serialized report response
  const reportId = reportInsertResult.insertedId.toString();

  const responseData = {
    _id: reportId,
    reportId: reportId,
    caseId: objectId.toString(),
    version: reportDoc.version,
    summary: reportDoc.summary,
    knownFacts: reportDoc.knownFacts,
    unverifiedClaims: reportDoc.unverifiedClaims,
    evidenceConnections: reportDoc.evidenceConnections,
    contradictions: reportDoc.contradictions,
    possibleHypotheses: reportDoc.possibleHypotheses,
    openQuestions: reportDoc.openQuestions,
    suggestedNextChecks: reportDoc.suggestedNextChecks,
    memoryDelta: reportDoc.memoryDelta,
    createdAt: reportDoc.createdAt.toISOString(),
  };

  if (reportDoc.triggerEvidenceCode) {
    responseData.triggerEvidenceCode = reportDoc.triggerEvidenceCode;
  }

  return res.status(201).json({
    success: true,
    data: responseData,
  });
}

module.exports = {
  analyzeCase,
  validateAiOutputStructure,
  getInvalidCitedEvidenceCodes,
};
