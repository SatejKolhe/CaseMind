const assert = require('node:assert');
const { validateOutput, analyzeValidated, ValidationError } = require('../validate');

console.log('[Test Suite] Starting validate.test.js verification with mocked LLM...\n');

// ---------------------------------------------------------------------------
// Base Valid Output Generator
// ---------------------------------------------------------------------------
function createBaseValidOutput() {
  return {
    report: {
      knownFacts: [
        {
          statement: 'Sensor telemetry recorded load drop to zero at 22:15 UTC.',
          evidenceIds: ['EV-01'], // EV-01 is verified
          basis: 'Harbor Museum Telemetry System Server #2',
        },
      ],
      unverifiedClaims: [
        {
          statement: 'Docent states statue was seen on pedestal at 22:30 UTC.',
          evidenceIds: ['EV-02'], // EV-02 is unverified
          verificationStatus: 'unverified',
        },
      ],
      evidenceConnections: [
        {
          description: 'Power event coincides with sensor zero-reading.',
          evidenceIds: ['EV-01', 'EV-03'], // EV-03 is verified
          status: 'possible',
          why: 'Temporal proximity between breaker trip and telemetry event.',
        },
      ],
      contradictions: [
        {
          claimA: {
            text: 'Sensor shows empty pedestal.',
            evidenceIds: ['EV-01'],
          },
          claimB: {
            text: 'Docent claims statue was in place.',
            evidenceIds: ['EV-02'],
          },
          explanation: 'Conflict between sensor readings and human observation.',
          unresolved: true,
        },
      ],
      hypotheses: [
        {
          hypothesisId: 'H-1',
          description: 'Electrical disturbance triggered sensor anomaly.',
          supportingEvidenceIds: ['EV-03'],
          conflictingEvidenceIds: ['EV-01'],
          status: 'under_consideration',
        },
      ],
      openQuestions: [
        {
          question: 'Did auxiliary power cause calibration error?',
          relatedEvidenceIds: ['EV-03'],
        },
      ],
      suggestedNextChecks: [
        {
          check: 'Inspect circuit breaker logs.',
          purpose: 'Determine power fluctuations during incident.',
          relatedHypothesisIds: ['H-1'],
        },
      ],
      memoryUpdates: [
        {
          action: 'add',
          summary: 'Power surge at 22:14:50 UTC.',
          reason: 'Verified facilities log entry.',
          evidenceIds: ['EV-03'],
        },
      ],
    },
    memoryProposals: [
      {
        action: 'add',
        type: 'event',
        summary: 'Breaker tripped at 22:14:50 UTC.',
        evidenceIds: ['EV-03'],
        confidenceLabel: 'high',
        reason: 'Engineering console log.',
      },
    ],
  };
}

const mockContext = {
  caseEvidenceIds: ['EV-01', 'EV-02', 'EV-03'],
  caseMemoryIds: ['MEM-01'],
  evidenceStatuses: {
    'EV-01': 'verified',
    'EV-02': 'unverified',
    'EV-03': 'verified',
  },
};

const dummyParams = {
  newEvidence: { id: 'EV-03', title: 'Breaker log', verificationStatus: 'verified' },
  relatedEvidence: [
    { id: 'EV-01', title: 'Sensor', verificationStatus: 'verified' },
    { id: 'EV-02', title: 'Docent note', verificationStatus: 'unverified' },
  ],
  memories: [{ id: 'MEM-01', summary: 'Initial note' }],
  previousReport: null,
};

