const { ModelOutputSchema, modelOutputJsonSchema } = require('./schemas');
const { SYSTEM_PROMPT } = require('./prompts/system');
const { generateJson } = require('./llm');
const { buildUserMessage } = require('./analyze');

/**
 * Custom error thrown when output fails validation after repair attempts.
 */
class ValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'ValidationError';
    this.errors = Array.isArray(errors) ? errors : [errors];
  }
}

/**
 * Accusation & Guilt regex detection patterns.
 * CaseMind strictly prohibits adjudicative declarations, naming culprits, or demanding arrests.
 */
const ACCUSATION_PATTERNS = [
  /\b(?:is|was|are|were)\s+guilty\b/i,
  /\bguilty\s+of\b/i,
  /\bcommitted\s+the\s+(?:crime|theft|fraud|leak|incident|breach|robbery|offense)\b/i,
  /\b(?:is|was|the)\s+culprit\b/i,
  /\bculprit\s+is\b/i,
  /\bperpetrator\s+is\b/i,
  /\bshould\s+be\s+arrested\b/i,
  /\bmust\s+be\s+arrested\b/i,
  /\barrest\s+(?:him|her|them|[A-Z][a-z]+)\b/i,
  /\bconfessed\s+to\s+the\s+crime\b/i,
];

/**
 * Patterns indicating an attempt to mutate or delete original evidence records.
 */
const EVIDENCE_MUTATION_PATTERNS = [
  /\b(?:delete|remove|erase|modify|edit|alter)\s+(?:original\s+)?evidence\b/i,
  /\b(?:delete|remove|erase)\s+EV-\d+\b/i,
];

/**
 * Recursively scans all string properties of an object to check for regex violations.
 */
function scanStringsForPatterns(obj, patterns, path = '') {
  const matches = [];
  if (!obj) return matches;

  if (typeof obj === 'string') {
    for (const pattern of patterns) {
      if (pattern.test(obj)) {
        matches.push({ path, value: obj, pattern: pattern.toString() });
      }
    }
    return matches;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      matches.push(...scanStringsForPatterns(item, patterns, `${path}[${index}]`));
    });
    return matches;
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      const subPath = path ? `${path}.${key}` : key;
      matches.push(...scanStringsForPatterns(value, patterns, subPath));
    }
  }

  return matches;
}

/**
 * Recursively extracts all cited evidence IDs from the model output.
 */
function collectAllCitedEvidenceIds(output) {
  const ids = new Set();
  if (!output || typeof output !== 'object') return ids;

  const report = output.report || {};
  const addIds = (list) => {
    if (Array.isArray(list)) {
      list.forEach((id) => {
        if (typeof id === 'string' && id.trim()) {
          ids.add(id.trim());
        }
      });
    }
  };

  // 1. knownFacts
  if (Array.isArray(report.knownFacts)) {
    report.knownFacts.forEach((kf) => addIds(kf.evidenceIds));
  }
  // 2. unverifiedClaims
  if (Array.isArray(report.unverifiedClaims)) {
    report.unverifiedClaims.forEach((uc) => addIds(uc.evidenceIds));
  }
  // 3. evidenceConnections
  if (Array.isArray(report.evidenceConnections)) {
    report.evidenceConnections.forEach((ec) => addIds(ec.evidenceIds));
  }
  // 4. contradictions
  if (Array.isArray(report.contradictions)) {
    report.contradictions.forEach((c) => {
      addIds(c.claimA?.evidenceIds);
      addIds(c.claimB?.evidenceIds);
    });
  }
  // 5. hypotheses
  if (Array.isArray(report.hypotheses)) {
    report.hypotheses.forEach((h) => {
      addIds(h.supportingEvidenceIds);
      addIds(h.conflictingEvidenceIds);
    });
  }
  // 6. openQuestions
  if (Array.isArray(report.openQuestions)) {
    report.openQuestions.forEach((oq) => addIds(oq.relatedEvidenceIds));
  }
  // 7. memoryUpdates
  if (Array.isArray(report.memoryUpdates)) {
    report.memoryUpdates.forEach((mu) => addIds(mu.evidenceIds));
  }
  // 8. memoryProposals
  if (Array.isArray(output.memoryProposals)) {
    output.memoryProposals.forEach((mp) => addIds(mp.evidenceIds));
  }

  return ids;
}

