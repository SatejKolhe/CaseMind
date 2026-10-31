/**
 * CaseMind Working Memory Logic & Proposal Normalization
 *
 * Implements epistemological memory lifecycle checks:
 * - Drops duplicate memory proposals (same type and evidenceIds as an active memory).
 * - Rejects proposals targeting superseded or deleted memories.
 * - Rejects any proposal that attempts to modify or delete immutable original evidence records.
 * - Accepts valid adds, disputes, supersedes, and resolves.
 */

const EVIDENCE_MUTATION_PATTERNS = [
  /\b(?:delete|remove|erase|modify|edit|alter)\s+(?:original\s+)?evidence\b/i,
  /\b(?:delete|remove|erase)\s+EV-\d+\b/i,
  /\bpurge\s+evidence\b/i,
];

/**
 * Creates a normalized comparison signature from a memory type and its cited evidence IDs.
 */
function createMemorySignature(type, evidenceIds) {
  const normType = String(type || '').toLowerCase().trim();
  const normIds = Array.isArray(evidenceIds)
    ? [...evidenceIds].map((id) => String(id).trim()).sort().join(',')
    : '';
  return `${normType}::${normIds}`;
}

/**
 * Normalizes and filters proposed memory updates against existing active/historical case memories.
 *
 * @param {Array<object>} proposals Array of proposed memory updates from the model
 * @param {Array<object>} [existingMemories=[]] Current memories stored for the case
 * @returns {{ accepted: Array<object>, rejected: Array<{ proposal: object, reason: string }> }}
 */
function normalizeProposals(proposals, existingMemories = []) {
  const accepted = [];
  const rejected = [];

  if (!Array.isArray(proposals)) {
    return { accepted, rejected };
  }

  // Index existing memories by ID and collect active memory signatures
  const memoryById = new Map();
  const activeSignatures = new Set();

  if (Array.isArray(existingMemories)) {
    for (const mem of existingMemories) {
      if (!mem || typeof mem !== 'object') continue;

      const id = mem.id || mem._id || mem.memoryId;
      const status = String(mem.status || 'active').toLowerCase().trim();
      const type = mem.type || mem.category || '';
      const evidenceIds = Array.isArray(mem.evidenceIds)
        ? mem.evidenceIds
        : (Array.isArray(mem.supportingEvidenceCodes) ? mem.supportingEvidenceCodes : []);

      if (id) {
        memoryById.set(String(id), { ...mem, id: String(id), status, type, evidenceIds });
      }

      if (status === 'active') {
        const sig = createMemorySignature(type, evidenceIds);
        activeSignatures.add(sig);
      }
    }
  }

  // Track signatures accepted within this batch to prevent duplicates inside the same proposal set
  const seenInBatch = new Set();

  for (const proposal of proposals) {
    if (!proposal || typeof proposal !== 'object') {
      rejected.push({
        proposal,
        reason: 'Proposal must be a non-null object.',
      });
      continue;
    }

    const { action, type, summary, evidenceIds, targetMemoryId, reason } = proposal;

    // 1. Check: Reject anything that proposes modifying or deleting original evidence
    const combinedText = `${summary || ''} ${reason || ''} ${type || ''}`;
    const attemptsMutation =
      ['evidence', 'evidence_record', 'evidence_mutation'].includes(String(type || '').toLowerCase()) ||
      EVIDENCE_MUTATION_PATTERNS.some((pattern) => pattern.test(combinedText));

    if (attemptsMutation) {
      rejected.push({
        proposal,
        reason: 'Proposal attempts to modify or delete immutable original evidence.',
      });
      continue;
    }

    // 2. Check: Target memory validation (for supersede, mark_disputed, resolve)
    if (targetMemoryId) {
      const targetStr = String(targetMemoryId).trim();
      const targetMemory = memoryById.get(targetStr);

      if (!targetMemory) {
        rejected.push({
          proposal,
          reason: `Target memory "${targetStr}" does not exist in existing memories.`,
        });
        continue;
      }

      if (targetMemory.status === 'superseded') {
        rejected.push({
          proposal,
          reason: `Cannot target memory "${targetStr}" because it is already superseded.`,
        });
        continue;
      }

      if (targetMemory.status === 'deleted') {
        rejected.push({
          proposal,
          reason: `Cannot target memory "${targetStr}" because it is deleted.`,
        });
        continue;
      }

      if (action === 'resolve' && targetMemory.status === 'resolved') {
        rejected.push({
          proposal,
          reason: `Cannot resolve memory "${targetStr}" because it is already resolved.`,
        });
        continue;
      }
    }

    // 3. Check: Drop duplicate proposals (same type and same evidenceIds as an active memory)
    const sig = createMemorySignature(type, evidenceIds);

    // If proposing a new memory (action "add" or no target), check for active duplicates
    if (action === 'add' || !targetMemoryId) {
      if (activeSignatures.has(sig)) {
        rejected.push({
          proposal,
          reason: `Duplicate proposal: an active memory with type "${type}" and evidence [${(evidenceIds || []).join(', ')}] already exists.`,
        });
        continue;
      }

      if (seenInBatch.has(sig)) {
        rejected.push({
          proposal,
          reason: `Duplicate proposal: an identical proposal with type "${type}" and evidence [${(evidenceIds || []).join(', ')}] was already accepted in this batch.`,
        });
        continue;
      }
    }

    // All normalization checks passed!
    seenInBatch.add(sig);
    accepted.push(proposal);
  }

  return {
    accepted,
    rejected,
  };
}

module.exports = {
  normalizeProposals,
  createMemorySignature,
};
