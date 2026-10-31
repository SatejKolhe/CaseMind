const { redact, redactRegex } = require('./redact');
const { extractEvidenceCandidates } = require('./intake');
const { analyze, analyzeValidated } = require('./analyze');
const { normalizeProposals } = require('./memoryLogic');
const { validateOutput, ValidationError } = require('./validate');
const { selectContext, estimateTokens, createDigest } = require('./contextBudget');
const { buildAnalysisInput, runAnalysisWithMode } = require('./modes');
const schemas = require('./schemas');
const config = require('./config');
const { buildChangeSummary, diffReports } = require('./changeSummary');
const { buildGraph } = require('./graphData');

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
    const allEvidenceItems = (contextData.allCaseEvidence || contextData.recentEvidence || []).concat([newEvidence]);
    const caseEvidenceIds = Array.from(
      new Set(
        allEvidenceItems
          .flatMap((e) => [
            e.evidenceCode ? e.evidenceCode.toString().trim() : null,
            e._id ? e._id.toString().trim() : null,
            e.id ? e.id.toString().trim() : null,
          ])
          .filter(Boolean)
      )
    );

    const evidenceStatuses = {};
    for (const item of allEvidenceItems) {
      const status = item.verificationStatus || 'unverified';
      if (item.evidenceCode) evidenceStatuses[item.evidenceCode.toString().trim()] = status;
      if (item._id) evidenceStatuses[item._id.toString().trim()] = status;
      if (item.id) evidenceStatuses[item.id.toString().trim()] = status;
    }

    const caseMemoryIds = Array.from(
      new Set(
        (contextData.memories || [])
          .flatMap((m) => [
            m.id ? m.id.toString().trim() : null,
            m._id ? m._id.toString().trim() : null,
          ])
          .filter(Boolean)
      )
    );

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

    // 11. Build deterministic change summary without LLM calls
    const retrieved =
      memoryMode === 'off'
        ? []
        : (selectedContext.included && selectedContext.included.relatedEvidence) || [];
    const retrievedEvidenceIds = retrieved.map((e) => e.evidenceCode || e._id || e.id).filter(Boolean);
    const retrievedMemoryIds =
      memoryMode === 'off'
        ? []
        : ((selectedContext.included && selectedContext.included.memories) || [])
            .map((m) => m._id || m.id)
            .filter(Boolean);

    const reportVersion =
      contextData.previousReport && typeof contextData.previousReport.version === 'number'
        ? contextData.previousReport.version + 1
        : 1;

    const changeSummary = buildChangeSummary({
      newEvidenceId: newEvidence.evidenceCode || newEvidence._id || newEvidence.id || evidenceId,
      retrievedEvidenceIds,
      retrievedMemoryIds,
      previousReport: contextData.previousReport || null,
      newReport: analysisOutput.report,
      acceptedProposals: normalizedProposals.accepted,
      reportVersion,
    });

    // 12. Return analysis payload. Note: Member 1's functions save to DB; processEvidence does not save.
    return {
      report: analysisOutput.report,
      memoryProposals: {
        accepted: normalizedProposals.accepted,
        rejected: normalizedProposals.rejected,
      },
      changeSummary,
      retrieved,
      status: 'ok',
      audit,
    };
  });
}

/**
 * Adapts high-level investigation synthesis for backend consumption per API_CONTRACT.md.
 * Synthesizes case evidence and active working memories, returning canonical sections.
 *
 * @param {object} params
 * @param {object} params.caseDetails
 * @param {Array<object>} params.evidenceList
 * @param {Array<object>} params.currentMemories
 * @returns {Promise<object>}
 */
