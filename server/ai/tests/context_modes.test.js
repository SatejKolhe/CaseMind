const assert = require('node:assert');
const { selectContext, estimateTokens, createDigest } = require('../contextBudget');
const { buildAnalysisInput, runAnalysisWithMode } = require('../modes');

console.log('[Test Suite] Starting context_modes.test.js verification...\n');

async function runTests() {
  // -------------------------------------------------------------------------
  // Test 1: "off" mode input contains ONLY the new evidence
  // -------------------------------------------------------------------------
  console.log('[Test 1] Testing memoryMode "off" vs "on"...');

  const sampleNewEvidence = {
    id: 'EV-99',
    title: 'Isolated Ingested Clue',
    content: 'Telemetry log indicating abnormal vibration.',
  };

  const richContext = {
    relatedEvidence: [
      { id: 'EV-01', title: 'Prior Sensor Reading' },
      { id: 'EV-02', title: 'Prior Interview' },
    ],
    memories: [
      { id: 'MEM-01', type: 'claim', summary: 'Docent statement' },
      { id: 'MEM-02', type: 'fact', summary: 'Telemetry confirmation' },
    ],
    previousReport: {
      version: 1,
      summary: 'Baseline report from previous run',
    },
    digests: [
      { id: 'EV-03', summary: 'EV-03: Older excluded security log snippet...' },
    ],
  };

  // 1a. Test buildAnalysisInput in "off" mode
  const offInput = buildAnalysisInput({
    memoryMode: 'off',
    newEvidence: sampleNewEvidence,
    context: richContext,
  });

  assert.strictEqual(offInput.memoryMode, 'off', 'memoryMode must be "off"');
  assert.deepStrictEqual(offInput.newEvidence, sampleNewEvidence, 'newEvidence must match');
  assert.deepStrictEqual(offInput.relatedEvidence, [], 'relatedEvidence must be empty array in off mode');
  assert.deepStrictEqual(offInput.memories, [], 'memories must be empty array in off mode');
  assert.strictEqual(offInput.previousReport, null, 'previousReport must be null in off mode');
  assert.deepStrictEqual(offInput.digests, [], 'digests must be empty array in off mode');
  console.log('  ✓ buildAnalysisInput("off") strips all prior context');

  // 1b. Assert on the EXACT object passed to analyze() when running with "off" mode
  let capturedAnalyzeParams = null;
  const mockAnalyze = async (params) => {
    capturedAnalyzeParams = params;
    return {
      report: { summary: 'Mock Report in Off Mode' },
      memoryProposals: [],
    };
  };

  const runResult = await runAnalysisWithMode({
    memoryMode: 'off',
    newEvidence: sampleNewEvidence,
    context: richContext,
    analyzeFn: mockAnalyze,
  });

  assert.strictEqual(runResult.memoryMode, 'off');
  assert.deepStrictEqual(
    capturedAnalyzeParams,
    {
      newEvidence: sampleNewEvidence,
      relatedEvidence: [],
      memories: [],
      previousReport: null,
      digests: [],
    },
    'Exact object passed to analyze() must contain ONLY newEvidence'
  );
  console.log('  ✓ Exact object passed to analyzeFn in "off" mode verified');

  // 1c. Test buildAnalysisInput in "on" mode
  const onInput = buildAnalysisInput({
    memoryMode: 'on',
    newEvidence: sampleNewEvidence,
    context: richContext,
  });

  assert.strictEqual(onInput.memoryMode, 'on');
  assert.deepStrictEqual(onInput.relatedEvidence, richContext.relatedEvidence);
  assert.deepStrictEqual(onInput.memories, richContext.memories);
  assert.deepStrictEqual(onInput.previousReport, richContext.previousReport);
  assert.deepStrictEqual(onInput.digests, richContext.digests);
  console.log('  ✓ buildAnalysisInput("on") preserves full context and digests\n');

  // -------------------------------------------------------------------------
  // Test 2: Synthetic 60-evidence case stays within budget, returns digests, and logs exclusions
  // -------------------------------------------------------------------------
  console.log('[Test 2] Testing selectContext with synthetic 60-evidence case...');

  // Generate 60 synthetic evidence items with realistic ~400 character bodies (~100 tokens each)
  const syntheticEvidence = [];
  for (let i = 1; i <= 60; i++) {
    const id = `EV-${String(i).padStart(2, '0')}`;
    syntheticEvidence.push({
      id,
      title: `Synthetic Log / Statement Report #${i}`,
      source: `Automated Sensor / Interview Record Channel ${i}`,
      occurredAt: `2026-10-30T${String(10 + Math.floor(i / 10)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}:00.000Z`,
      content: `Observation ${i}: Detailed investigative description recording specific sensor telemetry, witness observations, timestamps, and environmental readings for event index ${i} at the designated perimeter checkpoint.`,
    });
  }

  const newClue = syntheticEvidence[59]; // EV-60
  const searchHits = [syntheticEvidence[0], syntheticEvidence[1], syntheticEvidence[2]]; // EV-01, EV-02, EV-03 (Priority 2)
  const hypothesisIds = [syntheticEvidence[3].id, syntheticEvidence[4].id]; // EV-04, EV-05 (Priority 3)
  const contradictionIds = [syntheticEvidence[5].id, syntheticEvidence[6].id]; // EV-06, EV-07 (Priority 4)
  const syntheticMemories = [
    { id: 'MEM-01', type: 'fact', summary: 'Active telemetry confirmation' },
    { id: 'MEM-02', type: 'claim', summary: 'Witness statement in file' },
  ];
  const recentClues = syntheticEvidence.slice(7, 59); // 52 remaining clues

  // Budget constrained to 1000 tokens (will hold ~8-10 full items, forcing ~50 items into digests)
  const TOKEN_BUDGET = 1000;

  const contextSelection = selectContext(
    {
      newEvidence: newClue,
      searchHits,
      memories: syntheticMemories,
      hypothesisEvidenceIds: hypothesisIds,
      contradictionEvidenceIds: contradictionIds,
      recentEvidence: recentClues,
    },
    TOKEN_BUDGET
  );

  console.log(`  • Configured Token Budget: ${contextSelection.tokenBudget} tokens`);
  console.log(`  • Estimated Tokens Used  : ${contextSelection.estimatedTokens} tokens`);
  console.log(`  • Included Evidence Items: ${contextSelection.included.relatedEvidence.length}`);
  console.log(`  • Included Memories      : ${contextSelection.included.memories.length}`);
  console.log(`  • Generated Digests      : ${contextSelection.digests.length}`);
  console.log(`  • Logged Exclusions      : ${contextSelection.excluded.length}`);

  // Assertion: Must stay within budget
  assert.ok(
    contextSelection.estimatedTokens <= TOKEN_BUDGET,
    `Estimated tokens (${contextSelection.estimatedTokens}) must not exceed budget (${TOKEN_BUDGET})`
  );

  // Assertion: New evidence must be included
  assert.strictEqual(contextSelection.included.newEvidence.id, 'EV-60', 'New evidence must be included');

  // Assertion: High priority items (vector search hits EV-01, EV-02, EV-03) must be included first
  const includedIds = contextSelection.included.relatedEvidence.map((e) => e.id);
  assert.ok(includedIds.includes('EV-01'), 'EV-01 (search hit) must be prioritized');
  assert.ok(includedIds.includes('EV-02'), 'EV-02 (search hit) must be prioritized');
  assert.ok(includedIds.includes('EV-03'), 'EV-03 (search hit) must be prioritized');

  // Assertion: Items that do not fit must be in digests
  assert.ok(contextSelection.digests.length > 0, 'Must produce digests for excluded items');
  contextSelection.digests.forEach((d) => {
    assert.ok(d.id, 'Digest must specify id');
    assert.ok(d.summary.startsWith(`${d.id}:`), 'Digest summary must start with id:');
    assert.ok(d.summary.length <= 150, 'Digest must be a concise one-line snippet');
  });

  // Assertion: Excluded items must be logged with reasons and priority tiers
  assert.ok(contextSelection.excluded.length > 0, 'Must log exclusions');
  contextSelection.excluded.forEach((ex) => {
    assert.ok(ex.id, 'Exclusion must specify id');
    assert.ok(ex.reason.includes('budget'), 'Exclusion reason must note token budget');
    assert.ok(ex.priorityTier, 'Exclusion must record priorityTier');
  });

  // Print sample digest and exclusion for transparency
  console.log(`\n  Sample Generated Digest: "${contextSelection.digests[0].summary}"`);
  console.log(`  Sample Logged Exclusion: ID=${contextSelection.excluded[0].id}, Tier=${contextSelection.excluded[0].priorityTier}, Reason="${contextSelection.excluded[0].reason}"`);

  console.log('\n  ✓ Synthetic 60-evidence case stayed within budget, returned digests, and logged exclusions cleanly.');

  console.log('\n🎉 All context_modes.test.js tests passed successfully (2/2 test suites)!');
}

runTests().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exitCode = 1;
});
