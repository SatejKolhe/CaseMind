const path = require('path');

let customProvider = null;

/**
 * Injects a custom provider function for testing.
 * @param {Function|null} provider
 */
function setAiProvider(provider) {
  customProvider = provider;
}

/**
 * Resets the custom provider back to null (defaulting to the ai module).
 */
function resetAiProvider() {
  customProvider = null;
}

/**
 * Attempts to load the AI module from candidate paths.
 * Continues checking candidate paths until a module exporting 'analyzeInvestigation' is found.
 * Does not return merely because require() returned a truthy object.
 * Preserves error details across all checked paths.
 *
 * @returns {{ module: object|null, errors: Array<{ path: string, error: string }> }}
 */
function loadAiModule() {
  const possiblePaths = [
    path.resolve(__dirname, '../../../server/ai'),
    path.resolve(__dirname, '../../../server/ai/index'),
    path.resolve(__dirname, '../../../ai'),
    path.resolve(__dirname, '../../../ai/src/index'),
    path.resolve(__dirname, '../../../ai/src'),
  ];

  const loadErrors = [];

  for (const modulePath of possiblePaths) {
    try {
      const mod = require(modulePath);
      if (mod && typeof mod.analyzeInvestigation === 'function') {
        return { module: mod, errors: [] };
      }

      if (mod) {
        loadErrors.push({
          path: modulePath,
          error: "Module loaded successfully but does not export function 'analyzeInvestigation'.",
        });
      } else {
        loadErrors.push({
          path: modulePath,
          error: 'Module resolution returned null or empty export.',
        });
      }
    } catch (err) {
      loadErrors.push({
        path: modulePath,
        error: err.message,
      });
    }
  }

  return { module: null, errors: loadErrors };
}

/**
 * Normalizes snake_case keys to camelCase if present, without masking
 * invalid structures or changing data types to default empty arrays.
 *
 * @param {object} rawOutput
 * @returns {object}
 */
function canonicalizeKeys(rawOutput) {
  if (!rawOutput || typeof rawOutput !== 'object') {
    return rawOutput;
  }

  const result = { ...rawOutput };

  if (result.known_facts !== undefined && result.knownFacts === undefined) {
    result.knownFacts = result.known_facts;
  }
  if (result.unverified_claims !== undefined && result.unverifiedClaims === undefined) {
    result.unverifiedClaims = result.unverified_claims;
  }
  if (result.evidence_connections !== undefined && result.evidenceConnections === undefined) {
    result.evidenceConnections = result.evidence_connections;
  }
  if (result.possible_hypotheses !== undefined && result.possibleHypotheses === undefined) {
    result.possibleHypotheses = result.possible_hypotheses;
  }
  if (result.open_questions !== undefined && result.openQuestions === undefined) {
    result.openQuestions = result.open_questions;
  }
  if (result.suggested_next_checks !== undefined && result.suggestedNextChecks === undefined) {
    result.suggestedNextChecks = result.suggested_next_checks;
  }
  if (result.memory_updates !== undefined && result.memoryUpdates === undefined) {
    result.memoryUpdates = result.memory_updates;
  }
  if (result.explanation_of_change !== undefined && result.explanationOfChange === undefined) {
    result.explanationOfChange = result.explanation_of_change;
  }
  if (result.memory_delta !== undefined && result.memoryDelta === undefined) {
    result.memoryDelta = result.memory_delta;
  }

  return result;
}

/**
 * Primary AI adapter function for CaseMind synthesis.
 * Calls Dhruv's AI module if available, or the registered test provider.
 * Does NOT pretend mock responses are real AI output.
 *
 * @param {object} params
 * @param {object} params.caseDetails
 * @param {Array<object>} params.evidenceList
 * @param {Array<object>} params.currentMemories
 * @returns {Promise<object>}
 */
async function analyzeInvestigation({ caseDetails, evidenceList, currentMemories }) {
  // 1. If an explicit test provider was registered, invoke it
  if (customProvider && typeof customProvider === 'function') {
    const rawResult = await customProvider({ caseDetails, evidenceList, currentMemories });
    return canonicalizeKeys(rawResult);
  }

  // 2. Attempt to find and invoke the AI module
  const { module: aiModule, errors: loadErrors } = loadAiModule();
  if (!aiModule) {
    const errorDetails = loadErrors.length > 0
      ? loadErrors.map((e) => `[${e.path}]: ${e.error}`).join('; ')
      : 'No candidate module paths resolved.';
    const error = new Error(
      `AI analysis module (ai/) is not available or does not export 'analyzeInvestigation'. Details: ${errorDetails}`
    );
    error.code = 'AI_MODULE_UNAVAILABLE';
    error.details = { loadErrors };
    throw error;
  }

  try {
    const rawResult = await aiModule.analyzeInvestigation({
      caseDetails,
      evidenceList,
      currentMemories,
    });
    return canonicalizeKeys(rawResult);
  } catch (err) {
    const error = new Error(`External LLM / AI module execution failed: ${err.message}`);
    error.code = err.code || 'AI_EXECUTION_FAILED';
    error.originalError = err;
    throw error;
  }
}

module.exports = {
  analyzeInvestigation,
  setAiProvider,
  resetAiProvider,
  loadAiModule,
  canonicalizeKeys,
};
