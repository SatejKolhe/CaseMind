const { analyze } = require('./analyze');

/**
 * Builds the analysis input bundle according to the requested memoryMode ("on" | "off").
 *
 * In "on" mode:
 *   Includes newEvidence, relatedEvidence, working memories, previousReport, and digests.
 * In "off" mode:
 *   Includes ONLY newEvidence. Everything else is explicitly empty or null.
 *
 * @param {object} params
 * @param {"on"|"off"} [params.memoryMode="on"] The memory mode
 * @param {object} params.newEvidence The newly ingested evidence item
 * @param {object} [params.context={}] Contextual data (relatedEvidence, memories, previousReport, digests)
 * @returns {{
 *   newEvidence: object,
 *   relatedEvidence: Array<object>,
 *   memories: Array<object>,
 *   previousReport: object|null,
 *   digests: Array<object>,
 *   memoryMode: "on"|"off"
 * }}
 */
function buildAnalysisInput({ memoryMode = 'on', newEvidence, context = {} }) {
  const normalizedMode = String(memoryMode || 'on').toLowerCase().trim();

  if (normalizedMode === 'off') {
    return {
      newEvidence,
      relatedEvidence: [],
      memories: [],
      previousReport: null,
      digests: [],
      memoryMode: 'off',
    };
  }

  // "on" mode: pack all contextual evidence, active memories, previous synthesis, and digests
  const relatedEvidence =
    context.relatedEvidence ||
    (context.included && context.included.relatedEvidence) ||
    [];

  const memories =
    context.memories ||
    (context.included && context.included.memories) ||
    [];

  const previousReport = context.previousReport || null;
  const digests = context.digests || [];

  return {
    newEvidence,
    relatedEvidence,
    memories,
    previousReport,
    digests,
    memoryMode: 'on',
  };
}

/**
 * Executes analysis respecting the specified memoryMode ("on" | "off").
 *
 * @param {object} params
 * @param {"on"|"off"} [params.memoryMode="on"]
 * @param {object} params.newEvidence
 * @param {object} [params.context={}]
 * @param {Function} [params.analyzeFn=analyze] Custom analyze function (for testing or validation wrapper)
 * @returns {Promise<{ report: object, memoryProposals: Array<object>, memoryMode: "on"|"off", analysisInput: object }>}
 */
async function runAnalysisWithMode({
  memoryMode = 'on',
  newEvidence,
  context = {},
  analyzeFn = analyze,
}) {
  const analysisInput = buildAnalysisInput({ memoryMode, newEvidence, context });

  const result = await analyzeFn({
    newEvidence: analysisInput.newEvidence,
    relatedEvidence: analysisInput.relatedEvidence,
    memories: analysisInput.memories,
    previousReport: analysisInput.previousReport,
    digests: analysisInput.digests,
  });

  return {
    report: result.report,
    memoryProposals: result.memoryProposals,
    memoryMode: analysisInput.memoryMode,
    analysisInput,
  };
}

module.exports = {
  buildAnalysisInput,
  runAnalysisWithMode,
};
