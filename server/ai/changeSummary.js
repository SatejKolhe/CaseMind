/**
 * CaseMind - Pure Change Summary & Report Diffing Engine (changeSummary.js)
 *
 * Implements deterministic comparison between report versions and builds
 * an audit-grade change summary without making any LLM calls.
 */

/**
 * Generates a stable key for arbitrary section items to test equivalence.
 */
function getItemKey(sectionName, item) {
  if (!item || typeof item !== 'object') return String(item);

  switch (sectionName) {
    case 'hypotheses':
      return item.hypothesisId || item.id || item.description || JSON.stringify(item);

    case 'knownFacts':
      return (item.statement || '').trim();

    case 'unverifiedClaims':
      return (item.statement || '').trim();

    case 'evidenceConnections': {
      const ids = Array.isArray(item.evidenceIds) ? [...item.evidenceIds].sort().join(',') : '';
      return `${ids}::${(item.description || '').trim()}`;
    }

    case 'contradictions': {
      const idsA = Array.isArray(item.claimA && item.claimA.evidenceIds) ? [...item.claimA.evidenceIds].sort().join(',') : '';
      const idsB = Array.isArray(item.claimB && item.claimB.evidenceIds) ? [...item.claimB.evidenceIds].sort().join(',') : '';
      const textA = (item.claimA && item.claimA.text) || '';
      const textB = (item.claimB && item.claimB.text) || '';
      return `${idsA}|${idsB}::${textA}<->${textB}`;
    }

    case 'openQuestions':
      return (item.question || '').trim();

    case 'suggestedNextChecks':
      return (item.check || '').trim();

    case 'memoryUpdates': {
      const target = item.targetMemoryId || item.memoryId || '';
      return `${item.action || ''}::${target}::${(item.summary || '').trim()}`;
    }

    default:
      return JSON.stringify(item);
  }
}

/**
 * Pure diff between an old report and a new report across all 8 standard sections.
 * Matches hypotheses by hypothesisId.
 *
 * @param {object|null} oldReport Previous report version (or null if initial)
 * @param {object} newReport Newly generated report version
 * @returns {object} Additions, removals, and changes per section
 */
function diffReports(oldReport, newReport) {
  const sections = [
    'knownFacts',
    'unverifiedClaims',
    'evidenceConnections',
    'contradictions',
    'hypotheses',
    'openQuestions',
    'suggestedNextChecks',
    'memoryUpdates',
  ];

  const diff = {};

  for (const section of sections) {
    const oldItems = (oldReport && Array.isArray(oldReport[section])) ? oldReport[section] : [];
    const newItems = (newReport && Array.isArray(newReport[section])) ? newReport[section] : [];

    if (section === 'hypotheses') {
      // Hypotheses matching by hypothesisId
      const oldMap = new Map();
      oldItems.forEach((h) => {
        const id = h.hypothesisId || h.id;
        if (id) oldMap.set(id, h);
      });

      const newMap = new Map();
      newItems.forEach((h) => {
        const id = h.hypothesisId || h.id;
        if (id) newMap.set(id, h);
      });

      const added = [];
      const changed = [];
      const unchanged = [];

      newItems.forEach((newH) => {
        const id = newH.hypothesisId || newH.id;
        if (!oldMap.has(id)) {
          added.push(newH);
        } else {
          const oldH = oldMap.get(id);
          const statusChanged = oldH.status !== newH.status;
          const supportingChanged = JSON.stringify([...(oldH.supportingEvidenceIds || [])].sort()) !==
            JSON.stringify([...(newH.supportingEvidenceIds || [])].sort());
          const conflictingChanged = JSON.stringify([...(oldH.conflictingEvidenceIds || [])].sort()) !==
            JSON.stringify([...(newH.conflictingEvidenceIds || [])].sort());
          const descChanged = (oldH.description || '').trim() !== (newH.description || '').trim();

          if (statusChanged || supportingChanged || conflictingChanged || descChanged) {
            changed.push({
              id,
              from: oldH,
              to: newH,
              statusChanged,
              fromStatus: oldH.status,
              toStatus: newH.status,
            });
          } else {
            unchanged.push(newH);
          }
        }
      });

      const removed = [];
      oldItems.forEach((oldH) => {
        const id = oldH.hypothesisId || oldH.id;
        if (!newMap.has(id)) {
          removed.push(oldH);
        }
      });

      diff.hypotheses = { added, removed, changed, unchanged };
    } else {
      // Content-based key matching for other sections
      const oldKeyMap = new Map();
      oldItems.forEach((item) => {
        oldKeyMap.set(getItemKey(section, item), item);
      });

      const newKeyMap = new Map();
      newItems.forEach((item) => {
        newKeyMap.set(getItemKey(section, item), item);
      });

      const added = [];
      const unchanged = [];

      newItems.forEach((item) => {
        const key = getItemKey(section, item);
        if (oldKeyMap.has(key)) {
          unchanged.push(item);
        } else {
          added.push(item);
        }
      });

      const removed = [];
      oldItems.forEach((item) => {
        const key = getItemKey(section, item);
        if (!newKeyMap.has(key)) {
          removed.push(item);
        }
      });

      diff[section] = { added, removed, changed: [], unchanged };
    }
  }

  return diff;
}

