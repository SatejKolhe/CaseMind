const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const assert = require('node:assert');
const { ObjectId } = require('mongodb');
const { connectDB, getDB, closeDB } = require('../src/config/db');
const app = require('../src/server');

async function runTests() {
  console.log('[Test Suite] Starting Case API automated verification...');
  let server;
  let testCaseId = null;

  try {
    // 1. Establish DB connection
    console.log('[Test 1] Connecting to MongoDB...');
    const db = await connectDB();
    assert.ok(db, 'Database reference should be defined');
    console.log('  ✓ MongoDB connected successfully');

    // 2. Start server on dynamic port
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        resolve();
      });
    });
    const port = server.address().port;
    const baseUrl = `http://localhost:${port}`;
    console.log(`  ✓ Express server listening on ephemeral port ${port}`);

    // 3. Test GET /health
    console.log('[Test 2] Testing GET /health...');
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.strictEqual(healthRes.status, 200, 'Health endpoint should return 200');
    const healthData = await healthRes.json();
    assert.strictEqual(healthData.status, 'ok');
    assert.strictEqual(healthData.database, 'connected');
    console.log('  ✓ GET /health verified');

    // 4. Test POST /api/cases - Missing Title Validation
    console.log('[Test 3] Testing POST /api/cases validation (missing title)...');
    const invalidPost1 = await fetch(`${baseUrl}/api/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Case without a title' }),
    });
    assert.strictEqual(invalidPost1.status, 400);
    const invalidPost1Data = await invalidPost1.json();
    assert.strictEqual(invalidPost1Data.success, false);
    assert.strictEqual(invalidPost1Data.error.code, 'VALIDATION_ERROR');
    console.log('  ✓ Missing title rejected with 400 VALIDATION_ERROR');

    // 5. Test POST /api/cases - Empty Title Validation
    console.log('[Test 4] Testing POST /api/cases validation (empty title)...');
    const invalidPost2 = await fetch(`${baseUrl}/api/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    });
    assert.strictEqual(invalidPost2.status, 400);
    const invalidPost2Data = await invalidPost2.json();
    assert.strictEqual(invalidPost2Data.success, false);
    assert.strictEqual(invalidPost2Data.error.code, 'VALIDATION_ERROR');
    console.log('  ✓ Empty whitespace title rejected with 400 VALIDATION_ERROR');

    // 6. Test POST /api/cases - Successful creation
    console.log('[Test 5] Testing POST /api/cases successful creation...');
    const createRes = await fetch(`${baseUrl}/api/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'The Automated Verification Heist',
        description: 'Synthetic test case created during verification.',
      }),
    });
    assert.strictEqual(createRes.status, 201);
    const createData = await createRes.json();
    assert.strictEqual(createData.success, true);
    assert.ok(createData.data._id, 'Created case must have an _id string');
    assert.strictEqual(typeof createData.data._id, 'string');
    assert.strictEqual(createData.data.title, 'The Automated Verification Heist');
    assert.strictEqual(createData.data.status, 'open');
    assert.ok(createData.data.createdAt, 'Should contain createdAt ISO string');
    assert.ok(createData.data.updatedAt, 'Should contain updatedAt ISO string');
    testCaseId = createData.data._id;
    console.log(`  ✓ Case created successfully with ID: ${testCaseId}`);

    // 7. Test GET /api/cases
    console.log('[Test 6] Testing GET /api/cases...');
    const listRes = await fetch(`${baseUrl}/api/cases`);
    assert.strictEqual(listRes.status, 200);
    const listData = await listRes.json();
    assert.strictEqual(listData.success, true);
    assert.ok(Array.isArray(listData.data), 'Cases data must be an array');
    const foundCreated = listData.data.some((c) => c._id === testCaseId);
    assert.ok(foundCreated, 'Newly created case must appear in the list');
    console.log(`  ✓ GET /api/cases returned ${listData.data.length} case(s), including new case`);

    // 8. Test GET /api/cases/:caseId with invalid format
    console.log('[Test 7] Testing GET /api/cases/:caseId with invalid format...');
    const invalidIdRes = await fetch(`${baseUrl}/api/cases/invalid-id-123`);
    assert.strictEqual(invalidIdRes.status, 400);
    const invalidIdData = await invalidIdRes.json();
    assert.strictEqual(invalidIdData.success, false);
    assert.strictEqual(invalidIdData.error.code, 'INVALID_ID_FORMAT');
    console.log('  ✓ Invalid ID format rejected with 400 INVALID_ID_FORMAT');

    // 9. Test GET /api/cases/:caseId with nonexistent valid ObjectId
    console.log('[Test 8] Testing GET /api/cases/:caseId with nonexistent ObjectId...');
    const nonExistentId = '000000000000000000000000';
    const notFoundRes = await fetch(`${baseUrl}/api/cases/${nonExistentId}`);
    assert.strictEqual(notFoundRes.status, 404);
    const notFoundData = await notFoundRes.json();
    assert.strictEqual(notFoundData.success, false);
    assert.strictEqual(notFoundData.error.code, 'CASE_NOT_FOUND');
    console.log('  ✓ Nonexistent ID rejected with 404 CASE_NOT_FOUND');

    // 10. Test GET /api/cases/:caseId with existing case
    console.log('[Test 9] Testing GET /api/cases/:caseId with existing case...');
    const getRes = await fetch(`${baseUrl}/api/cases/${testCaseId}`);
    assert.strictEqual(getRes.status, 200);
    const getData = await getRes.json();
    assert.strictEqual(getData.success, true);
    assert.strictEqual(getData.data._id, testCaseId);
    assert.strictEqual(getData.data.title, 'The Automated Verification Heist');
    assert.ok(getData.data.stats, 'Response must include stats object');
    assert.strictEqual(typeof getData.data.stats.evidenceCount, 'number');
    assert.strictEqual(typeof getData.data.stats.activeMemoriesCount, 'number');
    assert.strictEqual(typeof getData.data.stats.latestReportVersion, 'number');
    console.log('  ✓ Existing case retrieved with valid stats envelope');

    // 11. Cleanup test case from database
    if (testCaseId) {
      console.log('[Cleanup] Removing test case from database...');
      await db.collection('cases').deleteOne({ _id: new ObjectId(testCaseId) });
      console.log('  ✓ Cleaned up test case document');
    }

    console.log('\n========================================');
    console.log(' ALL CASE API TESTS PASSED SUCCESSFULLY! ');
    console.log('========================================\n');
  } catch (err) {
    console.error('\n❌ Test Failure:', err);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }
    await closeDB();
  }
}

runTests();
