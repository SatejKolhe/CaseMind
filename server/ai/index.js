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
        details: Array.isArray(err.errors) ? err.errors : [errorMsg],
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
 * Maps raw or arbitrary memory proposal type to one of the 6 backend-supported memory categories:
 * ['fact', 'claim', 'contradiction', 'inference', 'hypothesis', 'open_question']
 *
 * @param {string} rawType
 * @returns {'fact'|'claim'|'contradiction'|'inference'|'hypothesis'|'open_question'}
 */
function mapMemoryCategory(rawType) {
  if (!rawType || typeof rawType !== 'string') return 'inference';
  const lower = rawType.toLowerCase().trim();

  switch (lower) {
    case 'fact':
    case 'verified_fact':
    case 'known_fact':
    case 'timeline_event':
    case 'timeline':
      return 'fact';

    case 'claim':
    case 'unverified_claim':
    case 'witness':
    case 'statement':
      return 'claim';

    case 'contradiction':
    case 'inconsistency':
    case 'conflict':
    case 'discrepancy':
      return 'contradiction';

    case 'hypothesis':
    case 'theory':
    case 'working_theory':
      return 'hypothesis';

    case 'open_question':
    case 'question':
    case 'unknown':
    case 'intelligence_gap':
      return 'open_question';

    case 'connection':
    case 'evidence_connection':
    case 'inference':
    case 'deduction':
    case 'lead':
    case 'link':
    default:
      return 'inference';
  }
}

/**
 * Maps model output into the shape strictly required by Member 1's backend validator (API_CONTRACT.md).
 *
 * @param {object} params
 * @param {object} params.rawResult - Raw or parsed model output containing report and memoryProposals
 * @param {object} [params.caseDetails] - Case details
 * @param {Array<object>} [params.evidenceList] - Evidence records in this case
 * @param {Array<object>} [params.currentMemories] - Active working memories in this case
 * @returns {object} Canonical backend investigation report object
 */