/**
 * Validates the model output against data integrity, ethical, and schema requirements.
 *
 * @param {object} output Model output { report, memoryProposals }
 * @param {object} context
 * @param {Array<string>|Set<string>} context.caseEvidenceIds All valid evidence IDs for the case
 * @param {Array<string>|Set<string>} [context.caseMemoryIds=[]] Valid working memory IDs for the case
 * @param {Record<string, string>} [context.evidenceStatuses={}] Map of evidenceId -> verificationStatus
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateOutput(output, { caseEvidenceIds = [], caseMemoryIds = [], evidenceStatuses = {} } = {}) {
  const errors = [];

  // 1. Zod schema validation & check that all eight sections exist
  const parsed = ModelOutputSchema.safeParse(output);
  if (!parsed.success) {
    parsed.error.issues.forEach((issue) => {
      const fieldPath = issue.path.join('.') || 'root';
      errors.push(`[Schema Error] ${fieldPath}: ${issue.message}`);
    });
    return { valid: false, errors };
  }

  const validEvidenceSet = new Set(
    (Array.isArray(caseEvidenceIds) ? caseEvidenceIds : Array.from(caseEvidenceIds || []))
      .map((id) => (id ? id.toString().trim() : ''))
      .filter(Boolean)
  );
  const validMemorySet = new Set(
    (Array.isArray(caseMemoryIds) ? caseMemoryIds : Array.from(caseMemoryIds || []))
      .map((id) => (id ? id.toString().trim() : ''))
      .filter(Boolean)
  );

  // 2. Check every evidenceId anywhere in the output exists in caseEvidenceIds
  const citedEvidenceIds = collectAllCitedEvidenceIds(output);
  const invalidEvidenceIds = [];
  for (const citedId of citedEvidenceIds) {
    if (!validEvidenceSet.has(citedId)) {
      invalidEvidenceIds.push(citedId);
    }
  }
  if (invalidEvidenceIds.length > 0) {
    errors.push(
      `[Unknown Evidence Citations] The following cited evidence IDs do not exist in the case: ${invalidEvidenceIds.join(', ')}. Valid IDs: [${Array.from(validEvidenceSet).join(', ')}]`
    );
  }

  // 3. Every targetMemoryId exists in caseMemoryIds
  const checkMemoryId = (memId, location) => {
    if (memId && typeof memId === 'string' && memId.trim()) {
      if (!validMemorySet.has(memId.trim())) {
        errors.push(`[Unknown Memory Target] Target memory ID "${memId}" in ${location} does not exist in active case memories.`);
      }
    }
  };

  if (Array.isArray(output.memoryProposals)) {
    output.memoryProposals.forEach((p, idx) => {
      if (p.targetMemoryId) {
        checkMemoryId(p.targetMemoryId, `memoryProposals[${idx}]`);
      }
    });
  }
  if (Array.isArray(output.report?.memoryUpdates)) {
    output.report.memoryUpdates.forEach((mu, idx) => {
      if (mu.memoryId) {
        checkMemoryId(mu.memoryId, `report.memoryUpdates[${idx}]`);
      }
    });
  }

  // 4. No knownFacts item relies only on unverified or disputed evidence
  // Map or lookup function for verificationStatus
  const getStatus = (id) => {
    if (typeof evidenceStatuses === 'function') {
      return evidenceStatuses(id);
    }
    return evidenceStatuses[id] || 'unverified';
  };

  if (Array.isArray(output.report?.knownFacts)) {
    output.report.knownFacts.forEach((kf, idx) => {
      const cited = kf.evidenceIds || [];
      const hasVerifiedEvidence = cited.some((id) => {
        const s = getStatus(id);
        return s === 'verified';
      });

      if (!hasVerifiedEvidence && cited.length > 0) {
        errors.push(
          `[Ungrounded Fact] knownFacts[${idx}] ("${kf.statement}") relies solely on unverified or disputed evidence: [${cited.join(', ')}]. Items lacking verified backing must be categorized under unverifiedClaims.`
        );
      }
    });
  }

  // 5. Accusation check: scan all text fields for named person combined with guilt/accusation language
  const accusationMatches = scanStringsForPatterns(output, ACCUSATION_PATTERNS);
  if (accusationMatches.length > 0) {
    accusationMatches.forEach((m) => {
      errors.push(
        `[Ethical Violation] Accusation or guilt language detected at ${m.path}: "${m.value.slice(0, 100)}...". CaseMind strictly forbids accusing named persons or determining guilt.`
      );
    });
  }

  // 6. Memory proposals may not propose deleting or editing original evidence
  if (Array.isArray(output.memoryProposals)) {
    output.memoryProposals.forEach((p, idx) => {
      const text = `${p.summary} ${p.reason}`;
      const mutationMatches = scanStringsForPatterns(text, EVIDENCE_MUTATION_PATTERNS);
      if (mutationMatches.length > 0 || p.type?.toLowerCase() === 'evidence') {
        errors.push(
          `[Illegal Mutation] memoryProposals[${idx}] proposes deleting, altering, or replacing original immutable evidence records. Original evidence is immutable.`
        );
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Builds the repair user prompt when validation fails.
 */
function buildRepairPrompt({ originalUserMessage, previousOutput, errors }) {
  return `${originalUserMessage}

======================================================
REPAIR INSTRUCTIONS - PREVIOUS ATTEMPT FAILED VALIDATION
======================================================
Your previous response failed automated verification with the following ${errors.length} error(s):
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

PREVIOUS FLAWED OUTPUT:
${JSON.stringify(previousOutput, null, 2)}

TASK:
Correct every listed error and regenerate the complete, valid output.
- Replace any invalid evidence IDs with real evidence IDs from the input.
- Move any knownFacts that lack verified evidence to unverifiedClaims.
- Remove all accusations, culprit labels, or guilt determinations.
- Return the full corrected report and memoryProposals strictly adhering to the JSON schema.`;
}

