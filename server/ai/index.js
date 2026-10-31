const { redact, redactRegex } = require('./redact');
const { extractEvidenceCandidates } = require('./intake');
const { analyze, analyzeValidated } = require('./analyze');
const { normalizeProposals } = require('./memoryLogic');
const { validateOutput, ValidationError } = require('./validate');
const { selectContext, estimateTokens, createDigest } = require('./contextBudget');
const { buildAnalysisInput, runAnalysisWithMode } = require('./modes');
const schemas = require('./schemas');
const config = require('./config');

/**
 * In-memory per-case promise queues to ensure strict sequential execution
 * per case while permitting different cases to process concurrently.
 * Map<string, Promise<any>>
 */
const caseQueues = new Map();

/**
 * Runs a function strictly within the sequential queue for the given caseId.
 * @param {string} caseId
 * @param {Function} taskFn
 * @returns {Promise<any>}
 */
function runInCaseQueue(caseId, taskFn) {
  const key = String(caseId);
  const previous = caseQueues.get(key) || Promise.resolve();

  const current = (async () => {
    try {
      await previous;
    } catch (_) {
      // Ignore previous errors so subsequent tasks for this case are not blocked
    }
    return await taskFn();
  })();

  caseQueues.set(
    key,
    current.finally(() => {
      if (caseQueues.get(key) === current) {
        caseQueues.delete(key);
      }
    })
  );

  return current;
}

/**
 * Analyzes an evidence item scoped to a case using the AI analysis pipeline.
 *
 * Flow:
 * 1. deps.getEvidence -> retrieves new evidence. Returns clear error if missing.
 * 2. Redaction before storing is Member 1's responsibility.
 * 3. deps.getContext -> selectContext -> buildAnalysisInput per memoryMode.
 * 4. analyzeValidated -> normalizeProposals.
 * 5. Returns { report, memoryProposals: { accepted, rejected }, changeSummary: null, retrieved, status: "ok" }.
 *    (Does NOT save to database; Member 1's functions save).
 * 6. On LLM or validation failure, returns { status: "analysis_failed", error, evidencePreserved: true }.
 *
 * @param {Object} deps Dependency adapter implementing getEvidence, getContext, setAnalysisStatus
 * @param {Object} options
 * @param {string} options.caseId
 * @param {string} options.evidenceId
 * @param {string} [options.memoryMode="on"] "on" | "off"
 * @param {boolean} [options.reanalyze=false] Force reanalysis even if evidence already has status "ok"
 * @returns {Promise<Object>}
 */
