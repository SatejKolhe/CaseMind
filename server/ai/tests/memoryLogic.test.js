const assert = require('node:assert');
const { normalizeProposals } = require('../memoryLogic');

console.log('[Test Suite] Starting memoryLogic.test.js verification...\n');

// Sample existing memories
const existingMemories = [
  {
    id: 'MEM-01',
    type: 'contradiction',
    summary: 'Timeline discrepancy between sensor at 21:42 and witness at 21:55.',
    evidenceIds: ['EV-01', 'EV-02'],
    status: 'active',
  },
  {
    id: 'MEM-02',
    type: 'hypothesis',
    summary: 'Theft occurred at 21:42.',
    evidenceIds: ['EV-01'],
    status: 'superseded', // Already superseded!
  },
  {
    id: 'MEM-03',
    type: 'open_question',
    summary: 'Did any secondary console record activity?',
    evidenceIds: ['EV-01'],
    status: 'deleted', // Deleted!
  },
  {
    id: 'MEM-04',
    type: 'hypothesis',
    summary: 'Sensor telemetry dropped due to electrical transient.',
    evidenceIds: ['EV-01', 'EV-03'],
    status: 'active', // Active and valid target for supersede/resolve
  },
];

// ---------------------------------------------------------------------------
// Test 1: Duplicate proposals dropped (same type and evidenceIds as active memory)
// ---------------------------------------------------------------------------
console.log('[Test 1] Testing duplicate proposal dropped against active memory...');
const duplicateProposal = {
  action: 'add',
  type: 'contradiction',
  summary: 'Discrepancy between sensor and docent statement.',
  evidenceIds: ['EV-02', 'EV-01'], // Reversed order of MEM-01 ['EV-01', 'EV-02']
  confidenceLabel: 'medium',
  reason: 'Ingestion of witness interview.',
};

const result1 = normalizeProposals([duplicateProposal], existingMemories);
assert.strictEqual(result1.accepted.length, 0, 'Duplicate proposal must not be accepted');
assert.strictEqual(result1.rejected.length, 1, 'Duplicate proposal must be rejected');
assert.ok(
  result1.rejected[0].reason.includes('Duplicate proposal'),
  'Rejection reason must indicate duplicate active memory'
);
console.log('  ✓ Duplicate proposal successfully dropped with reason:', result1.rejected[0].reason);

// ---------------------------------------------------------------------------
// Test 2: Proposal targeting a superseded memory rejected
// ---------------------------------------------------------------------------
console.log('\n[Test 2] Testing proposal targeting superseded memory rejected...');
const targetSupersededProposal = {
  action: 'supersede',
  type: 'hypothesis',
  summary: 'Refined theory replacing old hypothesis.',
  evidenceIds: ['EV-01', 'EV-03'],
  targetMemoryId: 'MEM-02', // MEM-02 is already superseded
  confidenceLabel: 'high',
  reason: 'Updating an already superseded working theory.',
};

const result2 = normalizeProposals([targetSupersededProposal], existingMemories);
assert.strictEqual(result2.accepted.length, 0, 'Proposal targeting superseded memory must not be accepted');
assert.strictEqual(result2.rejected.length, 1, 'Proposal targeting superseded memory must be rejected');
assert.ok(
  result2.rejected[0].reason.includes('already superseded'),
  'Rejection reason must note target is already superseded'
);
console.log('  ✓ Targeting superseded memory rejected with reason:', result2.rejected[0].reason);

// ---------------------------------------------------------------------------
// Test 3: Proposal targeting a deleted memory rejected
// ---------------------------------------------------------------------------
console.log('\n[Test 3] Testing proposal targeting deleted memory rejected...');
const targetDeletedProposal = {
  action: 'resolve',
  type: 'open_question',
  summary: 'Resolved question with new log.',
  evidenceIds: ['EV-01', 'EV-03'],
  targetMemoryId: 'MEM-03', // MEM-03 is deleted
  confidenceLabel: 'high',
  reason: 'Answering a deleted question.',
};