/**
 * Runs the analysis pipeline and performs automated validation.
 * If validation fails, performs ONE repair round passing the errors back to the model.
 * If it still fails, throws ValidationError. Never returns or saves invalid output.
 *
 * @param {object} params Evidence and case inputs
 * @param {object} context Validation context { caseEvidenceIds, caseMemoryIds, evidenceStatuses }
 * @param {object} [options] Injection options for testing (e.g. custom generateJson)
 */
async function analyzeValidated(
  { newEvidence, relatedEvidence = [], memories = [], previousReport = null, digests = [] },
  { caseEvidenceIds = [], caseMemoryIds = [], evidenceStatuses = {} } = {},
  { llmCaller = generateJson } = {}
) {
  // If evidenceStatuses is not supplied, populate from input evidence items
  const statusMap = { ...evidenceStatuses };
  if (newEvidence && (newEvidence.id || newEvidence.evidenceCode)) {
    const id = newEvidence.id || newEvidence.evidenceCode;
    if (newEvidence.verificationStatus) statusMap[id] = newEvidence.verificationStatus;
  }
  if (Array.isArray(relatedEvidence)) {
    relatedEvidence.forEach((e) => {
      const id = e.id || e.evidenceCode;
      if (id && e.verificationStatus) statusMap[id] = e.verificationStatus;
    });
  }

  const allCaseEvidenceIds = new Set([
    ...Array.from(caseEvidenceIds || []),
    ...(newEvidence ? [newEvidence.id || newEvidence.evidenceCode] : []),
    ...(Array.isArray(relatedEvidence) ? relatedEvidence.map((e) => e.id || e.evidenceCode) : []),
  ].filter(Boolean));

  const allCaseMemoryIds = new Set([
    ...Array.from(caseMemoryIds || []).map((m) => (m ? m.toString().trim() : '')),
    ...(Array.isArray(memories) ? memories.flatMap((m) => [m.id ? m.id.toString().trim() : '', m._id ? m._id.toString().trim() : '']) : []),
  ].filter(Boolean));

  const validationContext = {
    caseEvidenceIds: allCaseEvidenceIds,
    caseMemoryIds: allCaseMemoryIds,
    evidenceStatuses: statusMap,
  };

  const userMessage = buildUserMessage({
    newEvidence,
    relatedEvidence,
    memories,
    previousReport,
    digests,
  });

  const isDebugAi = process.env.DEBUG_AI === 'true';

  // 1. Initial Model Call
  const rawOutput = await llmCaller({
    system: SYSTEM_PROMPT,
    user: userMessage,
    jsonSchema: modelOutputJsonSchema,
    temperature: 0.2,
  });

  // 2. Validate initial output
  const initialValidation = validateOutput(rawOutput, validationContext);
  if (isDebugAi) {
    console.log('[DEBUG_AI] Attempt 1 validation errors:', initialValidation.errors);
    console.log(
      '[DEBUG_AI] Attempt 1 raw model output (truncated to 3000 chars):\n',
      JSON.stringify(rawOutput, null, 2).slice(0, 3000)
    );
  }

  if (initialValidation.valid) {
    return rawOutput;
  }

  // 3. Validation failed -> ONE repair call
  console.warn(
    `[analyzeValidated] Output failed validation with ${initialValidation.errors.length} issue(s):\n  - ${initialValidation.errors.join('\n  - ')}\nInitiating 1 repair attempt...`
  );

  const repairMessage = buildRepairPrompt({
    originalUserMessage: userMessage,
    previousOutput: rawOutput,
    errors: initialValidation.errors,
  });

  const repairedOutput = await llmCaller({
    system: SYSTEM_PROMPT,
    user: repairMessage,
    jsonSchema: modelOutputJsonSchema,
    temperature: 0.1,
  });

  // 4. Validate repaired output
  const repairValidation = validateOutput(repairedOutput, validationContext);
  if (isDebugAi) {
    console.log('[DEBUG_AI] Attempt 2 (repair) validation errors:', repairValidation.errors);
    console.log(
      '[DEBUG_AI] Attempt 2 raw model output (truncated to 3000 chars):\n',
      JSON.stringify(repairedOutput, null, 2).slice(0, 3000)
    );
  }

  if (repairValidation.valid) {
    console.log('[analyzeValidated] Repair attempt succeeded: output is now valid.');
    return repairedOutput;
  }

  console.warn(
    `[analyzeValidated] Repair attempt failed with ${repairValidation.errors.length} issue(s):\n  - ${repairValidation.errors.join('\n  - ')}`
  );

  // 5. Still invalid -> throw ValidationError. Never return or save invalid output!
  const validationError = new ValidationError(
    `[analyzeValidated] Output failed validation after repair attempt (${repairValidation.errors.length} error(s) remain).`,
    repairValidation.errors
  );
  validationError.allErrors = {
    attempt1: initialValidation.errors,
    attempt2: repairValidation.errors,
  };
  throw validationError;
}

module.exports = {
  ValidationError,
  validateOutput,
  analyzeValidated,
  scanStringsForPatterns,
  collectAllCitedEvidenceIds,
  ACCUSATION_PATTERNS,
};
