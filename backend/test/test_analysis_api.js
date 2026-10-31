process.env.NODE_ENV = 'test';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const assert = require('node:assert');
const { ObjectId } = require('mongodb');
const { connectDB, getDB, closeDB } = require('../src/config/db');
const app = require('../src/server');
const { setAiProvider, resetAiProvider } = require('../src/services/aiAdapter');

async function runAnalysisTests() {
  console.log('[Test Suite] Starting Analysis Orchestration API automated verification...');
  let server;
  let caseAId = null;
  let caseBId = null;

  try {
    // 1. Establish DB connection & ensure indexes
    console.log('[Test 1] Connecting to MongoDB and verifying indexes...');
    const db = await connectDB();
    assert.ok(db, 'Database reference should be defined');
    console.log('  ✓ MongoDB connected & collection indexes initialized');

    // 2. Start server on dynamic ephemeral port
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        resolve();
      });
    });
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;
    console.log(`  ✓ Express server listening on port ${port}`);

    // 3. Create two distinct cases to test case isolation
    console.log('[Setup] Creating Case A and Case B...');
    const caseARes = await fetch(`${baseUrl}/api/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Case A - Obsidian Gallery Heist',
        description: 'Testing analysis orchestration pipeline',
      }),
    });
    const caseAData = await caseARes.json();
    caseAId = caseAData.data._id;

    const caseBRes = await fetch(`${baseUrl}/api/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Case B - Isolation Case',
        description: 'Case B to test cross-case isolation',
      }),
    });
    const caseBData = await caseBRes.json();
    caseBId = caseBData.data._id;
    console.log(`  ✓ Created Case A (${caseAId}) and Case B (${caseBId})`);

    // 4. Test Invalid caseId format on POST /api/cases/:caseId/analyze (400)
    console.log('[Test 2] Testing POST analyze with invalid caseId format...');
    const invalidCaseRes = await fetch(`${baseUrl}/api/cases/invalid-case-id-123/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(invalidCaseRes.status, 400);
    const invalidCaseData = await invalidCaseRes.json();
    assert.strictEqual(invalidCaseData.success, false);
    assert.strictEqual(invalidCaseData.error.code, 'INVALID_ID_FORMAT');
    console.log('  ✓ Invalid caseId format rejected with 400 INVALID_ID_FORMAT');

    // 5. Test Nonexistent caseId on POST /api/cases/:caseId/analyze (404)
    console.log('[Test 3] Testing POST analyze with nonexistent caseId...');
    const nonExistentCaseId = '000000000000000000000000';
    const notFoundCaseRes = await fetch(`${baseUrl}/api/cases/${nonExistentCaseId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(notFoundCaseRes.status, 404);
    const notFoundCaseData = await notFoundCaseRes.json();
    assert.strictEqual(notFoundCaseData.success, false);
    assert.strictEqual(notFoundCaseData.error.code, 'CASE_NOT_FOUND');
    console.log('  ✓ Nonexistent caseId rejected with 404 CASE_NOT_FOUND');

    // 6. Test AI Module Failure / Unavailability (502 Bad Gateway)
    console.log('[Test 4] Testing AI failure / unavailability returns 502 Bad Gateway...');
    resetAiProvider(); // Ensure default behavior (no mock provider set)
    const aiFailRes = await fetch(`${baseUrl}/api/cases/${caseAId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(aiFailRes.status, 502);
    const aiFailData = await aiFailRes.json();
    assert.strictEqual(aiFailData.success, false);
    assert.ok(
      aiFailData.error.code === 'AI_MODULE_UNAVAILABLE' || aiFailData.error.code === 'AI_EXECUTION_FAILED',
      'Should return AI failure error code'
    );
    console.log('  ✓ AI module unavailability handled gracefully with 502 Bad Gateway');

    // 7. Seed evidence for Case A: EV-01
    console.log('[Setup] Ingesting EV-01 for Case A...');
    const ev1Res = await fetch(`${baseUrl}/api/cases/${caseAId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Display Case Tamper Sensor Log',
        content: 'Glass case pressure sensor dropped from 15.2kg to 0kg at 21:42:10.',
        source: 'Gallery Telemetry Server Log #81',
        sourceType: 'digital',
        verificationStatus: 'verified',
        occurredAt: '2026-10-30T21:42:10.000Z',
      }),
    });
    const ev1Data = await ev1Res.json();
    assert.strictEqual(ev1Data.success, true);
    assert.strictEqual(ev1Data.data.evidenceCode, 'EV-01');
    console.log('  ✓ EV-01 ingested successfully');

    // 8. Test Invalid triggerEvidenceCode (422)
    console.log('[Test 5] Testing POST analyze with invalid triggerEvidenceCode...');
    const badTriggerRes = await fetch(`${baseUrl}/api/cases/${caseAId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggerEvidenceCode: 'EV-NONEXISTENT' }),
    });
    assert.strictEqual(badTriggerRes.status, 422);
    const badTriggerData = await badTriggerRes.json();
    assert.strictEqual(badTriggerData.success, false);
    assert.strictEqual(badTriggerData.error.code, 'EVIDENCE_NOT_FOUND');
    assert.deepStrictEqual(badTriggerData.error.details.invalidEvidenceCodes, ['EV-NONEXISTENT']);
    console.log('  ✓ Non-existent triggerEvidenceCode rejected with 422 EVIDENCE_NOT_FOUND');

    // 9. Test Missing AI Output Fields (422 INVALID_AI_OUTPUT)
    console.log('[Test 6] Testing rejection of missing required AI output fields...');
    setAiProvider(async () => {
      // Missing 'summary' and 'knownFacts'
      return {
        unverifiedClaims: [],
        evidenceConnections: [],
        contradictions: [],
        possibleHypotheses: [],
        openQuestions: [],
        suggestedNextChecks: [],
        memoryUpdates: [],
      };
    });

    const missingFieldsRes = await fetch(`${baseUrl}/api/cases/${caseAId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(missingFieldsRes.status, 422);
    const missingFieldsData = await missingFieldsRes.json();
    assert.strictEqual(missingFieldsData.success, false);
    assert.strictEqual(missingFieldsData.error.code, 'INVALID_AI_OUTPUT');
    assert.ok(
      missingFieldsData.error.details.validationErrors.some((e) => e.includes('summary')),
      'Should report missing summary'
    );
    assert.ok(
      missingFieldsData.error.details.validationErrors.some((e) => e.includes('knownFacts')),
      'Should report missing knownFacts'
    );
    console.log('  ✓ Missing AI output fields rejected with 422 INVALID_AI_OUTPUT');

    // 10. Test Malformed AI Output Types (422 INVALID_AI_OUTPUT)
    console.log('[Test 7] Testing rejection of malformed AI output structures...');
    setAiProvider(async () => {
      return {
        summary: 'Valid summary string',
        knownFacts: 'not an array', // Malformed type
        unverifiedClaims: [],
        evidenceConnections: [],
        contradictions: [],
        possibleHypotheses: 'not an array either', // Malformed type
        openQuestions: [123], // Non-string array item
        suggestedNextChecks: [],
        memoryUpdates: [
          {
            category: 'invalid_category_xyz', // Invalid category enum
            statement: 'Some statement',
            supportingEvidenceCodes: ['EV-01'],
            action: 'invalid_action', // Invalid action enum
          },
        ],
      };
    });

    const malformedRes = await fetch(`${baseUrl}/api/cases/${caseAId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(malformedRes.status, 422);
    const malformedData = await malformedRes.json();
    assert.strictEqual(malformedData.success, false);
    assert.strictEqual(malformedData.error.code, 'INVALID_AI_OUTPUT');
    assert.ok(malformedData.error.details.validationErrors.length >= 3);
    console.log('  ✓ Malformed AI output structures rejected with 422 INVALID_AI_OUTPUT');

    // 11. Test Invalid Citation in AI Output (422 EVIDENCE_NOT_FOUND)
    console.log('[Test 8] Testing AI citation validation: rejection of non-existent evidence code...');
    setAiProvider(async () => {
      return {
        summary: 'AI output citing fake evidence.',
        knownFacts: [
          { statement: 'Fake fact citing non-existent EV-99.', evidenceCodes: ['EV-99'] },
        ],
        unverifiedClaims: [],
        evidenceConnections: [],
        contradictions: [],
        possibleHypotheses: [],
        openQuestions: [],
        suggestedNextChecks: [],
        memoryUpdates: [],
        explanationOfChange: 'Test change',
      };
    });

    const badCitationRes = await fetch(`${baseUrl}/api/cases/${caseAId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(badCitationRes.status, 422);
    const badCitationData = await badCitationRes.json();
    assert.strictEqual(badCitationData.success, false);
    assert.strictEqual(badCitationData.error.code, 'EVIDENCE_NOT_FOUND');
    assert.ok(badCitationData.error.details.invalidEvidenceCodes.includes('EV-99'));

    // Verify DB remains completely untouched
    const reportsCountAfterFail = await db.collection('reports').countDocuments({ caseId: new ObjectId(caseAId) });
    assert.strictEqual(reportsCountAfterFail, 0, 'No report document should be created on citation validation failure');
    const memoriesCountAfterFail = await db.collection('memories').countDocuments({ caseId: new ObjectId(caseAId) });
    assert.strictEqual(memoriesCountAfterFail, 0, 'No memory document should be created on citation validation failure');
    console.log('  ✓ Invalid AI evidence citation rejected with 422 and database left untouched');

    // 12. Test Successful Analysis Run 1 (Report Version 1)
    console.log('[Test 9] Testing Successful Analysis Run 1 (Report v1)...');
    let capturedInput = null;
    setAiProvider(async (input) => {
      capturedInput = input;
      return {
        summary: 'Baseline established: Display pedestal sensor recorded a 15.2kg weight drop at 21:42:10.',
        knownFacts: [
          {
            statement: 'Display pedestal pressure sensor registered 15.2kg load drop to zero at 21:42:10.',
            evidenceCodes: ['EV-01'],
          },
        ],
        unverifiedClaims: [],
        evidenceConnections: [],
        contradictions: [],
        possibleHypotheses: [
          {
            hypothesisId: 'H-1',
            title: 'Initial Removal Theory',
            rationale: 'Weight dropped to zero on pedestal sensor.',
            supportedBy: ['EV-01'],
            unresolvedPoints: ['Requires verification of witness reliability.'],
          },
        ],
        openQuestions: ['Did any other sensor record activity at 21:42?'],
        suggestedNextChecks: ['Audit telemetry logs.'],
        memoryUpdates: [
          {
            category: 'fact',
            statement: 'Display pedestal pressure sensor registered 15.2kg load drop to zero at 21:42:10.',
            supportingEvidenceCodes: ['EV-01'],
            action: 'add',
            changeReason: 'Initialized from direct digital telemetry log EV-01.',
          },
          {
            category: 'hypothesis',
            statement: 'Initial removal theory: bronze relic removed at 21:42.',
            supportingEvidenceCodes: ['EV-01'],
            hypothesisDetails: {
              hypothesisId: 'H-1',
              title: 'Initial Removal Theory',
              rationale: 'Weight dropped to zero on pedestal sensor.',
              unresolvedPoints: ['Requires verification of witness reliability.'],
            },
            action: 'add',
            changeReason: 'Initial working theory from EV-01.',
          },
        ],
        explanationOfChange: 'Initial synthesis from EV-01.',
      };
    });

    const v1Res = await fetch(`${baseUrl}/api/cases/${caseAId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggerEvidenceCode: 'EV-01' }),
    });
    assert.strictEqual(v1Res.status, 201);
    const v1Data = await v1Res.json();
    assert.strictEqual(v1Data.success, true);
    assert.strictEqual(v1Data.data.version, 1);
    assert.strictEqual(v1Data.data.caseId, caseAId);
    assert.ok(v1Data.data.reportId, 'Response must include reportId');
    assert.strictEqual(v1Data.data.triggerEvidenceCode, 'EV-01');
    assert.strictEqual(v1Data.data.knownFacts.length, 1);
    assert.strictEqual(v1Data.data.possibleHypotheses[0].hypothesisId, 'H-1');
    assert.strictEqual(v1Data.data.memoryDelta.added.length, 2);

    // Verify input mapping received by AI adapter
    assert.strictEqual(capturedInput.caseDetails.id, caseAId);
    assert.strictEqual(capturedInput.evidenceList.length, 1);
    assert.strictEqual(capturedInput.evidenceList[0].evidenceCode, 'EV-01');
    assert.strictEqual(capturedInput.currentMemories.length, 0);

    // Verify persisted report in MongoDB
    const report1Doc = await db.collection('reports').findOne({ caseId: new ObjectId(caseAId), version: 1 });
    assert.ok(report1Doc, 'Report v1 must exist in reports collection');
    assert.strictEqual(report1Doc.version, 1);

    // Verify persisted memories in MongoDB
    const activeMemoriesAfterV1 = await db
      .collection('memories')
      .find({ caseId: new ObjectId(caseAId), status: 'active' })
      .toArray();
    assert.strictEqual(activeMemoriesAfterV1.length, 2, 'Should persist 2 active memories from memoryUpdates');
    const firstMemoryId = activeMemoriesAfterV1[0]._id.toString();

    // Verify GET /api/cases/:caseId stats
    const caseStatsRes1 = await fetch(`${baseUrl}/api/cases/${caseAId}`);
    const caseStatsData1 = await caseStatsRes1.json();
    assert.strictEqual(caseStatsData1.data.stats.latestReportVersion, 1);
    assert.strictEqual(caseStatsData1.data.stats.activeMemoriesCount, 2);
    console.log('  ✓ Report v1 successfully created, persisted, and verified against MongoDB');

    // 13. Test Nonexistent Target Memory ID on update/supersede (422 TARGET_MEMORY_NOT_FOUND)
    console.log('[Test 10] Testing rejection of non-existent target memory ID...');
    const fakeMemoryId = '67232e03a1b2c3d4e5f60999';
    setAiProvider(async () => {
      return {
        summary: 'AI output attempting update on non-existent memory ID.',
        knownFacts: [
          { statement: 'Sensor registered drop to zero at 21:42:10.', evidenceCodes: ['EV-01'] },
        ],
        unverifiedClaims: [],
        evidenceConnections: [],
        contradictions: [],
        possibleHypotheses: [],
        openQuestions: [],
        suggestedNextChecks: [],
        memoryUpdates: [
          {
            category: 'fact',
            statement: 'Updated statement',
            supportingEvidenceCodes: ['EV-01'],
            action: 'update',
            targetMemoryId: fakeMemoryId,
            changeReason: 'Should fail because target does not exist',
          },
        ],
        explanationOfChange: 'Test invalid target ID',
      };
    });

    const badTargetMemoryRes = await fetch(`${baseUrl}/api/cases/${caseAId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(badTargetMemoryRes.status, 422);
    const badTargetMemoryData = await badTargetMemoryRes.json();
    assert.strictEqual(badTargetMemoryData.success, false);
    assert.strictEqual(badTargetMemoryData.error.code, 'TARGET_MEMORY_NOT_FOUND');
    console.log('  ✓ Non-existent targetMemoryId rejected with 422 TARGET_MEMORY_NOT_FOUND');

    // 14. Test Successful Analysis Run 2: Distinguishing recorded report update from MongoDB mutation
    console.log('[Test 11] Testing Report v2: Distinguishing report-recorded updates from persisted mutations...');
    // Ingest EV-02 and EV-03
    await fetch(`${baseUrl}/api/cases/${caseAId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Catering Staff Witness Statement',
        content: 'Server Clara Bell asserts the statue was on pedestal at 21:55.',
        source: 'Witness Interview #1',
        sourceType: 'witness',
        verificationStatus: 'unverified',
        occurredAt: '2026-10-30T21:55:00.000Z',
      }),
    });

    await fetch(`${baseUrl}/api/cases/${caseAId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Security Desk Logbook',
        content: 'Building power surge and breaker reset logged at 21:42:00.',
        source: 'Incident Book Entry 14',
        sourceType: 'document',
        verificationStatus: 'verified',
        occurredAt: '2026-10-30T21:42:00.000Z',
      }),
    });

    setAiProvider(async (input) => {
      capturedInput = input;
      return {
        summary: 'Chronological conflict identified between sensor telemetry (21:42) and witness sighting (21:55).',
        knownFacts: [
          { statement: 'Sensor registered drop to 0kg at 21:42:10.', evidenceCodes: ['EV-01'] },
          { statement: 'Building power surge logged at 21:42:00.', evidenceCodes: ['EV-03'] },
        ],
        unverifiedClaims: [
          { statement: 'Server saw statue at 21:55.', source: 'Clara Bell', evidenceCodes: ['EV-02'] },
        ],
        evidenceConnections: [
          { connection: 'Power surge coincided with sensor drop.', evidenceCodes: ['EV-01', 'EV-03'] },
        ],
        contradictions: [
          {
            pointOfConflict: 'Sensor telemetry indicates pedestal was empty at 21:42 vs witness at 21:55.',
            conflictingEvidenceCodes: ['EV-01', 'EV-02'],
          },
        ],
        possibleHypotheses: [
          {
            hypothesisId: 'H-2',
            title: 'Electrical Surge Anomaly',
            rationale: 'Surge occurred at 21:42 coinciding with sensor drop.',
            supportedBy: ['EV-01', 'EV-03'],
            unresolvedPoints: ['Requires electrical diagnostics.'],
          },
        ],
        openQuestions: ['Did any other server observe the pedestal?'],
        suggestedNextChecks: ['Audit breaker box.'],
        memoryUpdates: [
          {
            category: 'claim',
            statement: 'Server Clara Bell asserts statue was still present at 21:55.',
            supportingEvidenceCodes: ['EV-02'],
            action: 'add',
            changeReason: 'Added unverified claim from witness statement EV-02.',
          },
          // Action 'update' WITH explicit valid targetMemoryId -> should actually mutate DB document
          {
            targetMemoryId: firstMemoryId,
            category: 'fact',
            statement: 'Sensor registered drop to 0kg at 21:42:10 (corroborated by power surge EV-03).',
            supportingEvidenceCodes: ['EV-01', 'EV-03'],
            action: 'update',
            changeReason: 'Updated fact with surge context.',
          },
          // Action 'update' WITHOUT targetMemoryId -> recorded in report delta, but DB memory document is NOT guessed
          {
            category: 'hypothesis',
            statement: 'Hypothesis H-1 general text update without target memory ID.',
            supportingEvidenceCodes: ['EV-01'],
            action: 'update',
            changeReason: 'Abstract theoretical update without target identifier.',
          },
        ],
        explanationOfChange: 'Ingested EV-02 and EV-03; identified contradiction between sensor and witness.',
      };
    });

    const v2Res = await fetch(`${baseUrl}/api/cases/${caseAId}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggerEvidenceCode: 'EV-03' }),
    });
    assert.strictEqual(v2Res.status, 201);
    const v2Data = await v2Res.json();
    assert.strictEqual(v2Data.success, true);
    assert.strictEqual(v2Data.data.version, 2);
    assert.strictEqual(v2Data.data.triggerEvidenceCode, 'EV-03');
    assert.strictEqual(v2Data.data.contradictions.length, 1);

    // Verify report memoryDelta reflects both updates in report delta
    assert.strictEqual(v2Data.data.memoryDelta.added.length, 1);
    assert.strictEqual(v2Data.data.memoryDelta.updated.length, 2);

    // Verify MongoDB state: The memory with targetMemoryId was mutated
    const updatedMemoryDoc = await db.collection('memories').findOne({ _id: new ObjectId(firstMemoryId) });
    assert.strictEqual(
      updatedMemoryDoc.statement,
      'Sensor registered drop to 0kg at 21:42:10 (corroborated by power surge EV-03).'
    );
    assert.strictEqual(updatedMemoryDoc.lastUpdatedInVersion, 2);

    // Verify total count in memories: 2 from v1 + 1 added in v2 = 3 total documents
    const totalMemoriesAfterV2 = await db.collection('memories').countDocuments({ caseId: new ObjectId(caseAId) });
    assert.strictEqual(totalMemoriesAfterV2, 3);
    console.log('  ✓ Verified: Report records delta; MongoDB only mutates verified target memory IDs');

    // 15. Test Partial Persistence Failure in Standalone Fallback (500 PARTIAL_WRITE_UNRECONCILED)
    console.log('[Test 12] Testing standalone partial persistence failure handling...');
    setAiProvider(async () => {
      return {
        summary: 'Report v3 triggering simulated memory failure in standalone mode.',
        knownFacts: [
          { statement: 'Sensor registered drop to 0kg at 21:42:10.', evidenceCodes: ['EV-01'] },
        ],
        unverifiedClaims: [],
        evidenceConnections: [],
        contradictions: [],
        possibleHypotheses: [],
        openQuestions: [],
        suggestedNextChecks: [],
        memoryUpdates: [
          {
            category: 'fact',
            statement: 'New fact in v3',
            supportingEvidenceCodes: ['EV-01'],
            action: 'add',
            changeReason: 'Should trigger memory failure',
          },
        ],
        explanationOfChange: 'Testing partial write',
      };
    });

    const partialFailRes = await fetch(`${baseUrl}/api/cases/${caseAId}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-force-fallback': 'true',
        'x-test-simulate-memory-failure': 'true',
      },
      body: JSON.stringify({}),
    });

    assert.strictEqual(partialFailRes.status, 500);
    const partialFailData = await partialFailRes.json();
    assert.strictEqual(partialFailData.success, false);
    assert.strictEqual(partialFailData.error.code, 'PARTIAL_WRITE_UNRECONCILED');
    assert.ok(partialFailData.error.details.reportId, 'Must include reportId in error details');
    assert.strictEqual(partialFailData.error.details.version, 3);

    // Crucial check: Authoritative report v3 was NOT deleted to hide the failure!
    const report3Doc = await db.collection('reports').findOne({ caseId: new ObjectId(caseAId), version: 3 });
    assert.ok(report3Doc, 'Report v3 must remain in reports collection as single source of truth');
    assert.strictEqual(report3Doc.version, 3);
    console.log('  ✓ Standalone partial persistence returns 500 PARTIAL_WRITE_UNRECONCILED and preserves report');

    // 16. Test Case Isolation between Case A and Case B
    console.log('[Test 13] Testing Case Isolation between Case A and Case B...');
    const caseBReportsRes = await fetch(`${baseUrl}/api/cases/${caseBId}/reports`);
    const caseBReportsData = await caseBReportsRes.json();
    assert.strictEqual(caseBReportsData.data.length, 0, 'Case B should have 0 reports');
    console.log('  ✓ Strict case isolation verified: Case B has zero access to Case A reports');

    // 17. Cleanup
    console.log('[Cleanup] Cleaning up test cases, reports, evidence, and memories...');
    await db.collection('cases').deleteMany({ _id: { $in: [new ObjectId(caseAId), new ObjectId(caseBId)] } });
    await db.collection('evidence').deleteMany({ caseId: { $in: [new ObjectId(caseAId), new ObjectId(caseBId)] } });
    await db.collection('reports').deleteMany({ caseId: { $in: [new ObjectId(caseAId), new ObjectId(caseBId)] } });
    await db.collection('memories').deleteMany({ caseId: { $in: [new ObjectId(caseAId), new ObjectId(caseBId)] } });
    resetAiProvider();
    console.log('  ✓ Cleaned up all test documents');

    console.log('\n==============================================');
    console.log(' ALL ANALYSIS ORCHESTRATION TESTS PASSED! ');
    console.log('==============================================\n');
  } finally {
    resetAiProvider();
    if (server) {
      server.close();
    }
    await closeDB();
  }
}

if (require.main === module) {
  runAnalysisTests().catch((err) => {
    console.error('[Test Failure] Analysis test suite encountered an unhandled error:');
    console.error(err);
    process.exit(1);
  });
}

module.exports = runAnalysisTests;
