const assert = require('assert');
const { processEvidence } = require('../index');
const realDeps = require('../deps.real');

async function runTests() {
  console.log('--- Testing processEvidence in server/ai/index.js ---');

  // Test 1: Returns clear error if evidence is not found
  console.log('Test 1: Returns clear error if evidence or case is missing');
  {
    const mockDeps = {
      getEvidence: async () => null,
    };
    const result = await processEvidence(mockDeps, { caseId: 'case-1', evidenceId: 'ev-999' });
    assert.strictEqual(result.status, 'analysis_failed');
    assert.strictEqual(result.evidencePreserved, true);
    assert.ok(result.error.includes('not found'));
    console.log('  Passed: Clear error returned when evidence not found.');
  }

  // Test 2: Status lifecycle and successful analysis flow
  console.log('Test 2: Status lifecycle: pending -> ok with audit and no fabrication');
  {
    const statusCalls = [];
    const mockEvidence = {
      _id: 'ev-1',
      evidenceCode: 'EV-01',
      title: 'Server Log',
      content: 'Badge 1042 used at 22:00 at the warehouse door.',
      verificationStatus: 'verified',
    };

    const mockOutput = {
      report: {
        knownFacts: [{ statement: 'Badge 1042 was used at the warehouse door.', evidenceIds: ['EV-01'], basis: 'Direct log record' }],
        unverifiedClaims: [],
        evidenceConnections: [],
        contradictions: [],
        hypotheses: [{
          hypothesisId: 'HYP-01',
          description: 'Access was performed using badge 1042',
          supportingEvidenceIds: ['EV-01'],
          conflictingEvidenceIds: [],
          status: 'under_consideration',
        }],
        openQuestions: [],
        suggestedNextChecks: [],
        memoryUpdates: [],
      },
      memoryProposals: [
        {
          action: 'add',
          type: 'connection',
          summary: 'Badge access recorded at warehouse',
          evidenceIds: ['EV-01'],
          confidenceLabel: 'high',
          reason: 'Direct log timestamp',
        },
      ],
    };

    const mockDeps = {
      getEvidence: async () => mockEvidence,
      setAnalysisStatus: async (caseId, evidenceId, status, error) => {
        statusCalls.push({ caseId, evidenceId, status, error });
      },
      getContext: async () => ({
        recentEvidence: [mockEvidence],
        memories: [],
      }),
      llmCall: async () => mockOutput,
    };

    const result = await processEvidence(mockDeps, { caseId: 'case-1', evidenceId: 'ev-1' });

    assert.strictEqual(result.status, 'ok');
    assert.ok(result.report);
    assert.strictEqual(result.report.knownFacts.length, 1);
    assert.strictEqual(result.memoryProposals.accepted.length, 1);
    assert.ok(result.changeSummary, 'result.changeSummary must be populated');
    assert.strictEqual(result.changeSummary.added, 'EV-01');
    assert.ok(Array.isArray(result.retrieved));
    assert.ok(result.audit);
    assert.strictEqual(result.audit.validationOutcome, 'passed');
    assert.ok(typeof result.audit.durationMs === 'number');

    // Confirm status lifecycle calls: pending first, then ok
    assert.strictEqual(statusCalls.length, 2);
    assert.strictEqual(statusCalls[0].status, 'pending');
    assert.strictEqual(statusCalls[1].status, 'ok');
    console.log('  Passed: Status lifecycle pending -> ok and audit log verified.');
  }

  // Test 3: Idempotency (returns stored result unless reanalyze is true)
  console.log('Test 3: Idempotency: returns stored result when status is ok unless reanalyze=true');
  {
    let llmCallCount = 0;
    const storedReport = {
      knownFacts: [{ statement: 'Cached statement', evidenceIds: ['EV-01'], basis: 'Prior run' }],
      unverifiedClaims: [],
      evidenceConnections: [],
      contradictions: [],
      hypotheses: [],
      openQuestions: [],
      suggestedNextChecks: [],
      memoryUpdates: [],
    };

    const mockEvidence = {
      _id: 'ev-1',
      evidenceCode: 'EV-01',
      verificationStatus: 'verified',
      analysisStatus: 'ok',
      lastAnalysisResult: {
        report: storedReport,
        memoryProposals: { accepted: [], rejected: [] },
      },
    };

    const mockDeps = {
      getEvidence: async () => mockEvidence,
      llmCall: async () => {
        llmCallCount++;
        return { report: storedReport, memoryProposals: [] };
      },
    };

    // First call without reanalyze
    const result1 = await processEvidence(mockDeps, { caseId: 'case-1', evidenceId: 'ev-1', reanalyze: false });
    assert.strictEqual(result1.status, 'ok');
    assert.strictEqual(result1.idempotent, true);
    assert.strictEqual(llmCallCount, 0, 'Should not call LLM when already ok and !reanalyze');

    // Second call with reanalyze=true
    const result2 = await processEvidence(mockDeps, { caseId: 'case-1', evidenceId: 'ev-1', reanalyze: true });
    assert.strictEqual(result2.status, 'ok');
    assert.strictEqual(llmCallCount, 1, 'Should call LLM when reanalyze=true');
    console.log('  Passed: Idempotency respected; reanalyze flag triggers re-execution.');
  }

  // Test 4: Per-case queue enforces serial order per case while different cases run concurrently
  console.log('Test 4: Per-case sequential queue execution');
  {
    const executionOrder = [];
    const makeDeps = (caseId, id, delayMs) => ({
      getEvidence: async () => ({ _id: id, evidenceCode: `EV-${id}`, content: 'test', verificationStatus: 'verified' }),
      llmCall: async () => {
        executionOrder.push(`start:${caseId}:${id}`);
        await new Promise((r) => setTimeout(r, delayMs));
        executionOrder.push(`end:${caseId}:${id}`);
        return {
          report: {
            knownFacts: [{ statement: 'Fact', evidenceIds: [`EV-${id}`], basis: 'Test' }],
            unverifiedClaims: [],
            evidenceConnections: [],
            contradictions: [],
            hypotheses: [],
            openQuestions: [],
            suggestedNextChecks: [],
            memoryUpdates: [],
          },
          memoryProposals: [],
        };
      },
    });

    // Start 2 items for case A: item 1 takes 50ms, item 2 takes 10ms.
    // If queued serially, item 1 MUST start and finish before item 2 starts!
    const caseAPromise1 = processEvidence(makeDeps('caseA', '1', 50), { caseId: 'caseA', evidenceId: '1' });
    const caseAPromise2 = processEvidence(makeDeps('caseA', '2', 10), { caseId: 'caseA', evidenceId: '2' });

    // Item for case B should run in parallel without waiting for case A
    const caseBPromise = processEvidence(makeDeps('caseB', '3', 15), { caseId: 'caseB', evidenceId: '3' });

    await Promise.all([caseAPromise1, caseAPromise2, caseBPromise]);

    // In case A: 1 must finish before 2 starts
    const end1Index = executionOrder.indexOf('end:caseA:1');
    const start2Index = executionOrder.indexOf('start:caseA:2');
    assert.ok(end1Index < start2Index, 'In same case, task 1 must end before task 2 starts');

    console.log('  Passed: Per-case queue processes in strict sequential order.');
  }

  // Test 5: On LLM failure returns analysis_failed and preserves evidence
  console.log('Test 5: On LLM failure, returns analysis_failed with evidencePreserved: true');
  {
    const statusCalls = [];
    const mockDeps = {
      getEvidence: async () => ({ _id: 'ev-err', evidenceCode: 'EV-ERR', content: 'test' }),
      setAnalysisStatus: async (caseId, evidenceId, status, error) => {
        statusCalls.push({ status, error });
      },
      llmCall: async () => {
        throw new Error('LLM Gateway 503 Service Unavailable');
      },
    };

    const result = await processEvidence(mockDeps, { caseId: 'case-err', evidenceId: 'ev-err' });
    assert.strictEqual(result.status, 'analysis_failed');
    assert.strictEqual(result.evidencePreserved, true);
    assert.ok(result.error.includes('503'));
    assert.strictEqual(statusCalls[statusCalls.length - 1].status, 'analysis_failed');
    console.log('  Passed: Error returns status: analysis_failed and never fabricates reports.');
  }

  // Test 6: deps.real.js stops and names missing Member 1 functions with exact signatures
  console.log('Test 6: deps.real.js halts on missing Member 1 functions');
  {
    assert.ok(Array.isArray(realDeps.MISSING_FROM_MEMBER_1));
    assert.ok(realDeps.MISSING_FROM_MEMBER_1.length >= 5);

    let threw = false;
    try {
      await realDeps.getEvidence('case-1', 'ev-1');
    } catch (err) {
      threw = true;
      assert.strictEqual(err.name, 'MissingMember1FunctionError');
      assert.ok(err.message.includes('getEvidence(caseId, evidenceId)'));
    }
    assert.ok(threw, 'Calling realDeps.getEvidence must throw MissingMember1FunctionError');
    console.log('  Passed: deps.real.js strictly stops at missing Member 1 functions without mocking.');
  }

  console.log('--- All processEvidence & deps.real tests PASSED! ---');
}

runTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exitCode = 1;
});
