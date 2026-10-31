/**
 * CaseMind Context Token Budgeting & Evidence Selection
 *
 * Prioritizes evidence ingestion to maximize signal under strict LLM context token constraints:
 * Priority Order:
 *  1. New Evidence (mandatory)
 *  2. Vector / Semantic search hits
 *  3. Evidence cited by active hypotheses
 *  4. Evidence cited by open contradictions
 *  5. Active working memories
 *  6. Recent timeline evidence (chronological fall-through)
 *
 * Unfitted items are condensed into single-line digests and logged in `excluded` with clear rationale
 * for Memory Inspector traceability.
 */

/**
 * Estimates token count from text or object based on 4 characters per token heuristic.
 *
 * @param {string|object} item Text or object to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(item) {
  if (!item) return 0;
  const str = typeof item === 'string' ? item : JSON.stringify(item);
  return Math.ceil(str.length / 4);
}

/**
 * Creates a one-line summary digest for an evidence item that does not fit into full context.
 * Format: "evidenceId: first 120 characters"
 *
 * @param {object} item Evidence record
 * @returns {{ id: string, summary: string }}
 */
function createDigest(item) {
  const id = item.id || item.evidenceId || item.evidenceCode || 'UNKNOWN';
  const textSource = item.content || item.description || item.title || item.originalText || '';
  const cleanSnippet = textSource.replace(/\s+/g, ' ').trim().slice(0, 120);
  return {
    id,
    summary: `${id}: ${cleanSnippet}`,
  };
}

/**
 * Selects and packs evidence and memories into the token budget in prioritized order.
 *
 * @param {object} inputs
 * @param {object} inputs.newEvidence The newly ingested evidence item (highest priority)
 * @param {Array<object>} [inputs.searchHits=[]] Semantic / vector retrieval hits
 * @param {Array<object>} [inputs.memories=[]] Active working memories
 * @param {Array<string|object>} [inputs.hypothesisEvidenceIds=[]] Evidence cited by active hypotheses
 * @param {Array<string|object>} [inputs.contradictionEvidenceIds=[]] Evidence cited by open contradictions
 * @param {Array<object>} [inputs.recentEvidence=[]] Most recent case evidence items
 * @param {number} [tokenBudget=6000] Maximum token budget for context
 * @returns {{
 *   included: { newEvidence: object, relatedEvidence: Array<object>, memories: Array<object> },
 *   digests: Array<{ id: string, summary: string }>,
 *   excluded: Array<{ id: string, reason: string, priorityTier: string }>,
 *   estimatedTokens: number,
 *   tokenBudget: number
 * }}
 */
function selectContext(
  {
    newEvidence,
    searchHits = [],
    memories = [],
    hypothesisEvidenceIds = [],
    contradictionEvidenceIds = [],
    recentEvidence = [],
  },
  tokenBudget = 6000
) {
  let currentTokens = 0;
  const includedEvidence = [];
  const includedMemories = [];
  const digests = [];
  const excluded = [];
  const seenEvidenceIds = new Set();

  const getId = (item) => (item ? item.id || item.evidenceId || item.evidenceCode || null : null);

  // 1. Priority 1: New Evidence (Mandatory)
  let includedNewEvidence = null;
  if (newEvidence) {
    const newId = getId(newEvidence);
    const newTokens = estimateTokens(newEvidence);
    if (newTokens <= tokenBudget) {
      includedNewEvidence = newEvidence;
      currentTokens += newTokens;
      if (newId) seenEvidenceIds.add(newId);
    } else {
      // Degraded case: new evidence alone exceeds entire budget
      includedNewEvidence = newEvidence;
      currentTokens += newTokens;
      if (newId) seenEvidenceIds.add(newId);
    }
  }

  // Helper map for fast ID lookup across all evidence inputs
  const allEvidenceMap = new Map();
  const registerEvidence = (item) => {
    if (item && typeof item === 'object') {
      const id = getId(item);
      if (id && !allEvidenceMap.has(id)) {
        allEvidenceMap.set(id, item);
      }
    }
  };

  searchHits.forEach(registerEvidence);
  recentEvidence.forEach(registerEvidence);

  // Resolve ID list or object list into full evidence objects
  const resolveList = (list) => {
    return list
      .map((entry) => {
        if (!entry) return null;
        if (typeof entry === 'string') {
          return allEvidenceMap.get(entry) || { id: entry, title: `Evidence ${entry}`, content: '' };
        }
        registerEvidence(entry);
        return entry;
      })
      .filter(Boolean);
  };

  const hypothesisEvidence = resolveList(hypothesisEvidenceIds);
  const contradictionEvidence = resolveList(contradictionEvidenceIds);

  // Assemble prioritized evidence candidate tiers
  const prioritizedTiers = [
    { tier: 'vector_hit', items: searchHits },
    { tier: 'active_hypothesis', items: hypothesisEvidence },
    { tier: 'open_contradiction', items: contradictionEvidence },
  ];

  // Process prioritized evidence tiers
  for (const { tier, items } of prioritizedTiers) {
    for (const item of items) {
      const id = getId(item);
      if (!id || seenEvidenceIds.has(id)) continue;

      const itemCost = estimateTokens(item);
      if (currentTokens + itemCost <= tokenBudget) {
        includedEvidence.push(item);
        currentTokens += itemCost;
        seenEvidenceIds.add(id);
      } else {
        // Exceeds budget -> create one-line digest and log exclusion
        const digest = createDigest(item);
        digests.push(digest);
        excluded.push({
          id,
          reason: `Exceeded token budget (${currentTokens + itemCost} > ${tokenBudget})`,
          priorityTier: tier,
        });
        seenEvidenceIds.add(id);
      }
    }
  }

  // 2. Priority 5: Active Working Memories
  for (const memory of memories) {
    const memId = memory.id || memory._id || memory.memoryId || 'MEM-UNSPECIFIED';
    const memCost = estimateTokens(memory);

    if (currentTokens + memCost <= tokenBudget) {
      includedMemories.push(memory);
      currentTokens += memCost;
    } else {
      excluded.push({
        id: memId,
        reason: `Exceeded token budget for working memory (${currentTokens + memCost} > ${tokenBudget})`,
        priorityTier: 'active_memory',
      });
    }
  }

  // 3. Priority 6: Recent Timeline Evidence (Remaining budget fill)
  for (const item of recentEvidence) {
    const id = getId(item);
    if (!id || seenEvidenceIds.has(id)) continue;

    const itemCost = estimateTokens(item);
    if (currentTokens + itemCost <= tokenBudget) {
      includedEvidence.push(item);
      currentTokens += itemCost;
      seenEvidenceIds.add(id);
    } else {
      const digest = createDigest(item);
      digests.push(digest);
      excluded.push({
        id,
        reason: `Exceeded token budget (${currentTokens + itemCost} > ${tokenBudget})`,
        priorityTier: 'recent_evidence',
      });
      seenEvidenceIds.add(id);
    }
  }

  return {
    included: {
      newEvidence: includedNewEvidence,
      relatedEvidence: includedEvidence,
      memories: includedMemories,
    },
    digests,
    excluded,
    estimatedTokens: currentTokens,
    tokenBudget,
  };
}

module.exports = {
  selectContext,
  estimateTokens,
  createDigest,
};