const result3 = normalizeProposals([targetDeletedProposal], existingMemories);
assert.strictEqual(result3.accepted.length, 0, 'Proposal targeting deleted memory must not be accepted');
assert.strictEqual(result3.rejected.length, 1, 'Proposal targeting deleted memory must be rejected');
assert.ok(
  result3.rejected[0].reason.includes('deleted'),
  'Rejection reason must note target is deleted'
);
console.log('  ✓ Targeting deleted memory rejected with reason:', result3.rejected[0].reason);

// ---------------------------------------------------------------------------
// Test 4: Valid supersede accepted
// ---------------------------------------------------------------------------
console.log('\n[Test 4] Testing valid supersede proposal accepted...');
const validSupersedeProposal = {
  action: 'supersede',
  type: 'hypothesis',
  summary: 'Sensor telemetry drop confirmed as electrical surge artifact; physical removal occurred post-21:55.',
  evidenceIds: ['EV-01', 'EV-03', 'EV-04'],
  targetMemoryId: 'MEM-04', // MEM-04 is active!
  confidenceLabel: 'high',
  reason: 'New breaker diagnostic EV-04 clarifies the electrical anomaly.',
};

const result4 = normalizeProposals([validSupersedeProposal], existingMemories);
assert.strictEqual(result4.accepted.length, 1, 'Valid supersede must be accepted');
assert.strictEqual(result4.rejected.length, 0, 'Valid supersede must have 0 rejections');
assert.strictEqual(result4.accepted[0].targetMemoryId, 'MEM-04');
console.log('  ✓ Valid supersede proposal accepted targeting active MEM-04');

// ---------------------------------------------------------------------------
// Test 5: Proposal attempting to mutate/delete original evidence rejected
// ---------------------------------------------------------------------------
console.log('\n[Test 5] Testing proposal modifying original evidence rejected...');
const mutateEvidenceProposal = {
  action: 'add',
  type: 'evidence',
  summary: 'Delete original evidence EV-01 because sensor was faulty.',
  evidenceIds: ['EV-01'],
  confidenceLabel: 'low',
  reason: 'Purge false reading.',
};

const result5 = normalizeProposals([mutateEvidenceProposal], existingMemories);
assert.strictEqual(result5.accepted.length, 0, 'Evidence mutation must not be accepted');
assert.strictEqual(result5.rejected.length, 1, 'Evidence mutation must be rejected');
assert.ok(
  result5.rejected[0].reason.includes('immutable original evidence'),
  'Rejection reason must note evidence immutability'
);
console.log('  ✓ Evidence mutation proposal rejected with reason:', result5.rejected[0].reason);

// ---------------------------------------------------------------------------
// Test 6: Duplicate proposals within same batch dropped
// ---------------------------------------------------------------------------
console.log('\n[Test 6] Testing batch deduplication (same proposal duplicated twice in batch)...');
const newProposalA = {
  action: 'add',
  type: 'inference',
  summary: 'First observation of auxiliary power switch.',
  evidenceIds: ['EV-03'],
  confidenceLabel: 'medium',
  reason: 'Initial log review.',
};
const newProposalB = {
  action: 'add',
  type: 'inference',
  summary: 'Duplicate observation of auxiliary power switch.',
  evidenceIds: ['EV-03'], // Same type and evidence!
  confidenceLabel: 'medium',
  reason: 'Second log review.',
};

const result6 = normalizeProposals([newProposalA, newProposalB], existingMemories);
assert.strictEqual(result6.accepted.length, 1, 'Only first occurrence in batch should be accepted');
assert.strictEqual(result6.rejected.length, 1, 'Duplicate occurrence in batch should be rejected');
console.log('  ✓ Batch duplicate successfully rejected with reason:', result6.rejected[0].reason);

console.log('\n🎉 All memoryLogic.test.js tests passed successfully (6/6 cases)!');
