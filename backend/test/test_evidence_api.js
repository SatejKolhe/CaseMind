const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const assert = require('node:assert');
const { ObjectId } = require('mongodb');
const { connectDB, getDB, closeDB } = require('../src/config/db');
const app = require('../src/server');

async function runEvidenceTests() {
  console.log('[Test Suite] Starting Evidence API automated verification...');
  let server;
  let testCaseId = null;

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

    // 3. Create a test case to anchor evidence items
    console.log('[Setup] Creating parent case for evidence tests...');
    const caseRes = await fetch(`${baseUrl}/api/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Evidence Verification Case',
        description: 'Temporary case created to test evidence ingestion.',
      }),
    });
    assert.strictEqual(caseRes.status, 201);
    const caseData = await caseRes.json();
    testCaseId = caseData.data._id;
    console.log(`  ✓ Parent case created with ID: ${testCaseId}`);

    // 4. Test Invalid caseId format (400)
    console.log('[Test 2] Testing POST evidence with invalid caseId format...');
    const invalidIdRes = await fetch(`${baseUrl}/api/cases/invalid-id-xyz/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Sensor Log',
        content: 'Telemetry record',
        source: 'Sensor Unit 1',
        sourceType: 'digital',
        verificationStatus: 'verified',
        occurredAt: new Date().toISOString(),
      }),
    });
    assert.strictEqual(invalidIdRes.status, 400);
    const invalidIdData = await invalidIdRes.json();
    assert.strictEqual(invalidIdData.success, false);
    assert.strictEqual(invalidIdData.error.code, 'INVALID_ID_FORMAT');
    console.log('  ✓ Invalid caseId format rejected with 400 INVALID_ID_FORMAT');

    // 5. Test Nonexistent caseId (404)
    console.log('[Test 3] Testing POST evidence with nonexistent caseId...');
    const nonExistentCaseId = '000000000000000000000000';
    const notFoundRes = await fetch(`${baseUrl}/api/cases/${nonExistentCaseId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Sensor Log',
        content: 'Telemetry record',
        source: 'Sensor Unit 1',
        sourceType: 'digital',
        verificationStatus: 'verified',
        occurredAt: new Date().toISOString(),
      }),
    });
    assert.strictEqual(notFoundRes.status, 404);
    const notFoundData = await notFoundRes.json();
    assert.strictEqual(notFoundData.success, false);
    assert.strictEqual(notFoundData.error.code, 'CASE_NOT_FOUND');
    console.log('  ✓ Nonexistent caseId rejected with 404 CASE_NOT_FOUND');

    // 6. Test Missing required fields (400)
    console.log('[Test 4] Testing POST evidence with missing required fields...');
    const missingTitleRes = await fetch(`${baseUrl}/api/cases/${testCaseId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Telemetry record',
        source: 'Sensor Unit 1',
        sourceType: 'digital',
        verificationStatus: 'verified',
        occurredAt: new Date().toISOString(),
      }),
    });
    assert.strictEqual(missingTitleRes.status, 400);
    const missingTitleData = await missingTitleRes.json();
    assert.strictEqual(missingTitleData.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(missingTitleData.error.details.field, 'title');
    console.log('  ✓ Missing title rejected with 400 VALIDATION_ERROR');

    const missingOccurredAtRes = await fetch(`${baseUrl}/api/cases/${testCaseId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Security Sensor',
        content: 'Telemetry record',
        source: 'Sensor Unit 1',
        sourceType: 'digital',
        verificationStatus: 'verified',
        occurredAt: 'not-a-valid-date',
      }),
    });
    assert.strictEqual(missingOccurredAtRes.status, 400);
    const missingOccurredAtData = await missingOccurredAtRes.json();
    assert.strictEqual(missingOccurredAtData.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(missingOccurredAtData.error.details.field, 'occurredAt');
    console.log('  ✓ Invalid occurredAt rejected with 400 VALIDATION_ERROR');

    // 7. Test Invalid sourceType enum (400)
    console.log('[Test 5] Testing POST evidence with invalid sourceType...');
    const invalidSourceTypeRes = await fetch(`${baseUrl}/api/cases/${testCaseId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Unknown Sighting',
        content: 'Saw something',
        source: 'Anonymous',
        sourceType: 'telepathic', // Invalid enum
        verificationStatus: 'unverified',
        occurredAt: new Date().toISOString(),
      }),
    });
    assert.strictEqual(invalidSourceTypeRes.status, 400);
    const invalidSourceTypeData = await invalidSourceTypeRes.json();
    assert.strictEqual(invalidSourceTypeData.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(invalidSourceTypeData.error.details.field, 'sourceType');
    console.log('  ✓ Invalid sourceType rejected with 400 VALIDATION_ERROR');

    // 8. Test Invalid verificationStatus enum (400)
    console.log('[Test 6] Testing POST evidence with invalid verificationStatus...');
    const invalidStatusRes = await fetch(`${baseUrl}/api/cases/${testCaseId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Witness Statement',
        content: 'Saw something',
        source: 'Marcus Vance',
        sourceType: 'witness',
        verificationStatus: 'probable', // Invalid enum
        occurredAt: new Date().toISOString(),
      }),
    });
    assert.strictEqual(invalidStatusRes.status, 400);
    const invalidStatusData = await invalidStatusRes.json();
    assert.strictEqual(invalidStatusData.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(invalidStatusData.error.details.field, 'verificationStatus');
    console.log('  ✓ Invalid verificationStatus rejected with 400 VALIDATION_ERROR');

    // 9. Test Successful Evidence Creation (Sequential EV-01, EV-02)
    console.log('[Test 7] Testing Successful Sequential Evidence Creation...');
    const t1 = '2026-10-30T21:42:10.000Z';
    const t2 = '2026-10-30T21:55:00.000Z';

    const ev1Res = await fetch(`${baseUrl}/api/cases/${testCaseId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Display Case Tamper Sensor Log',
        content: 'Pressure sensor dropped to 0kg at 21:42:10.',
        source: 'Telemetry Server Log #81',
        sourceType: 'digital',
        verificationStatus: 'verified',
        occurredAt: t1,
      }),
    });
    assert.strictEqual(ev1Res.status, 201);
    const ev1Data = await ev1Res.json();
    assert.strictEqual(ev1Data.success, true);
    assert.strictEqual(ev1Data.data.evidenceCode, 'EV-01', 'First evidence must receive EV-01');
    assert.strictEqual(ev1Data.data.caseId, testCaseId);
    assert.strictEqual(ev1Data.data.sourceType, 'digital');
    assert.strictEqual(ev1Data.data.verificationStatus, 'verified');
    assert.strictEqual(ev1Data.data.occurredAt, t1);
    console.log(`  ✓ EV-01 created: ${ev1Data.data._id}`);

    const ev2Res = await fetch(`${baseUrl}/api/cases/${testCaseId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Catering Staff Statement',
        content: 'Server Clara Bell states statue present at 21:55.',
        source: 'Witness Interview #1',
        sourceType: 'witness',
        verificationStatus: 'unverified',
        occurredAt: t2,
      }),
    });
    assert.strictEqual(ev2Res.status, 201);
    const ev2Data = await ev2Res.json();
    assert.strictEqual(ev2Data.success, true);
    assert.strictEqual(ev2Data.data.evidenceCode, 'EV-02', 'Second evidence must receive EV-02');
    console.log(`  ✓ EV-02 created: ${ev2Data.data._id}`);

    // 10. Test Chronological Evidence Retrieval (GET /api/cases/:caseId/evidence)
    console.log('[Test 8] Testing Chronological Evidence Retrieval...');
    // Ingest a third piece of evidence that occurred BEFORE t1 (e.g. 21:00:00)
    const t0 = '2026-10-30T21:00:00.000Z';
    const ev3Res = await fetch(`${baseUrl}/api/cases/${testCaseId}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Gallery Front Gate Opening',
        content: 'Main foyer doors opened for private gala guests.',
        source: 'Access Console Log #12',
        sourceType: 'document',
        verificationStatus: 'verified',
        occurredAt: t0,
      }),
    });
    assert.strictEqual(ev3Res.status, 201);
    const ev3Data = await ev3Res.json();
    assert.strictEqual(ev3Data.data.evidenceCode, 'EV-03', 'Sequential code should be EV-03');

    // Query evidence list
    const getEvListRes = await fetch(`${baseUrl}/api/cases/${testCaseId}/evidence`);
    assert.strictEqual(getEvListRes.status, 200);
    const getEvListData = await getEvListRes.json();
    assert.strictEqual(getEvListData.success, true);
    assert.strictEqual(getEvListData.data.length, 3);

    // Verify chronological order by occurredAt ascending: t0 (21:00) -> t1 (21:42) -> t2 (21:55)
    assert.strictEqual(getEvListData.data[0].evidenceCode, 'EV-03', 'EV-03 (21:00) should be first');
    assert.strictEqual(getEvListData.data[1].evidenceCode, 'EV-01', 'EV-01 (21:42) should be second');
    assert.strictEqual(getEvListData.data[2].evidenceCode, 'EV-02', 'EV-02 (21:55) should be third');
    console.log('  ✓ Evidence list returned in correct chronological order by occurredAt ascending');

    // 11. Test Concurrent Evidence Submissions
    console.log('[Test 9] Testing Concurrent Evidence Submissions...');
    const concurrentPayloads = [
      { title: 'Concurrent Item A', content: 'Desc A', source: 'A', sourceType: 'cctv', verificationStatus: 'verified', occurredAt: '2026-10-30T22:01:00.000Z' },
      { title: 'Concurrent Item B', content: 'Desc B', source: 'B', sourceType: 'witness', verificationStatus: 'unverified', occurredAt: '2026-10-30T22:02:00.000Z' },
      { title: 'Concurrent Item C', content: 'Desc C', source: 'C', sourceType: 'physical', verificationStatus: 'verified', occurredAt: '2026-10-30T22:03:00.000Z' },
      { title: 'Concurrent Item D', content: 'Desc D', source: 'D', sourceType: 'digital', verificationStatus: 'disputed', occurredAt: '2026-10-30T22:04:00.000Z' },
    ];

    const concurrentResponses = await Promise.all(
      concurrentPayloads.map((payload) =>
        fetch(`${baseUrl}/api/cases/${testCaseId}/evidence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      )
    );

    // All concurrent requests must succeed with 201 Created
    for (const res of concurrentResponses) {
      assert.strictEqual(res.status, 201, 'Concurrent evidence submission should return 201');
    }

    const concurrentDataList = await Promise.all(concurrentResponses.map((r) => r.json()));
    const assignedCodes = concurrentDataList.map((d) => d.data.evidenceCode);

    // Verify all assigned codes are unique
    const uniqueCodes = new Set(assignedCodes);
    assert.strictEqual(uniqueCodes.size, concurrentPayloads.length, 'Every concurrent item must receive a unique evidenceCode');

    // Expected codes EV-04, EV-05, EV-06, EV-07
    const expectedCodes = ['EV-04', 'EV-05', 'EV-06', 'EV-07'];
    for (const exp of expectedCodes) {
      assert.ok(uniqueCodes.has(exp), `Expected code ${exp} to be allocated`);
    }
    console.log(`  ✓ Concurrent submissions allocated unique codes: ${Array.from(uniqueCodes).sort().join(', ')}`);

    // 12. Verify Case stats reflects correct evidence count
    console.log('[Test 10] Verifying GET /api/cases/:caseId stats reflects evidenceCount...');
    const caseDetailsRes = await fetch(`${baseUrl}/api/cases/${testCaseId}`);
    assert.strictEqual(caseDetailsRes.status, 200);
    const caseDetailsData = await caseDetailsRes.json();
    assert.strictEqual(caseDetailsData.data.stats.evidenceCount, 7, 'Case stats should report exactly 7 evidence items');
    console.log('  ✓ Case stats evidenceCount accurately updated to 7');

    // 13. Cleanup test documents from database
    if (testCaseId) {
      console.log('[Cleanup] Cleaning up test case and associated evidence records...');
      const objId = new ObjectId(testCaseId);
      await db.collection('evidence').deleteMany({ caseId: objId });
      await db.collection('cases').deleteOne({ _id: objId });
      console.log('  ✓ Cleaned up test data');
    }

    console.log('\n============================================');
    console.log(' ALL EVIDENCE API TESTS PASSED SUCCESSFULLY! ');
    console.log('============================================\n');
  } catch (err) {
    console.error('\n❌ Evidence Test Failure:', err);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }
    await closeDB();
  }
}

runEvidenceTests();
