const express = require('express');
const { processEvidence } = require('./index');
const { extractEvidenceCandidates } = require('./intake');
const realDeps = require('./deps.real');

const router = express.Router({ mergeParams: true });

// Configurable dependencies (defaults to realDeps, can be overridden in tests)
let activeDeps = realDeps;

/**
 * Configure or override the dependency adapter for the AI routes (e.g. for testing).
 * @param {Object} deps
 */
function setDeps(deps) {
  activeDeps = deps;
}

/**
 * Helper to handle analysis requests for analyze and reanalyze endpoints.
 */
async function handleAnalysisRequest(req, res, { reanalyze = false } = {}) {
  const { caseId, evidenceId } = req.params;
  const memoryQuery = req.query.memory;
  const memoryMode = String(memoryQuery).toLowerCase() === 'off' ? 'off' : 'on';

  if (!caseId || !evidenceId) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_PARAMETERS',
        message: 'Both caseId and evidenceId are required in the URL path.',
      },
    });
  }

  try {
    const result = await processEvidence(activeDeps, {
      caseId,
      evidenceId,
      memoryMode,
      reanalyze,
    });

    if (result.status === 'ok') {
      return res.status(200).json({
        success: true,
        data: result,
      });
    }

    return res.status(422).json({
      success: false,
      error: {
        code: 'ANALYSIS_FAILED',
        message: result.error || 'Evidence analysis failed.',
        evidencePreserved: result.evidencePreserved !== false,
      },
    });
  } catch (err) {
    // Catch missing Member 1 dependencies or system errors
    if (err.name === 'MissingMember1FunctionError') {
      return res.status(501).json({
        success: false,
        error: {
          code: 'MEMBER_1_DEPENDENCY_MISSING',
          message: err.message,
          signature: err.signature,
        },
      });
    }

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: err.message || 'Unexpected server error during analysis.',
      },
    });
  }
}

// 1. POST /api/cases/:caseId/evidence/:evidenceId/analyze?memory=on|off
router.post(
  ['/:caseId/evidence/:evidenceId/analyze', '/api/cases/:caseId/evidence/:evidenceId/analyze'],
  (req, res) => handleAnalysisRequest(req, res, { reanalyze: false })
);

// 2. POST /api/cases/:caseId/evidence/:evidenceId/reanalyze?memory=on|off
router.post(
  ['/:caseId/evidence/:evidenceId/reanalyze', '/api/cases/:caseId/evidence/:evidenceId/reanalyze'],
  (req, res) => handleAnalysisRequest(req, res, { reanalyze: true })
);

// 3. POST /api/cases/:caseId/intake (returns candidates; nothing saved until the user confirms)
router.post(['/:caseId/intake', '/api/cases/:caseId/intake'], async (req, res) => {
  const { caseId } = req.params;
  const rawText = req.body && (req.body.rawText || req.body.text || req.body.content);

  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'rawText is required and must be a non-empty string.',
        details: { field: 'rawText' },
      },
    });
  }

  try {
    const candidates = await extractEvidenceCandidates(rawText);

    return res.status(200).json({
      success: true,
      data: {
        caseId,
        candidates,
        count: candidates.length,
        notice: 'Candidates extracted for review. Nothing has been saved to the database.',
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTAKE_EXTRACTION_FAILED',
        message: err.message || 'Failed to extract evidence candidates.',
      },
    });
  }
});

// 4. GET /api/cases/:caseId/evidence/:evidenceId/analysis-status
router.get(
  ['/:caseId/evidence/:evidenceId/analysis-status', '/api/cases/:caseId/evidence/:evidenceId/analysis-status'],
  async (req, res) => {
    const { caseId, evidenceId } = req.params;

    try {
      if (typeof activeDeps.getAnalysisStatus === 'function') {
        const statusData = await activeDeps.getAnalysisStatus(caseId, evidenceId);
        return res.status(200).json({
          success: true,
          data: statusData,
        });
      }

      if (typeof activeDeps.getEvidence === 'function') {
        const evidence = await activeDeps.getEvidence(caseId, evidenceId);
        if (!evidence) {
          return res.status(404).json({
            success: false,
            error: {
              code: 'EVIDENCE_NOT_FOUND',
              message: `Evidence ${evidenceId} not found in case ${caseId}.`,
            },
          });
        }

        return res.status(200).json({
          success: true,
          data: {
            caseId,
            evidenceId,
            status: evidence.analysisStatus || 'unprocessed',
            error: evidence.analysisError || null,
          },
        });
      }

      // If activeDeps does not implement getEvidence or getAnalysisStatus
      return res.status(501).json({
        success: false,
        error: {
          code: 'MEMBER_1_DEPENDENCY_MISSING',
          message: 'Member 1 has not implemented getEvidence or getAnalysisStatus to check analysis lifecycle status.',
        },
      });
    } catch (err) {
      if (err.name === 'MissingMember1FunctionError') {
        return res.status(501).json({
          success: false,
          error: {
            code: 'MEMBER_1_DEPENDENCY_MISSING',
            message: err.message,
            signature: err.signature,
          },
        });
      }

      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: err.message || 'Failed to check analysis status.',
        },
      });
    }
  }
);

module.exports = router;
module.exports.setDeps = setDeps;