async function processEvidence(deps, { caseId, evidenceId, memoryMode = 'on', reanalyze = false }) {
  if (!caseId || !evidenceId) {
    return {
      status: 'analysis_failed',
      error: 'Both caseId and evidenceId are required.',
      evidencePreserved: true,
    };
  }

  if (!deps || typeof deps.getEvidence !== 'function') {
    return {
      status: 'analysis_failed',
      error: 'deps.getEvidence function is required to process evidence.',
      evidencePreserved: true,
    };
  }

  return runInCaseQueue(caseId, async () => {
    const startTime = Date.now();

    // 1. Retrieve the evidence item
    let newEvidence = null;
    try {
      newEvidence = await deps.getEvidence(caseId, evidenceId);
    } catch (err) {
      return {
        status: 'analysis_failed',
        error: `Failed to retrieve evidence: ${err.message}`,
        evidencePreserved: true,
      };
    }

    if (!newEvidence) {
      return {
        status: 'analysis_failed',
        error: `Evidence item ${evidenceId} not found in case ${caseId}.`,
        evidencePreserved: true,
      };
    }

    // 2. Idempotency check: if already processed successfully, return stored result unless reanalyze requested
    const currentStatus = newEvidence.analysisStatus || newEvidence.status;
    if (!reanalyze && currentStatus === 'ok') {
      let storedResult = null;
      if (typeof deps.getStoredResult === 'function') {
        storedResult = await deps.getStoredResult(caseId, evidenceId);
      } else if (newEvidence.lastAnalysisResult) {
        storedResult = newEvidence.lastAnalysisResult;
      }

      if (storedResult) {
        return {
          report: storedResult.report || storedResult,
          memoryProposals: storedResult.memoryProposals || { accepted: [], rejected: [] },
          changeSummary: storedResult.changeSummary || null,
          retrieved: storedResult.retrieved || [],
          status: 'ok',
          idempotent: true,
        };
      }
    }

    // 3. Mark status as pending
    if (typeof deps.setAnalysisStatus === 'function') {
      try {
        await deps.setAnalysisStatus(caseId, evidenceId, 'pending');
      } catch (err) {
        console.warn(`[AI ProcessEvidence] Warning: Failed to set status to pending: ${err.message}`);
      }
    }

    // 4. Retrieve context
    let contextData = {};
    try {
      if (typeof deps.getContext === 'function') {
        contextData = (await deps.getContext(caseId, { evidenceId, newEvidence })) || {};
      } else {
        const [searchHits, allEvidence, memories, previousReport] = await Promise.all([
          typeof deps.searchEvidence === 'function' ? deps.searchEvidence(caseId, newEvidence) : Promise.resolve([]),
          typeof deps.listEvidence === 'function' ? deps.listEvidence(caseId) : Promise.resolve([]),
          typeof deps.getActiveMemories === 'function' ? deps.getActiveMemories(caseId) : Promise.resolve([]),
          typeof deps.getLatestReport === 'function' ? deps.getLatestReport(caseId) : Promise.resolve(null),
        ]);
        contextData = {
          searchHits,
          recentEvidence: allEvidence,
          memories,
          previousReport,
        };
      }
    } catch (err) {
      const errorMsg = `Context retrieval failed: ${err.message}`;
      if (typeof deps.setAnalysisStatus === 'function') {
        await deps.setAnalysisStatus(caseId, evidenceId, 'analysis_failed', errorMsg);
      }
      return {
        status: 'analysis_failed',
        error: errorMsg,
        evidencePreserved: true,
      };
    }

    // 5. Select context within token budget and build mode-dependent input
    const contextBudget = (deps.config && deps.config.CONTEXT_TOKEN_BUDGET) || config.CONTEXT_TOKEN_BUDGET || 6000;
    const selectedContext = selectContext(
      {
        newEvidence,
        searchHits: contextData.searchHits || [],
        memories: contextData.memories || [],
        hypothesisEvidenceIds: contextData.hypothesisEvidenceIds || [],
        contradictionEvidenceIds: contextData.contradictionEvidenceIds || [],
        recentEvidence: contextData.recentEvidence || [],
      },
      contextBudget
    );

    const analysisInput = buildAnalysisInput({
      memoryMode,
      newEvidence,
      context: {
        ...selectedContext,
        previousReport: contextData.previousReport || null,
      },
    });

    // 6. Build validation context for reference integrity
    const allEvidenceItems = contextData.allCaseEvidence || contextData.recentEvidence || [newEvidence];
    const caseEvidenceIds = Array.from(
      new Set(
        allEvidenceItems
          .map((e) => e.evidenceCode || e._id || e.id)
          .concat([newEvidence.evidenceCode || newEvidence._id || newEvidence.id])
          .filter(Boolean)
      )
    );

    const evidenceStatuses = {};
    for (const item of allEvidenceItems) {
      const code = item.evidenceCode || item._id || item.id;
      if (code) evidenceStatuses[code] = item.verificationStatus || 'unverified';
    }
    const newCode = newEvidence.evidenceCode || newEvidence._id || newEvidence.id;
    if (newCode) evidenceStatuses[newCode] = newEvidence.verificationStatus || 'unverified';

    const caseMemoryIds = (contextData.memories || []).map((m) => m._id || m.id).filter(Boolean);

    const validationContext = {
      caseEvidenceIds,
      caseMemoryIds,
      evidenceStatuses,
    };

    // 7. Execute validated analysis with repair loop
    let analysisOutput;
    try {
      const llmCaller = deps.llmCaller || deps.llmCall;
      analysisOutput = await analyzeValidated(
        analysisInput,
        validationContext,
        llmCaller ? { llmCaller } : {}
      );
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err.message || 'Analysis validation failed';
      console.error(`[AI ProcessEvidence] Analysis failed for case ${caseId}, evidence ${evidenceId}: ${errorMsg} (${durationMs}ms)`);

      if (typeof deps.setAnalysisStatus === 'function') {
        try {
          await deps.setAnalysisStatus(caseId, evidenceId, 'analysis_failed', errorMsg);
        } catch (statusErr) {
          console.warn(`[AI ProcessEvidence] Warning: Failed to set failure status: ${statusErr.message}`);
        }
      }

      return {
        status: 'analysis_failed',
        error: errorMsg,
        evidencePreserved: true,
      };
    }

    const durationMs = Date.now() - startTime;

    // 8. Normalize memory proposals
    const existingMemories = contextData.memories || [];
    const normalizedProposals = normalizeProposals(analysisOutput.memoryProposals, existingMemories);

    // 9. Update status to ok
    if (typeof deps.setAnalysisStatus === 'function') {
      try {
        await deps.setAnalysisStatus(caseId, evidenceId, 'ok');
      } catch (statusErr) {
        console.warn(`[AI ProcessEvidence] Warning: Failed to set status to ok: ${statusErr.message}`);
      }
    }

    // 10. Audit log entry and sanitized telemetry (never logging raw text)
    const tokenEst = estimateTokens(JSON.stringify(analysisInput));
    const inputEvidenceIds = [newEvidence.evidenceCode || newEvidence._id || newEvidence.id].filter(Boolean);
    const audit = {
      model: config.AI_MODEL,
      inputEvidenceIds,
      timestamp: new Date().toISOString(),
      durationMs,
      estimatedTokens: tokenEst,
      validationOutcome: 'passed',
    };

    console.log(
      `[AI ProcessEvidence] Success case=${caseId} evidence=${evidenceId} duration=${durationMs}ms estTokens=${tokenEst} status=ok`
    );

    // 11. Return analysis payload. Note: Member 1's functions save to DB; processEvidence does not save.
    const retrieved = (selectedContext.included && selectedContext.included.relatedEvidence) || [];
    return {
      report: analysisOutput.report,
      memoryProposals: {
        accepted: normalizedProposals.accepted,
        rejected: normalizedProposals.rejected,
      },
      changeSummary: null,
      retrieved,
      status: 'ok',
      audit,
    };
  });
}

module.exports = {
  // Core workflow export per SPEC.md
  processEvidence,

  // Primary exports per SPEC.md & architecture
  redact,
  redactRegex,
  extractEvidenceCandidates,
  analyze,
  analyzeValidated,
  normalizeProposals,
  validateOutput,
  ValidationError,
  selectContext,
  estimateTokens,
  createDigest,
  buildAnalysisInput,
  runAnalysisWithMode,
  schemas,
};
