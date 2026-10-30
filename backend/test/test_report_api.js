const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const assert = require('node:assert');
const { ObjectId } = require('mongodb');
const { connectDB, getDB, closeDB } = require('../src/config/db');
const app = require('../src/server');

async function runReportTests() {
  console.log('[Test Suite] Starting Reports Retrieval API automated verification...');
  let server;
  let caseAId = null;
  let caseBId = null;

  try {
    // 1. Establish DB connection & ensure indexes
    console.log('[Test 1] Connecting to MongoDB and ensuring indexes...');
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
        title: 'Case A - Reports Test',
        description: 'Case A for testing report retrieval and versioning',
      }),
    });
    const caseAData = await caseARes.json();
    caseAId = caseAData.data._id;

    const caseBRes = await fetch(`${baseUrl}/api/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Case B - Reports Isolation',
        description: 'Case B to test cross-case isolation',
      }),
    });
    const caseBData = await caseBRes.json();
    caseBId = caseBData.data._id;
    console.log(`  ✓ Created Case A (${caseAId}) and Case B (${caseBId})`);

    // 4. Test Empty Report List
    console.log('[Test 2] Testing empty report list for fresh case...');
    const emptyRes = await fetch(`${baseUrl}/api/cases/${caseAId}/reports`);
    assert.strictEqual(emptyRes.status, 200);
    const emptyData = await emptyRes.json();
    assert.strictEqual(emptyData.success, true);
    assert.ok(Array.isArray(emptyData.data));
    assert.strictEqual(emptyData.data.length, 0);
    console.log('  ✓ Fresh case returns empty report list []');

    // 5. Test Invalid caseId format on reports listing (400)
    console.log('[Test 3] Testing GET reports with invalid caseId format...');
    const invalidCaseRes = await fetch(`${baseUrl}/api/cases/invalid-case-id-123/reports`);
    assert.strictEqual(invalidCaseRes.status, 400);
    const invalidCaseData = await invalidCaseRes.json();
    assert.strictEqual(invalidCaseData.success, false);
    assert.strictEqual(invalidCaseData.error.code, 'INVALID_ID_FORMAT');
    console.log('  ✓ Invalid caseId format rejected with 400 INVALID_ID_FORMAT');

    // 6. Test Nonexistent caseId on reports listing (404)
    console.log('[Test 4] Testing GET reports with nonexistent caseId...');
    const nonExistentCaseId = '000000000000000000000000';
    const notFoundCaseRes = await fetch(`${baseUrl}/api/cases/${nonExistentCaseId}/reports`);
    assert.strictEqual(notFoundCaseRes.status, 404);
    const notFoundCaseData = await notFoundCaseRes.json();
    assert.strictEqual(notFoundCaseData.success, false);
    assert.strictEqual(notFoundCaseData.error.code, 'CASE_NOT_FOUND');
    console.log('  ✓ Nonexistent caseId rejected with 404 CASE_NOT_FOUND');

    // 7. Test Invalid version values (zero, negative, non-integer, malformed)
    console.log('[Test 5] Testing GET report by version with invalid version values...');
    const invalidVersions = ['0', '-1', '1.5', 'abc', 'v1', '01'];
    for (const badVer of invalidVersions) {
      const badVerRes = await fetch(`${baseUrl}/api/cases/${caseAId}/reports/${badVer}`);
      assert.strictEqual(badVerRes.status, 400, `Version '${badVer}' should return 400`);
      const badVerData = await badVerRes.json();
      assert.strictEqual(badVerData.success, false);
      assert.strictEqual(badVerData.error.code, 'INVALID_VERSION_FORMAT');
    }
    console.log('  ✓ Rejected invalid version formats (zero, negative, float, strings, leading zero)');

    // 8. Seed synthetic immutable report documents directly in MongoDB
    console.log('[Setup] Seeding immutable report documents for Case A and Case B...');
    const caseAObjectId = new ObjectId(caseAId);
    const caseBObjectId = new ObjectId(caseBId);

    await db.collection('reports').insertMany([
      // Case A - Report Version 1
      {
        caseId: caseAObjectId,
        version: 1,
        summary: 'Baseline established: Display sensor triggered at 21:42.',
        knownFacts: [
          { statement: 'Sensor registered drop to 0kg.', evidenceCodes: ['EV-01'] },
        ],
        unverifiedClaims: [],
        evidenceConnections: [],
        contradictions: [],
        possibleHypotheses: [
          {
            hypothesisId: 'H-1',
            title: 'Initial Removal Theory',
            rationale: 'Weight dropped to zero.',
            supportedBy: ['EV-01'],
            unresolvedPoints: ['Power or witness corroboration needed.'],
          },
        ],
        openQuestions: ['Was electrical power normal?'],
        suggestedNextChecks: ['Audit power logs.'],
        memoryDelta: {
          added: ['Fact: Sensor registered weight drop at 21:42.'],
          updated: [],
          explanation: 'Initial synthesis from EV-01.',
        },
        triggerEvidenceCode: 'EV-01',
        createdAt: new Date('2026-10-31T02:10:00Z'),
      },

      // Case A - Report Version 2 (Newer version)
      {
        caseId: caseAObjectId,
        version: 2,
        summary: 'Contradiction identified between sensor telemetry and witness observation.',
        knownFacts: [
          { statement: 'Sensor registered drop to 0kg.', evidenceCodes: ['EV-01'] },
          { statement: 'Power surge logged at 21:42:00.', evidenceCodes: ['EV-03'] },
        ],
        unverifiedClaims: [
          { statement: 'Server saw statue at 21:55.', source: 'Clara Bell', evidenceCodes: ['EV-02'] },
        ],
        evidenceConnections: [
          { connection: 'Power surge coincided with sensor drop.', evidenceCodes: ['EV-01', 'EV-03'] },
        ],
        contradictions: [
          { pointOfConflict: 'Sensor 21:42 vs Witness 21:55', conflictingEvidenceCodes: ['EV-01', 'EV-02'] },
        ],
        possibleHypotheses: [
          {
            hypothesisId: 'H-2',
            title: 'Electrical Surge Glitch',
            rationale: 'Surge occurred at 21:42 coinciding with sensor zero reading.',
            supportedBy: ['EV-01', 'EV-03'],
            unresolvedPoints: ['Sensor diagnostics pending.'],
          },
        ],
        openQuestions: ['Did any other server observe the pedestal?'],
        suggestedNextChecks: ['Interview gala bartender.'],
        memoryDelta: {
          added: ['Fact: Power surge occurred at 21:42 (EV-03).'],
          updated: ['H-1 updated with witness conflict.'],
          explanation: 'Incorporated EV-02 and EV-03.',
        },
        triggerEvidenceCode: 'EV-03',
        createdAt: new Date('2026-10-31T02:25:00Z'),
      },

      // Case B - Report Version 1 (Must NEVER be returned when querying Case A)
      {
        caseId: caseBObjectId,
        version: 1,
        summary: 'CONFIDENTIAL: Case B baseline intelligence report.',
        knownFacts: [
          { statement: 'Case B secret fact.', evidenceCodes: ['EV-99'] },
        ],
        unverifiedClaims: [],
        evidenceConnections: [],
        contradictions: [],
        possibleHypotheses: [],
        openQuestions: [],
        suggestedNextChecks: [],
        memoryDelta: { added: [], updated: [], explanation: 'Case B initial.' },
        triggerEvidenceCode: 'EV-99',
        createdAt: new Date('2026-10-31T02:30:00Z'),
      },
    ]);
    console.log('  ✓ Seeded 2 report versions for Case A (v1, v2) and 1 report for Case B (v1)');

    // 9. Test Valid Report Listing & Ordering (Newest First)
    console.log('[Test 6] Testing GET reports listing and ordering (newest first)...');
    const listRes = await fetch(`${baseUrl}/api/cases/${caseAId}/reports`);
    assert.strictEqual(listRes.status, 200);
    const listData = await listRes.json();
    assert.strictEqual(listData.success, true);
    assert.strictEqual(listData.data.length, 2, 'Case A should have exactly 2 reports');

    // Verify newest first: Version 2 must be first, Version 1 second
    assert.strictEqual(listData.data[0].version, 2, 'First report in list must be version 2');
    assert.strictEqual(listData.data[0].triggerEvidenceCode, 'EV-03');
    assert.strictEqual(listData.data[1].version, 1, 'Second report in list must be version 1');
    assert.strictEqual(listData.data[1].triggerEvidenceCode, 'EV-01');
    console.log('  ✓ Reports listed in correct order: newest version first (v2 then v1)');

    // 10. Test Retrieval of an Existing Report Version (v1 and v2)
    console.log('[Test 7] Testing GET report by version (v1 and v2)...');
    const v1Res = await fetch(`${baseUrl}/api/cases/${caseAId}/reports/1`);
    assert.strictEqual(v1Res.status, 200);
    const v1Data = await v1Res.json();
    assert.strictEqual(v1Data.success, true);
    assert.strictEqual(v1Data.data.version, 1);
    assert.strictEqual(v1Data.data.caseId, caseAId);
    assert.strictEqual(v1Data.data.triggerEvidenceCode, 'EV-01');
    assert.strictEqual(v1Data.data.knownFacts.length, 1);
    assert.strictEqual(v1Data.data.possibleHypotheses[0].hypothesisId, 'H-1');
    console.log('  ✓ Successfully retrieved Report v1 full payload');

    const v2Res = await fetch(`${baseUrl}/api/cases/${caseAId}/reports/2`);
    assert.strictEqual(v2Res.status, 200);
    const v2Data = await v2Res.json();
    assert.strictEqual(v2Data.success, true);
    assert.strictEqual(v2Data.data.version, 2);
    assert.strictEqual(v2Data.data.triggerEvidenceCode, 'EV-03');
    assert.strictEqual(v2Data.data.contradictions.length, 1);
    assert.strictEqual(v2Data.data.possibleHypotheses[0].hypothesisId, 'H-2');
    console.log('  ✓ Successfully retrieved Report v2 full payload');

    // 11. Test Nonexistent Report Version (404)
    console.log('[Test 8] Testing GET report by version with nonexistent version (v99)...');
    const notFoundVerRes = await fetch(`${baseUrl}/api/cases/${caseAId}/reports/99`);
    assert.strictEqual(notFoundVerRes.status, 404);
    const notFoundVerData = await notFoundVerRes.json();
    assert.strictEqual(notFoundVerData.success, false);
    assert.strictEqual(notFoundVerData.error.code, 'REPORT_NOT_FOUND');
    console.log('  ✓ Nonexistent version rejected with 404 REPORT_NOT_FOUND');

    // 12. Test Case Isolation: Case B reports NEVER returned for Case A
    console.log('[Test 9] Testing Case Isolation between Case A and Case B reports...');
    const caseBLeakCheck = listData.data.some(
      (r) => r.summary.includes('CONFIDENTIAL') || r._id === caseBId
    );
    assert.strictEqual(caseBLeakCheck, false, 'Case B reports must NEVER leak into Case A report list');

    // Querying Case A for version 1 should return Case A v1, not Case B v1
    assert.strictEqual(v1Data.data.caseId, caseAId);
    assert.ok(!v1Data.data.summary.includes('CONFIDENTIAL'));

    // Querying Case B should return Case B v1
    const caseBListRes = await fetch(`${baseUrl}/api/cases/${caseBId}/reports`);
    const caseBListData = await caseBListRes.json();
    assert.strictEqual(caseBListData.data.length, 1);
    assert.ok(caseBListData.data[0].summary.includes('CONFIDENTIAL'));
    console.log('  ✓ Strict case isolation verified: Case B reports completely isolated');

    // 13. Verify Case Stats Integration
    console.log('[Test 10] Verifying GET /api/cases/:caseId stats reflects latestReportVersion...');
    const caseStatsRes = await fetch(`${baseUrl}/api/cases/${caseAId}`);
    assert.strictEqual(caseStatsRes.status, 200);
    const caseStatsData = await caseStatsRes.json();
    assert.strictEqual(caseStatsData.data.stats.latestReportVersion, 2, 'Should reflect latestReportVersion: 2 in stats');
    console.log('  ✓ Case stats latestReportVersion accurately reports 2');

    // 14. Cleanup synthetic test data
    console.log('[Cleanup] Cleaning up test cases and report documents...');
    await db.collection('reports').deleteMany({
      caseId: { $in: [caseAObjectId, caseBObjectId] },
    });
    await db.collection('cases').deleteMany({
      _id: { $in: [caseAObjectId, caseBObjectId] },
    });
    console.log('  ✓ Cleaned up all test documents');

    console.log('\n===========================================');
    console.log(' ALL REPORTS API TESTS PASSED SUCCESSFULLY! ');
    console.log('===========================================\n');
  } catch (err) {
    console.error('\n❌ Reports Test Failure:', err);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }
    await closeDB();
  }
}

runReportTests();