function mapModelOutputToBackend({ rawResult, caseDetails = {}, evidenceList = [], currentMemories = [] }) {
  const caseEvidenceIds = new Set(
    (evidenceList || []).map((e) => e.evidenceCode || e.id || e._id).filter(Boolean)
  );
  const caseMemoryIds = new Set(
    (currentMemories || []).map((m) => (m.id || m._id ? String(m.id || m._id).trim() : '')).filter(Boolean)
  );

  const rep = rawResult?.report || rawResult || {};
  const proposals = Array.isArray(rawResult?.memoryProposals)
    ? rawResult.memoryProposals
    : (Array.isArray(rep.memoryUpdates) ? rep.memoryUpdates : []);

  // 1. knownFacts
  const knownFacts = (rep.knownFacts || []).map((kf) => {
    const rawCodes = kf.evidenceCodes || kf.evidenceIds || [];
    const validCodes = (Array.isArray(rawCodes) ? rawCodes : [rawCodes])
      .map(String)
      .filter((id) => caseEvidenceIds.has(id));

    return {
      statement: typeof kf.statement === 'string' && kf.statement.trim() ? kf.statement.trim() : 'Verified fact',
      evidenceCodes: validCodes,
      verifiedByEvidenceCodes: validCodes,
    };
  }).filter((kf) => kf.evidenceCodes.length > 0 && kf.statement.length > 0);

  // 2. unverifiedClaims
  const unverifiedClaims = (rep.unverifiedClaims || []).map((uc) => {
    const rawCodes = uc.evidenceCodes || uc.evidenceIds || [];
    const validCodes = (Array.isArray(rawCodes) ? rawCodes : [rawCodes])
      .map(String)
      .filter((id) => caseEvidenceIds.has(id));

    const source = uc.source && typeof uc.source === 'string' && uc.source.trim()
      ? uc.source.trim()
      : (typeof uc.verificationStatus === 'string' ? uc.verificationStatus.trim() : 'Unverified source');

    return {
      statement: typeof uc.statement === 'string' && uc.statement.trim() ? uc.statement.trim() : 'Unverified claim',
      source: source || 'Unverified source',
      evidenceCodes: validCodes,
    };
  }).filter((uc) => uc.evidenceCodes.length > 0 && uc.statement.length > 0);

  // 3. evidenceConnections
  const evidenceConnections = (rep.evidenceConnections || []).map((ec) => {
    const rawCodes = ec.evidenceCodes || ec.evidenceIds || [];
    const validCodes = (Array.isArray(rawCodes) ? rawCodes : [rawCodes])
      .map(String)
      .filter((id) => caseEvidenceIds.has(id));

    const connection = ec.connection || ec.description || ec.statement || '';

    return {
      connection: typeof connection === 'string' && connection.trim() ? connection.trim() : 'Evidence connection',
      evidenceCodes: validCodes,
    };
  }).filter((ec) => ec.evidenceCodes.length > 0 && ec.connection.length > 0);

  // 4. contradictions
  const contradictions = (rep.contradictions || []).map((c) => {
    const rawCodes = [
      ...(Array.isArray(c.conflictingEvidenceCodes) ? c.conflictingEvidenceCodes : []),
      ...(Array.isArray(c.evidenceCodes) ? c.evidenceCodes : []),
      ...(Array.isArray(c.claimA?.evidenceIds) ? c.claimA.evidenceIds : []),
      ...(Array.isArray(c.claimB?.evidenceIds) ? c.claimB.evidenceIds : []),
    ];
    const validCodes = Array.from(new Set(rawCodes.map(String).filter((id) => caseEvidenceIds.has(id))));

    const pointOfConflict = c.pointOfConflict || c.explanation || c.statement ||
      (c.claimA?.text && c.claimB?.text ? `${c.claimA.text} contradicts ${c.claimB.text}` : 'Contradiction detected');

    return {
      pointOfConflict: typeof pointOfConflict === 'string' && pointOfConflict.trim()
        ? pointOfConflict.trim()
        : 'Point of conflict identified',
      conflictingEvidenceCodes: validCodes,
    };
  }).filter((c) => c.conflictingEvidenceCodes.length > 0 && c.pointOfConflict.length > 0);

  // 5. possibleHypotheses
  const possibleHypotheses = (rep.possibleHypotheses || rep.hypotheses || []).map((h, idx) => {
    const rawSupported = h.supportedBy || h.supportingEvidenceIds || h.evidenceCodes || [];
    const supportedBy = (Array.isArray(rawSupported) ? rawSupported : [rawSupported])
      .map(String)
      .filter((id) => caseEvidenceIds.has(id));

    const rawUnresolved = [
      ...(Array.isArray(h.unresolvedPoints) ? h.unresolvedPoints : []),
      ...(Array.isArray(h.conflictingEvidenceIds) ? h.conflictingEvidenceIds.map((id) => `Conflicting evidence ${id} pending reconciliation`) : []),
    ];
    const unresolvedPoints = rawUnresolved.map(String).filter(Boolean);

    const title = h.title && typeof h.title === 'string' && h.title.trim()
      ? h.title.trim()
      : (h.description || 'Investigative Hypothesis').slice(0, 60).trim();

    const rationale = h.rationale && typeof h.rationale === 'string' && h.rationale.trim()
      ? h.rationale.trim()
      : (h.description || 'Investigative theory formulated from evidence.').trim();

    return {
      hypothesisId: h.hypothesisId || `HYP-${idx + 1}`,
      title: title || 'Investigative Theory',
      rationale: rationale || 'Rationale pending.',
      supportedBy,
      unresolvedPoints: unresolvedPoints.length > 0 ? unresolvedPoints : ['Requires further corroborating evidence.'],
    };
  }).filter((h) => h.hypothesisId.length > 0 && h.title.length > 0 && h.rationale.length > 0);

  // 6. openQuestions
  const openQuestions = (rep.openQuestions || []).map((q) => {
    if (typeof q === 'string') return q.trim();
    if (q && typeof q === 'object' && typeof q.question === 'string') return q.question.trim();
    return '';
  }).filter(Boolean);

  // 7. suggestedNextChecks
  const suggestedNextChecks = (rep.suggestedNextChecks || []).map((s) => {
    if (typeof s === 'string') return s.trim();
    if (s && typeof s === 'object') {
      const check = typeof s.check === 'string' ? s.check.trim() : '';
      const purpose = typeof s.purpose === 'string' && s.purpose.trim() ? ` (${s.purpose.trim()})` : '';
      return `${check}${purpose}`.trim();
    }
    return '';
  }).filter(Boolean);

  // 8. memoryUpdates
  const memoryUpdates = [];
  for (const prop of proposals) {
    const rawType = prop.category || prop.type || 'inference';
    const category = mapMemoryCategory(rawType);

    let action = 'add';
    const rawAction = prop.action ? String(prop.action).toLowerCase().trim() : 'add';
    if (rawAction === 'supersede') {
      action = 'supersede';
    } else if (rawAction === 'update' || rawAction === 'mark_disputed' || rawAction === 'resolve') {
      action = 'update';
    } else {
      action = 'add';
    }

    const explicitTargetId = prop.targetMemoryId || prop.memoryId || prop.targetId;
    let targetMemoryId = undefined;
    if (explicitTargetId && typeof explicitTargetId === 'string' && caseMemoryIds.has(explicitTargetId.trim())) {
      targetMemoryId = explicitTargetId.trim();
    } else if (action === 'update' || action === 'supersede') {
      action = 'add';
    }

    const rawEvidence = prop.supportingEvidenceCodes || prop.evidenceIds || prop.evidenceCodes || [];
    const supportingEvidenceCodes = (Array.isArray(rawEvidence) ? rawEvidence : [rawEvidence])
      .map(String)
      .filter((id) => caseEvidenceIds.has(id));

    const statement = prop.statement || prop.summary || prop.description || '';
    if (typeof statement === 'string' && statement.trim()) {
      const updateItem = {
        category,
        statement: statement.trim(),
        supportingEvidenceCodes,
        action,
        changeReason: typeof prop.changeReason === 'string' && prop.changeReason.trim()
          ? prop.changeReason.trim()
          : (typeof prop.reason === 'string' && prop.reason.trim() ? prop.reason.trim() : 'Synthesized from evidentiary analysis.'),
      };
      if (targetMemoryId) {
        updateItem.targetMemoryId = targetMemoryId;
      }
      memoryUpdates.push(updateItem);
    }
  }

  // 9. summary
  const summary = (rep.summary && typeof rep.summary === 'string' && rep.summary.trim())
    ? rep.summary.trim()
    : `Investigation synthesis for "${caseDetails?.title || 'Case'}": Ingested ${evidenceList.length} evidence record(s). ${knownFacts.length} verified fact(s), ${possibleHypotheses.length} active hypothesis(es), and ${contradictions.length} contradiction(s) analyzed.`;

  // 10. explanationOfChange
  const explanationOfChange = rep.explanationOfChange && typeof rep.explanationOfChange === 'string'
    ? rep.explanationOfChange.trim()
    : (rep.memoryDelta?.explanation || 'Synthesis updated with latest evidentiary context.');

  const memoryDelta = {
    added: memoryUpdates.filter((u) => u.action === 'add').map((u) => u.statement),
    updated: memoryUpdates.filter((u) => u.action === 'update' || u.action === 'supersede').map((u) => u.statement),
    explanation: explanationOfChange,
  };

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
    memoryDelta,
    explanationOfChange,
  };
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

  return mapModelOutputToBackend({
    rawResult,
    caseDetails,
    evidenceList,
    currentMemories,
  });
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
  mapModelOutputToBackend,
  mapMemoryCategory,

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