async function runTests() {
  // -------------------------------------------------------------------------
  // Test 1: Valid output (passes on first attempt, no repair call)
  // -------------------------------------------------------------------------
  console.log('[Test 1] Testing valid output through analyzeValidated()...');
  let callCount1 = 0;
  const mockLlm1 = async () => {
    callCount1++;
    return createBaseValidOutput();
  };

  const result1 = await analyzeValidated(dummyParams, mockContext, { llmCaller: mockLlm1 });
  assert.strictEqual(callCount1, 1, 'Should require exactly 1 LLM call when valid');
  assert.ok(result1.report, 'Result must contain report');
  assert.ok(result1.memoryProposals, 'Result must contain memoryProposals');
  console.log('  ✓ Valid output passed on first call without repair\n');

  // -------------------------------------------------------------------------
  // Test 2: Fake ID fixed on retry
  // -------------------------------------------------------------------------
  console.log('[Test 2] Testing fake ID caught and fixed on single repair retry...');
  let callCount2 = 0;
  let receivedRepairPrompt = '';

  const mockLlm2 = async ({ user }) => {
    callCount2++;
    if (callCount2 === 1) {
      // First attempt: injects a fake evidence ID "EV-999"
      const flawed = createBaseValidOutput();
      flawed.report.knownFacts[0].evidenceIds = ['EV-999'];
      return flawed;
    }
    // Second attempt (repair call): receives error list and returns corrected ID "EV-01"
    receivedRepairPrompt = user;
    const corrected = createBaseValidOutput();
    corrected.report.knownFacts[0].evidenceIds = ['EV-01'];
    return corrected;
  };

  const result2 = await analyzeValidated(dummyParams, mockContext, { llmCaller: mockLlm2 });
  assert.strictEqual(callCount2, 2, 'Should make 1 initial call + 1 repair call');
  assert.ok(receivedRepairPrompt.includes('EV-999'), 'Repair prompt must detail the invalid ID error');
  assert.deepStrictEqual(result2.report.knownFacts[0].evidenceIds, ['EV-01'], 'Returned output must have corrected ID');
  console.log('  ✓ Fake ID triggered repair call; corrected output accepted\n');

  // -------------------------------------------------------------------------
  // Test 3: Output never fixed (fails both initial and repair calls)
  // -------------------------------------------------------------------------
  console.log('[Test 3] Testing output never fixed throws ValidationError...');
  let callCount3 = 0;
  const mockLlm3 = async () => {
    callCount3++;
    // Both attempts return non-existent ID
    const flawed = createBaseValidOutput();
    flawed.report.knownFacts[0].evidenceIds = ['EV-FAKE-FOREVER'];
    return flawed;
  };

  let threwExpectedError = false;
  try {
    await analyzeValidated(dummyParams, mockContext, { llmCaller: mockLlm3 });
  } catch (err) {
    threwExpectedError = true;
    assert.ok(err instanceof ValidationError, 'Must throw instance of ValidationError');
    assert.strictEqual(callCount3, 2, 'Must attempt exactly 1 initial + 1 repair call before throwing');
    assert.ok(err.errors.length > 0, 'ValidationError must list the specific errors');
    const hasFakeIdError = err.errors.some((e) => e.includes('EV-FAKE-FOREVER'));
    assert.ok(hasFakeIdError, 'Error list must report EV-FAKE-FOREVER');
  }
  assert.ok(threwExpectedError, 'Must throw when repair also fails');
  console.log('  ✓ Output never fixed threw ValidationError with detailed error list\n');

  // -------------------------------------------------------------------------
  // Test 4: Accusation sentence rejected
  // -------------------------------------------------------------------------
  console.log('[Test 4] Testing accusation sentence rejection...');
  const accusationOutput = createBaseValidOutput();
  accusationOutput.report.unverifiedClaims[0].statement =
    'Arthur Pendelton is guilty of the theft and should be arrested by detectives.';

  const val4 = validateOutput(accusationOutput, mockContext);
  assert.strictEqual(val4.valid, false, 'Must fail validation on accusation sentence');
  const hasAccusationError = val4.errors.some((e) => e.includes('[Ethical Violation]'));
  assert.ok(hasAccusationError, 'Must flag [Ethical Violation]');
  console.log('  ✓ Accusation sentence rejected with ethical violation error\n');

  // -------------------------------------------------------------------------
  // Test 5: knownFact built only on unverified evidence rejected
  // -------------------------------------------------------------------------
  console.log('[Test 5] Testing knownFact built only on unverified evidence rejected...');
  const unverifiedFactOutput = createBaseValidOutput();
  // EV-02 is unverified in mockContext.evidenceStatuses
  unverifiedFactOutput.report.knownFacts[0].statement = 'Docent observed the statue in place.';
  unverifiedFactOutput.report.knownFacts[0].evidenceIds = ['EV-02']; // Relying strictly on unverified evidence!

  const val5 = validateOutput(unverifiedFactOutput, mockContext);
  assert.strictEqual(val5.valid, false, 'Must fail validation when fact relies solely on unverified evidence');
  const hasUngroundedError = val5.errors.some((e) => e.includes('[Ungrounded Fact]'));
  assert.ok(hasUngroundedError, 'Must flag [Ungrounded Fact]');
  console.log('  ✓ knownFact citing only unverified evidence was rejected\n');

  // -------------------------------------------------------------------------
  // Bonus Test 6: Memory proposal proposing deleting original evidence rejected
  // -------------------------------------------------------------------------
  console.log('[Test 6] Testing memory proposal deleting evidence rejected...');
  const deleteEvidenceOutput = createBaseValidOutput();
  deleteEvidenceOutput.memoryProposals[0].summary = 'Delete original evidence EV-01 because it was an error.';
  const val6 = validateOutput(deleteEvidenceOutput, mockContext);
  assert.strictEqual(val6.valid, false, 'Must reject memory proposal deleting evidence');
  const hasMutationError = val6.errors.some((e) => e.includes('[Illegal Mutation]'));
  assert.ok(hasMutationError, 'Must flag [Illegal Mutation]');
  console.log('  ✓ Memory proposal proposing evidence deletion rejected\n');

  console.log('🎉 All validate.test.js tests passed successfully (6/6 cases)!');
}

runTests();