/**
 * Builds an audit change summary between evidence processing steps.
 * Derived solely from input data and structural diffs, never from model prose.
 *
 * @param {object} params
 * @param {string} params.newEvidenceId The newly ingested evidence identifier
 * @param {Array<string>} [params.retrievedEvidenceIds=[]] Evidence IDs retrieved as context
 * @param {Array<string>} [params.retrievedMemoryIds=[]] Memory IDs retrieved as context
 * @param {object|null} [params.previousReport=null] Previous report document
 * @param {object} params.newReport Newly produced report document
 * @param {Array<object>} [params.acceptedProposals=[]] Accepted memory proposals
 * @param {number} [params.reportVersion=1] Report version number
 * @returns {{
 *   added: string,
 *   retrieved: { evidenceIds: Array<string>, memoryIds: Array<string> },
 *   newContradictions: Array<object>,
 *   changedHypotheses: Array<{ id: string, from: string, to: string }>,
 *   newConnections: Array<object>,
 *   memoryActions: Array<object>,
 *   reportVersion: number,
 *   preserved: { hypotheses: Array<string>, facts: Array<object> }
 * }}
 */
function buildChangeSummary({
  newEvidenceId,
  retrievedEvidenceIds = [],
  retrievedMemoryIds = [],
  previousReport = null,
  newReport,
  acceptedProposals = [],
  reportVersion = 1,
}) {
  const diff = diffReports(previousReport, newReport);

  // 1. Changed hypotheses: [{ id, from, to }]
  const changedHypotheses = (diff.hypotheses.changed || [])
    .filter((ch) => ch.statusChanged)
    .map((ch) => ({
      id: ch.id,
      from: ch.fromStatus,
      to: ch.toStatus,
    }));

  // 2. New contradictions
  const newContradictions = diff.contradictions.added || [];

  // 3. New connections
  const newConnections = diff.evidenceConnections.added || [];

  // 4. Memory actions taken
  const memoryActions = (acceptedProposals || []).map((p) => ({
    action: p.action,
    type: p.type,
    summary: p.summary,
    evidenceIds: p.evidenceIds || [],
    targetMemoryId: p.targetMemoryId || undefined,
    reason: p.reason,
  }));

  // 5. Preserved elements from prior synthesis
  const preservedHypothesisIds = (diff.hypotheses.unchanged || []).map(
    (h) => h.hypothesisId || h.id
  );
  const preservedFacts = diff.knownFacts.unchanged || [];

  return {
    added: newEvidenceId,
    retrieved: {
      evidenceIds: Array.isArray(retrievedEvidenceIds) ? retrievedEvidenceIds : [],
      memoryIds: Array.isArray(retrievedMemoryIds) ? retrievedMemoryIds : [],
    },
    newContradictions,
    changedHypotheses,
    newConnections,
    memoryActions,
    reportVersion: typeof reportVersion === 'number' ? reportVersion : 1,
    preserved: {
      hypotheses: preservedHypothesisIds,
      facts: preservedFacts,
    },
  };
}

module.exports = {
  diffReports,
  buildChangeSummary,
  getItemKey,
};
