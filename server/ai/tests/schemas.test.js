const assert = require('node:assert');
const {
  ModelOutputSchema,
  ReportSchema,
  MemoryProposalSchema,
  IntakeCandidateSchema,
} = require('../schemas');

console.log('[Test Suite] Starting schemas.test.js verification...\n');

// ---------------------------------------------------------------------------
// Helper generator for a valid ModelOutput
// ---------------------------------------------------------------------------
function getValidModelOutput() {
  return {
    report: {
      knownFacts: [
        {
          statement: 'Sensor registered sudden 15.2kg drop to zero at 21:42:10.',
          evidenceIds: ['EV-01'],
          basis: 'Direct telemetry log recording from pedestal sensor.',
        },
      ],
      unverifiedClaims: [
        {
          statement: 'Catering server states statue remained on pedestal at 21:55.',
          evidenceIds: ['EV-02'],
          verificationStatus: 'unverified',
        },
      ],
      evidenceConnections: [
        {
          description: 'Temporal discrepancy between digital sensor drop at 21:42 and witness observation at 21:55.',
          evidenceIds: ['EV-01', 'EV-02'],
          status: 'possible',
          why: 'Power surge logged at 21:42 coincides with sensor event.',
        },
      ],
      contradictions: [
        {
          claimA: {
            text: 'Telemetry shows pedestal weight went to zero at 21:42:10.',
            evidenceIds: ['EV-01'],
          },
          claimB: {
            text: 'Witness observes statue in place at 21:55.',
            evidenceIds: ['EV-02'],
          },
          explanation: 'Digital sensor and human witness provide conflicting accounts of pedestal occupancy.',
          unresolved: true,
        },
      ],
      hypotheses: [
        {
          hypothesisId: 'H-1',
          description: 'Electrical surge induced telemetry glitch; removal occurred after 21:55.',
          supportingEvidenceIds: ['EV-01', 'EV-03'],
          conflictingEvidenceIds: [],
          status: 'under_consideration',
        },
      ],
      openQuestions: [
        {
          question: 'Did any secondary cameras record the room between 21:42 and 21:55?',
          relatedEvidenceIds: ['EV-01'],
        },
      ],
      suggestedNextChecks: [
        {
          check: 'Examine server room electrical circuit diagnostic logs.',
          purpose: 'Verify whether pedestal sensor power circuit was disrupted at 21:42.',
          relatedHypothesisIds: ['H-1'],
        },
      ],
      memoryUpdates: [
        {
          action: 'add',
          summary: 'Sensor telemetry conflict with witness statement.',
          reason: 'Initial intake of EV-01 and EV-02 reveals timeline contradiction.',
          evidenceIds: ['EV-01', 'EV-02'],
        },
      ],
    },
    memoryProposals: [
      {
        action: 'add',
        type: 'contradiction',
        summary: 'Sensor drop at 21:42 vs witness observation at 21:55.',
        evidenceIds: ['EV-01', 'EV-02'],
        confidenceLabel: 'medium',
        reason: 'Direct timestamp conflict between sensor log and witness statement.',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Test 1: Valid ModelOutput & IntakeCandidate
// ---------------------------------------------------------------------------
console.log('[Test 1] Parsing completely valid ModelOutput & IntakeCandidate...');
const validOutput = getValidModelOutput();
const parsedOutput = ModelOutputSchema.safeParse(validOutput);
assert.strictEqual(parsedOutput.success, true, 'Valid ModelOutput must pass parsing');
console.log('  ✓ ModelOutput parsed successfully');

const validIntake = {
  type: 'witness',
  description: 'Interview transcript with gala guest.',
  sourceLabel: 'Detective Interview Notes #4',
  eventTime: '2026-10-30T21:45:00.000Z',
  eventTimeText: 'around quarter to ten',
  verificationStatus: 'unverified',
  originalText: 'Guest saw individual near the pedestal around quarter to ten.',
  englishGloss: null,
};
const parsedIntake = IntakeCandidateSchema.safeParse(validIntake);
assert.strictEqual(parsedIntake.success, true, 'Valid IntakeCandidate must pass parsing');
console.log('  ✓ IntakeCandidate parsed successfully\n');

// ---------------------------------------------------------------------------
// Test 2 (Invalid 1): Missing required section in Report
// ---------------------------------------------------------------------------
console.log('[Test 2] Rejecting Report with missing section (contradictions omitted)...');
const invalid1 = getValidModelOutput();
delete invalid1.report.contradictions;
const parsed1 = ModelOutputSchema.safeParse(invalid1);
assert.strictEqual(parsed1.success, false, 'Report must fail when contradictions section is missing');
const hasSectionError = parsed1.error.issues.some(
  (issue) => issue.path.includes('contradictions') && issue.code === 'invalid_type'
);
assert.ok(hasSectionError, 'Must flag missing contradictions section');
console.log('  ✓ Rejected: missing section caught\n');

// ---------------------------------------------------------------------------
// Test 3 (Invalid 2): Bad Enum value in connection status and hypothesis status
// ---------------------------------------------------------------------------
console.log('[Test 3] Rejecting invalid enum values in status fields...');
const invalid2 = getValidModelOutput();
invalid2.report.evidenceConnections[0].status = 'proven_conclusive'; // illegal enum
const parsed2 = ModelOutputSchema.safeParse(invalid2);
assert.strictEqual(parsed2.success, false, 'Must reject illegal connection status enum');
const hasEnumError = parsed2.error.issues.some(
  (issue) => issue.path.includes('status') && (issue.code === 'invalid_value' || issue.code === 'invalid_enum_value')
);
assert.ok(hasEnumError, 'Must flag invalid enum value');
console.log('  ✓ Rejected: bad enum "proven_conclusive" caught\n');

// ---------------------------------------------------------------------------
// Test 4 (Invalid 3): Empty evidenceIds array on claim-bearing item
// ---------------------------------------------------------------------------
console.log('[Test 4] Rejecting empty evidenceIds on claim-bearing item...');
const invalid3 = getValidModelOutput();
invalid3.report.knownFacts[0].evidenceIds = []; // Empty evidenceIds forbidden on facts!
const parsed3 = ModelOutputSchema.safeParse(invalid3);
assert.strictEqual(parsed3.success, false, 'Must reject empty evidenceIds on knownFacts');
const hasEmptyEvidenceError = parsed3.error.issues.some(
  (issue) => issue.path.includes('evidenceIds')
);
assert.ok(hasEmptyEvidenceError, 'Must flag empty evidenceIds');
console.log('  ✓ Rejected: empty evidenceIds on knownFact caught\n');

// ---------------------------------------------------------------------------
// Test 5 (Invalid 4): Forbidden fields (guilty, culprit, suspectIdentified)
// ---------------------------------------------------------------------------
console.log('[Test 5] Rejecting ethical guardrail forbidden fields...');

// 5a. Forbidden field 'guilty'
const invalid4a = getValidModelOutput();
invalid4a.report.hypotheses[0].guilty = true;
const parsed4a = ModelOutputSchema.safeParse(invalid4a);
assert.strictEqual(parsed4a.success, false, 'Must reject forbidden field "guilty"');
const hasGuiltyError = parsed4a.error.issues.some((i) => i.message.includes('guilty'));
assert.ok(hasGuiltyError, 'Must produce specific ethical guardrail error for "guilty"');
console.log('  ✓ Rejected: forbidden field "guilty" caught');

// 5b. Forbidden field 'culprit'
const invalid4b = getValidModelOutput();
invalid4b.memoryProposals[0].culprit = 'Gala Bartender';
const parsed4b = ModelOutputSchema.safeParse(invalid4b);
assert.strictEqual(parsed4b.success, false, 'Must reject forbidden field "culprit"');
const hasCulpritError = parsed4b.error.issues.some((i) => i.message.includes('culprit'));
assert.ok(hasCulpritError, 'Must produce specific ethical guardrail error for "culprit"');
console.log('  ✓ Rejected: forbidden field "culprit" caught');

// 5c. Forbidden field 'suspectIdentified'
const invalid4c = getValidModelOutput();
invalid4c.report.suspectIdentified = 'Person X';
const parsed4c = ModelOutputSchema.safeParse(invalid4c);
assert.strictEqual(parsed4c.success, false, 'Must reject forbidden field "suspectIdentified"');
const hasSuspectError = parsed4c.error.issues.some((i) => i.message.includes('suspectIdentified') || i.message.includes('unrecognized_keys'));
assert.ok(hasSuspectError, 'Must produce error for "suspectIdentified"');
console.log('  ✓ Rejected: forbidden field "suspectIdentified" caught\n');

// ---------------------------------------------------------------------------
// Test 6 (Invalid 5): Wrong type (boolean passed as string, string passed as number)
// ---------------------------------------------------------------------------
console.log('[Test 6] Rejecting wrong type (string passed for boolean unresolved)...');
const invalid5 = getValidModelOutput();
invalid5.report.contradictions[0].unresolved = 'true'; // string instead of boolean
const parsed5 = ModelOutputSchema.safeParse(invalid5);
assert.strictEqual(parsed5.success, false, 'Must reject string for boolean field');
const hasTypeError = parsed5.error.issues.some(
  (issue) => issue.path.includes('unresolved') && issue.code === 'invalid_type'
);
assert.ok(hasTypeError, 'Must flag invalid type on unresolved');
console.log('  ✓ Rejected: wrong type (string instead of boolean) caught\n');

// ---------------------------------------------------------------------------
// Test 7 (Invalid 6): IntakeCandidate verificationStatus not 'unverified'
// ---------------------------------------------------------------------------
console.log('[Test 7] Rejecting IntakeCandidate when verificationStatus is not "unverified"...');
const invalid6 = { ...validIntake, verificationStatus: 'verified' };
const parsed6 = IntakeCandidateSchema.safeParse(invalid6);
assert.strictEqual(parsed6.success, false, 'Intake verificationStatus must strictly be "unverified"');
const hasLiteralError = parsed6.error.issues.some(
  (issue) => issue.path.includes('verificationStatus') && (issue.code === 'invalid_value' || issue.code === 'invalid_literal')
);
assert.ok(hasLiteralError, 'Must flag non-unverified status on intake');
console.log('  ✓ Rejected: intake verificationStatus must strictly be "unverified"\n');

console.log('🎉 All schema tests passed successfully (1 valid + 6 invalid cases)!');