async function analyzeInvestigation({ caseDetails, evidenceList = [], currentMemories = [] }) {
  if (!evidenceList || evidenceList.length === 0) {
    return {
      summary: `Investigation initialized for "${caseDetails?.title || 'Case'}". No evidence ingested yet.`,
      knownFacts: [],
      unverifiedClaims: [],
      evidenceConnections: [],
      contradictions: [],
      possibleHypotheses: [],
      openQuestions: ['Awaiting initial evidence submission.'],
      suggestedNextChecks: ['Gather initial witness statements and physical evidence.'],
      memoryUpdates: [],
      explanationOfChange: 'Initial baseline report created.',
    };
  }

  // Treat newest evidence item as newEvidence, earlier as relatedEvidence
  const sorted = [...evidenceList].sort((a, b) => {
    const timeA = new Date(a.occurredAt || 0).getTime();
    const timeB = new Date(b.occurredAt || 0).getTime();
    return timeA - timeB;
  });

  const newEvidence = sorted[sorted.length - 1];
  const relatedEvidence = sorted.slice(0, sorted.length - 1);

  const caseEvidenceIds = new Set(
    evidenceList.map((e) => e.evidenceCode || e.id || e._id).filter(Boolean)
  );
  const caseMemoryIds = new Set(
    currentMemories.map((m) => m.id || m._id).filter(Boolean)
  );

  const rawResult = await analyzeValidated({
    newEvidence,
    relatedEvidence,
    memories: currentMemories,
    caseEvidenceIds,
    caseMemoryIds,
  });

  const rep = rawResult.report || {};
  const proposals = rawResult.memoryProposals || [];

  // Map knownFacts
  const knownFacts = (rep.knownFacts || []).map((kf) => ({
    statement: kf.statement,
    verifiedByEvidenceCodes: (kf.evidenceIds || []).filter((id) => caseEvidenceIds.has(id)),
  })).filter((kf) => kf.verifiedByEvidenceCodes.length > 0);

  // Map unverifiedClaims
  const unverifiedClaims = (rep.unverifiedClaims || []).map((uc) => ({
    statement: uc.statement,
    source: uc.verificationStatus || 'unverified source',
    evidenceCodes: (uc.evidenceIds || []).filter((id) => caseEvidenceIds.has(id)),
  })).filter((uc) => uc.evidenceCodes.length > 0);

  // Map evidenceConnections
  const evidenceConnections = (rep.evidenceConnections || []).map((ec) => ({
    connection: ec.description,
    evidenceCodes: (ec.evidenceIds || []).filter((id) => caseEvidenceIds.has(id)),
  })).filter((ec) => ec.evidenceCodes.length > 0);

  // Map contradictions
  const contradictions = (rep.contradictions || []).map((c) => {
    const conflictingCodes = [
      ...(c.claimA?.evidenceIds || []),
      ...(c.claimB?.evidenceIds || []),
    ].filter((id) => caseEvidenceIds.has(id));

    return {
      pointOfConflict: c.explanation || `${c.claimA?.text || 'Claim A'} contradicts ${c.claimB?.text || 'Claim B'}`,
      conflictingEvidenceCodes: conflictingCodes,
    };
  }).filter((c) => c.conflictingEvidenceCodes.length > 0);

  // Map possibleHypotheses
  const possibleHypotheses = (rep.hypotheses || []).map((h) => {
    const supportedBy = (h.supportingEvidenceIds || []).filter((id) => caseEvidenceIds.has(id));
    const unresolvedPoints = (h.conflictingEvidenceIds || []).filter((id) => caseEvidenceIds.has(id));

    return {
      hypothesisId: h.hypothesisId || 'HYP-1',
      title: (h.description || 'Hypothesis').slice(0, 60),
      rationale: h.description || '',
      supportedBy,
      unresolvedPoints: unresolvedPoints.length > 0 ? unresolvedPoints : ['Requires further corroborating evidence.'],
    };
  });

  // Map openQuestions & suggestedNextChecks
  const openQuestions = (rep.openQuestions || []).map((q) => (typeof q === 'string' ? q : q.question)).filter(Boolean);
  const suggestedNextChecks = (rep.suggestedNextChecks || []).map((s) => {
    if (typeof s === 'string') return s;
    return `${s.check}${s.purpose ? ` (${s.purpose})` : ''}`.trim();
  }).filter(Boolean);

  // Map memoryUpdates
  const categoryMap = {
    fact: 'fact',
    lead: 'inference',
    inconsistency: 'contradiction',
    hypothesis: 'hypothesis',
    timeline_event: 'fact',
  };

  const memoryUpdates = [];
  for (const prop of proposals) {
    const category = categoryMap[prop.type] || 'inference';
    let action = 'add';
    let targetMemoryId = undefined;

    if (prop.action === 'supersede' && prop.targetMemoryId && caseMemoryIds.has(prop.targetMemoryId)) {
      action = 'supersede';
      targetMemoryId = prop.targetMemoryId;
    } else if (prop.action === 'update' && prop.targetMemoryId && caseMemoryIds.has(prop.targetMemoryId)) {
      action = 'update';
      targetMemoryId = prop.targetMemoryId;
    }

    const supportingEvidenceCodes = (prop.evidenceIds || []).filter((id) => caseEvidenceIds.has(id));
    if (supportingEvidenceCodes.length > 0) {
      const updateItem = {
        category,
        statement: prop.summary,
        supportingEvidenceCodes,
        action,
        changeReason: prop.reason || 'Synthesized from evidentiary analysis.',
      };
      if (targetMemoryId) {
        updateItem.targetMemoryId = targetMemoryId;
      }
      memoryUpdates.push(updateItem);
    }
  }

  const summary = `Investigation synthesis for "${caseDetails?.title || 'Case'}": Ingested ${evidenceList.length} evidence record(s). ${knownFacts.length} verified fact(s), ${possibleHypotheses.length} active hypothesis(es), and ${contradictions.length} contradiction(s) analyzed.`;

  return {
    summary,
    knownFacts,
    unverifiedClaims,
    evidenceConnections,
    contradictions,
    possibleHypotheses,
    openQuestions: openQuestions.length > 0 ? openQuestions : ['Monitor incoming forensic and testimonial evidence.'],
    suggestedNextChecks: suggestedNextChecks.length > 0 ? suggestedNextChecks : ['Verify timeline consistency across witness statements.'],
    memoryUpdates,
    explanationOfChange: `Synthesis updated based on latest evidence ${newEvidence.evidenceCode || newEvidence.title || ''}.`,
  };
}

module.exports = {
  // Core workflow export per SPEC.md
  processEvidence,

  // Change summary & diffing
  buildChangeSummary,
  diffReports,

  // Graph data export
  buildGraph,

  // Backend interoperability export
  analyzeInvestigation,

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
