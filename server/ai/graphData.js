/**
 * CaseMind AI Module - Graph Data Builder (graphData.js)
 *
 * Converts an investigative report into a lightweight graph structure:
 * {
 *   nodes: [{ id: string, type: 'evidence'|'hypothesis', label: string }],
 *   edges: [{ from: string, to: string, kind: 'connection'|'contradiction'|'supports'|'conflicts' }]
 * }
 *
 * Derived strictly from report evidenceIds and hypothesis fields. No LLM calls.
 */

/**
 * Builds nodes and edges from an investigative report object.
 *
 * @param {object} report Investigative report conforming to SPEC.md
 * @returns {{
 *   nodes: Array<{ id: string, type: 'evidence'|'hypothesis', label: string }>,
 *   edges: Array<{ from: string, to: string, kind: 'connection'|'contradiction'|'supports'|'conflicts' }>
 * }}
 */
function buildGraph(report) {
  if (!report || typeof report !== 'object') {
    return { nodes: [], edges: [] };
  }

  const nodesMap = new Map();
  const edges = [];
  const seenEdges = new Set();

  /**
   * Helper to register an evidence node.
   * @param {string} rawId
   */
  function registerEvidenceNode(rawId) {
    if (!rawId || typeof rawId !== 'string') return;
    const id = rawId.trim();
    if (!id) return;
    if (!nodesMap.has(id)) {
      nodesMap.set(id, {
        id,
        type: 'evidence',
        label: id,
      });
    }
  }

  /**
   * Helper to register a hypothesis node.
   * @param {object} hyp
   * @returns {string|null} hypothesis ID
   */
  function registerHypothesisNode(hyp) {
    if (!hyp || typeof hyp !== 'object') return null;
    const hypId = (hyp.hypothesisId || hyp.id || '').trim();
    if (!hypId) return null;

    if (!nodesMap.has(hypId)) {
      const label =
        hyp.description && typeof hyp.description === 'string' && hyp.description.trim()
          ? hyp.description.trim()
          : hypId;

      nodesMap.set(hypId, {
        id: hypId,
        type: 'hypothesis',
        label,
      });
    }
    return hypId;
  }

  // 1. Process Hypotheses: register hypothesis nodes and 'supports' / 'conflicts' edges
  if (Array.isArray(report.hypotheses)) {
    for (const hyp of report.hypotheses) {
      const hypId = registerHypothesisNode(hyp);
      if (!hypId) continue;

      // 'supports' edges: evidence -> hypothesis
      if (Array.isArray(hyp.supportingEvidenceIds)) {
        for (const evId of hyp.supportingEvidenceIds) {
          if (!evId || typeof evId !== 'string') continue;
          const cleanEvId = evId.trim();
          if (!cleanEvId) continue;
          registerEvidenceNode(cleanEvId);

          const edgeKey = `supports:${cleanEvId}->${hypId}`;
          if (!seenEdges.has(edgeKey)) {
            seenEdges.add(edgeKey);
            edges.push({
              from: cleanEvId,
              to: hypId,
              kind: 'supports',
            });
          }
        }
      }

      // 'conflicts' edges: evidence -> hypothesis
      if (Array.isArray(hyp.conflictingEvidenceIds)) {
        for (const evId of hyp.conflictingEvidenceIds) {
          if (!evId || typeof evId !== 'string') continue;
          const cleanEvId = evId.trim();
          if (!cleanEvId) continue;
          registerEvidenceNode(cleanEvId);

          const edgeKey = `conflicts:${cleanEvId}->${hypId}`;
          if (!seenEdges.has(edgeKey)) {
            seenEdges.add(edgeKey);
            edges.push({
              from: cleanEvId,
              to: hypId,
              kind: 'conflicts',
            });
          }
        }
      }
    }
  }

  // 2. Process Evidence Connections: register 'connection' edges between paired evidence IDs
  if (Array.isArray(report.evidenceConnections)) {
    for (const conn of report.evidenceConnections) {
      if (!conn || !Array.isArray(conn.evidenceIds)) continue;
      const ids = conn.evidenceIds
        .filter((id) => id && typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean);

      for (let i = 0; i < ids.length; i++) {
        registerEvidenceNode(ids[i]);
        for (let j = i + 1; j < ids.length; j++) {
          registerEvidenceNode(ids[j]);
          const a = ids[i];
          const b = ids[j];
          if (a === b) continue;

          // Undirected pair deduplication
          const pairKey = [a, b].sort().join('<->');
          const edgeKey = `connection:${pairKey}`;
          if (!seenEdges.has(edgeKey)) {
            seenEdges.add(edgeKey);
            edges.push({
              from: a,
              to: b,
              kind: 'connection',
            });
          }
        }
      }
    }
  }

  // 3. Process Contradictions: register 'contradiction' edges between opposing evidence items
  if (Array.isArray(report.contradictions)) {
    for (const c of report.contradictions) {
      if (!c || typeof c !== 'object') continue;

      // Standard format: claimA.evidenceIds vs claimB.evidenceIds
      const idsA = (c.claimA && Array.isArray(c.claimA.evidenceIds) ? c.claimA.evidenceIds : [])
        .filter((id) => id && typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean);

      const idsB = (c.claimB && Array.isArray(c.claimB.evidenceIds) ? c.claimB.evidenceIds : [])
        .filter((id) => id && typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean);

      if (idsA.length > 0 && idsB.length > 0) {
        for (const a of idsA) {
          registerEvidenceNode(a);
          for (const b of idsB) {
            registerEvidenceNode(b);
            if (a === b) continue;

            const pairKey = [a, b].sort().join('<->');
            const edgeKey = `contradiction:${pairKey}`;
            if (!seenEdges.has(edgeKey)) {
              seenEdges.add(edgeKey);
              edges.push({
                from: a,
                to: b,
                kind: 'contradiction',
              });
            }
          }
        }
      } else if (Array.isArray(c.evidenceIds)) {
        // Fallback for flat evidenceIds array
        const ids = c.evidenceIds
          .filter((id) => id && typeof id === 'string')
          .map((id) => id.trim())
          .filter(Boolean);

        for (let i = 0; i < ids.length; i++) {
          registerEvidenceNode(ids[i]);
          for (let j = i + 1; j < ids.length; j++) {
            registerEvidenceNode(ids[j]);
            const a = ids[i];
            const b = ids[j];
            if (a === b) continue;

            const pairKey = [a, b].sort().join('<->');
            const edgeKey = `contradiction:${pairKey}`;
            if (!seenEdges.has(edgeKey)) {
              seenEdges.add(edgeKey);
              edges.push({
                from: a,
                to: b,
                kind: 'contradiction',
              });
            }
          }
        }
      }
    }
  }

  // 4. Ingest evidence IDs from remaining report sections
  const scanSectionForEvidence = (items, key) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const ids = Array.isArray(item[key]) ? item[key] : [];
      for (const id of ids) {
        registerEvidenceNode(id);
      }
    }
  };

  scanSectionForEvidence(report.knownFacts, 'evidenceIds');
  scanSectionForEvidence(report.unverifiedClaims, 'evidenceIds');
  scanSectionForEvidence(report.openQuestions, 'relatedEvidenceIds');
  scanSectionForEvidence(report.memoryUpdates, 'evidenceIds');

  return {
    nodes: Array.from(nodesMap.values()),
    edges,
  };
}

module.exports = {
  buildGraph,
};
