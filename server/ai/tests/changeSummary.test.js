const assert = require('assert');
const { buildChangeSummary, diffReports } = require('../changeSummary');
const { processEvidence } = require('../index');

async function runTests() {
  console.log('--- Testing changeSummary.js (pure functions & processEvidence integration) ---');

  // Handcrafted Report 1 (Initial Report)
  const report1 = {
    knownFacts: [
      {
        statement: 'Keycard registered to technician #1042 was swiped at the vault at 23:14.',
        evidenceIds: ['EV-01'],
        basis: 'Electronic access control logs',
      },
    ],
    unverifiedClaims: [],
    evidenceConnections: [
      {
        description: 'Keycard access recorded at server room vault entrance.',
        evidenceIds: ['EV-01'],
        status: 'supported',
        why: 'Direct physical sensor trigger',
      },
    ],
    contradictions: [],
    hypotheses: [
      {
        hypothesisId: 'HYP-01',
        description: 'Technician #1042 entered the server vault at 23:14.',
        supportingEvidenceIds: ['EV-01'],
        conflictingEvidenceIds: [],
        status: 'under_consideration',
      },
      {
        hypothesisId: 'HYP-02',
        description: 'An unauthorized individual used keycard #1042.',
        supportingEvidenceIds: [],
        conflictingEvidenceIds: [],
        status: 'under_consideration',
      },
    ],
    openQuestions: [
      {
        question: 'Was technician #1042 on duty at the time of the swipe?',
        relatedEvidenceIds: ['EV-01'],
      },
    ],
    suggestedNextChecks: [
      {
        check: 'Review HR attendance records for technician #1042',
        purpose: 'Verify physical presence',
        relatedHypothesisIds: ['HYP-01'],
      },
    ],
    memoryUpdates: [],
  };

  // Handcrafted Report 2 (Subsequent Report after EV-02 is ingested)
  // HYP-01: under_consideration -> weakened
  // 1 Contradiction is added
  const report2 = {
    knownFacts: [
      {
        statement: 'Keycard registered to technician #1042 was swiped at the vault at 23:14.',
        evidenceIds: ['EV-01'],
        basis: 'Electronic access control logs',
      },
      {
        statement: 'Human Resources records show technician #1042 was on approved leave off-site.',
        evidenceIds: ['EV-02'],
        basis: 'Official HR attendance roster',
      },
    ],
    unverifiedClaims: [],
    evidenceConnections: [
      {
        description: 'Keycard access recorded at server room vault entrance.',
        evidenceIds: ['EV-01'],
        status: 'supported',
        why: 'Direct physical sensor trigger',
      },
      {
        description: 'Swipe record directly conflicts with technician leave schedule.',
        evidenceIds: ['EV-01', 'EV-02'],
        status: 'supported',
        why: 'Simultaneous badge usage and off-site documentation',
      },
    ],
    contradictions: [
      {
        claimA: {
          text: 'Keycard swipe indicates presence of badge #1042 at vault.',
          evidenceIds: ['EV-01'],
        },
        claimB: {
          text: 'Official records confirm employee #1042 was in another city on approved leave.',
          evidenceIds: ['EV-02'],
        },
        explanation: 'The badge was used while the assigned holder was officially off-site.',
        unresolved: true,
      },
    ],
    hypotheses: [
      {
        hypothesisId: 'HYP-01',
        description: 'Technician #1042 entered the server vault at 23:14.',
        supportingEvidenceIds: ['EV-01'],
        conflictingEvidenceIds: ['EV-02'],
        status: 'weakened', // Transitioned: under_consideration -> weakened!
      },
      {
        hypothesisId: 'HYP-02',
        description: 'An unauthorized individual used keycard #1042.',
        supportingEvidenceIds: ['EV-01', 'EV-02'],
        conflictingEvidenceIds: [],
        status: 'strengthened',
      },
    ],
    openQuestions: [],
    suggestedNextChecks: [
      {
        check: 'Inspect CCTV camera 4 for physical appearance of the badge user',
        purpose: 'Identify unauthorized individual',
        relatedHypothesisIds: ['HYP-02'],
      },
    ],
    memoryUpdates: [
      {
        action: 'mark_disputed',
        memoryId: 'MEM-01',
        summary: 'Presence of technician #1042 disputed by official HR leave record',
        reason: 'HR documentation demonstrates absence during incident',
        evidenceIds: ['EV-01', 'EV-02'],
      },
    ],
  };

  // Test 1: diffReports accurately isolates additions, removals, and changes
  console.log('Test 1: diffReports detects hypothesis status change and added contradiction');
  {
    const diff = diffReports(report1, report2);

    // Verify hypotheses diff
    assert.strictEqual(diff.hypotheses.changed.length, 2);
    const hyp1Diff = diff.hypotheses.changed.find((c) => c.id === 'HYP-01');
    assert.ok(hyp1Diff, 'HYP-01 must be in changed list');
    assert.strictEqual(hyp1Diff.fromStatus, 'under_consideration');
    assert.strictEqual(hyp1Diff.toStatus, 'weakened');
    assert.strictEqual(hyp1Diff.statusChanged, true);

    const hyp2Diff = diff.hypotheses.changed.find((c) => c.id === 'HYP-02');
    assert.ok(hyp2Diff);
    assert.strictEqual(hyp2Diff.fromStatus, 'under_consideration');
    assert.strictEqual(hyp2Diff.toStatus, 'strengthened');

    // Verify contradictions diff
    assert.strictEqual(diff.contradictions.added.length, 1);
    assert.strictEqual(diff.contradictions.removed.length, 0);
    assert.ok(diff.contradictions.added[0].explanation.includes('off-site'));

    // Verify connections diff
    assert.strictEqual(diff.evidenceConnections.added.length, 1);
    assert.strictEqual(diff.evidenceConnections.unchanged.length, 1);

    // Verify facts diff
    assert.strictEqual(diff.knownFacts.added.length, 1);
    assert.strictEqual(diff.knownFacts.unchanged.length, 1);

    console.log('  Passed: diffReports accurately matched hypotheses and detected changes.');
  }

  // Test 2: buildChangeSummary returns structured summary derived strictly from data
  console.log('Test 2: buildChangeSummary generates full summary structure');
  {
    const acceptedProposals = [
      {
        action: 'mark_disputed',
        type: 'contradiction',
        summary: 'Badge swipe vs HR leave schedule',
        evidenceIds: ['EV-01', 'EV-02'],
        targetMemoryId: 'MEM-01',
        reason: 'Direct contradictory records',
      },
    ];

    const summary = buildChangeSummary({
      newEvidenceId: 'EV-02',
      retrievedEvidenceIds: ['EV-01'],
      retrievedMemoryIds: ['MEM-01'],
      previousReport: report1,
      newReport: report2,
      acceptedProposals,
      reportVersion: 2,
    });

    // Check all required fields
    assert.strictEqual(summary.added, 'EV-02');
    assert.deepStrictEqual(summary.retrieved.evidenceIds, ['EV-01']);
    assert.deepStrictEqual(summary.retrieved.memoryIds, ['MEM-01']);
    assert.strictEqual(summary.reportVersion, 2);

    // Verify changedHypotheses shape [{ id, from, to }]
    assert.ok(Array.isArray(summary.changedHypotheses));
    const hyp1Change = summary.changedHypotheses.find((h) => h.id === 'HYP-01');
    assert.ok(hyp1Change, 'Changed hypotheses must contain HYP-01');
    assert.strictEqual(hyp1Change.id, 'HYP-01');
    assert.strictEqual(hyp1Change.from, 'under_consideration');
    assert.strictEqual(hyp1Change.to, 'weakened');

    // Verify newContradictions
    assert.strictEqual(summary.newContradictions.length, 1);
    assert.ok(summary.newContradictions[0].claimA);

    // Verify newConnections
    assert.strictEqual(summary.newConnections.length, 1);

    // Verify memoryActions
    assert.strictEqual(summary.memoryActions.length, 1);
    assert.strictEqual(summary.memoryActions[0].action, 'mark_disputed');

    // Verify preserved
    assert.ok(summary.preserved);
    assert.strictEqual(summary.preserved.facts.length, 1);

    console.log('  Passed: buildChangeSummary produced required shape:');
    console.log('    • changedHypotheses:', JSON.stringify(summary.changedHypotheses));
    console.log('    • newContradictions count:', summary.newContradictions.length);
    console.log('    • newConnections count:', summary.newConnections.length);
  }

  // Test 3: processEvidence integration with buildChangeSummary
  console.log('Test 3: processEvidence produces populated changeSummary in result');
  {
    const mockEvidence = {
      _id: 'ev-2',
      evidenceCode: 'EV-02',
      title: 'HR Roster',
      content: 'Technician #1042 was on annual leave during the week.',
      verificationStatus: 'verified',
    };

    const mockDeps = {
      getEvidence: async () => mockEvidence,
      setAnalysisStatus: async () => {},
      getContext: async () => ({
        recentEvidence: [
          {
            _id: 'ev-1',
            evidenceCode: 'EV-01',
            title: 'Badge Log',
            content: 'Swipe recorded at 23:14',
            verificationStatus: 'verified',
          },
        ],
        memories: [{ _id: 'MEM-01', type: 'claim', summary: '1042 was at site' }],
        previousReport: { ...report1, version: 1 },
      }),
      llmCall: async () => ({
        report: report2,
        memoryProposals: [
          {
            action: 'mark_disputed',
            type: 'contradiction',
            summary: 'Badge swipe vs HR leave schedule',
            evidenceIds: ['EV-01', 'EV-02'],
            targetMemoryId: 'MEM-01',
            confidenceLabel: 'high',
            reason: 'Direct contradictory records',
          },
        ],
      }),
    };

    const result = await processEvidence(mockDeps, { caseId: 'case-test', evidenceId: 'ev-2' });

    assert.strictEqual(result.status, 'ok');
    assert.ok(result.changeSummary, 'result.changeSummary must not be null');
    assert.strictEqual(result.changeSummary.added, 'EV-02');
    assert.strictEqual(result.changeSummary.reportVersion, 2);
    assert.strictEqual(result.changeSummary.newContradictions.length, 1);

    const hyp1Change = result.changeSummary.changedHypotheses.find((h) => h.id === 'HYP-01');
    assert.ok(hyp1Change);
    assert.strictEqual(hyp1Change.from, 'under_consideration');
    assert.strictEqual(hyp1Change.to, 'weakened');

    console.log('  Passed: processEvidence cleanly returned populated changeSummary.');
  }

  console.log('--- All changeSummary tests PASSED! ---');
}

runTests().catch((err) => {
  console.error('Change Summary Test Suite Failed:', err);
  process.exitCode = 1;
});
