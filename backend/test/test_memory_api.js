const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const assert = require('node:assert');
const { ObjectId } = require('mongodb');
const { connectDB, getDB, closeDB } = require('../src/config/db');
const app = require('../src/server');

async function runMemoryTests() {
  console.log('[Test Suite] Starting Memory Retrieval API automated verification...');
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
        title: 'Case A - Main Memory Test',
        description: 'Case A for memory isolation testing',
      }),
    });
    const caseAData = await caseARes.json();
    caseAId = caseAData.data._id;

    const caseBRes = await fetch(`${baseUrl}/api/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Case B - Isolated Memory Test',
        description: 'Case B to test cross-case leakage prevention',
      }),
    });
    const caseBData = await caseBRes.json();
    caseBId = caseBData.data._id;
    console.log(`  ✓ Created Case A (${caseAId}) and Case B (${caseBId})`);

    // 4. Test Empty Memory Results
    console.log('[Test 2] Testing empty memory results for fresh case...');
    const emptyRes = await fetch(`${baseUrl}/api/cases/${caseAId}/memories`);
    assert.strictEqual(emptyRes.status, 200);
    const emptyData = await emptyRes.json();
    assert.strictEqual(emptyData.success, true);
    assert.ok(Array.isArray(emptyData.data));
    assert.strictEqual(emptyData.data.length, 0);
    console.log('  ✓ Fresh case returns empty data array []');

    // 5. Test Invalid caseId format (400)
    console.log('[Test 3] Testing GET memories with invalid caseId format...');
    const invalidIdRes = await fetch(`${baseUrl}/api/cases/invalid-case-id-123/memories`);
    assert.strictEqual(invalidIdRes.status, 400);
    const invalidIdData = await invalidIdRes.json();
    assert.strictEqual(invalidIdData.success, false);
    assert.strictEqual(invalidIdData.error.code, 'INVALID_ID_FORMAT');
    console.log('  ✓ Invalid caseId format rejected with 400 INVALID_ID_FORMAT');

    // 6. Test Nonexistent caseId (404)
    console.log('[Test 4] Testing GET memories with nonexistent caseId...');
    const nonExistentCaseId = '000000000000000000000000';
    const notFoundRes = await fetch(`${baseUrl}/api/cases/${nonExistentCaseId}/memories`);
    assert.strictEqual(notFoundRes.status, 404);
    const notFoundData = await notFoundRes.json();
    assert.strictEqual(notFoundData.success, false);
    assert.strictEqual(notFoundData.error.code, 'CASE_NOT_FOUND');
    console.log('  ✓ Nonexistent caseId rejected with 404 CASE_NOT_FOUND');

    // 7. Test Invalid status query value (400)
    console.log('[Test 5] Testing GET memories with invalid status value...');
    const invalidStatusRes = await fetch(`${baseUrl}/api/cases/${caseAId}/memories?status=destroyed`);
    assert.strictEqual(invalidStatusRes.status, 400);
    const invalidStatusData = await invalidStatusRes.json();
    assert.strictEqual(invalidStatusData.success, false);
    assert.strictEqual(invalidStatusData.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(invalidStatusData.error.details.field, 'status');
    console.log('  ✓ Invalid status rejected with 400 VALIDATION_ERROR');

    // 8. Seed synthetic memory documents directly in MongoDB
    console.log('[Setup] Seeding memory documents for Case A and Case B...');
    const now = new Date();
    const caseAObjectId = new ObjectId(caseAId);
    const caseBObjectId = new ObjectId(caseBId);

    await db.collection('memories').insertMany([
      // Case A Memories
      {
        caseId: caseAObjectId,
        category: 'fact',
        statement: 'Pedestal pressure sensor dropped to 0kg at 21:42:10.',
        supportingEvidenceCodes: ['EV-01'],
        status: 'active',
        lastUpdatedInVersion: 1,
        changeReason: 'Initialized from EV-01 telemetry log.',
        createdAt: new Date('2026-10-31T01:00:00Z'),
        updatedAt: new Date('2026-10-31T01:00:00Z'),
      },
      {
        caseId: caseAObjectId,
        category: 'claim',
        statement: 'Server Clara Bell saw statue in place at 21:55.',
        source: 'Server Clara Bell interview',
        supportingEvidenceCodes: ['EV-02'],
        status: 'active',
        lastUpdatedInVersion: 2,
        changeReason: 'Ingested witness statement EV-02.',
        createdAt: new Date('2026-10-31T01:05:00Z'),
        updatedAt: new Date('2026-10-31T01:05:00Z'),
      },
      {
        caseId: caseAObjectId,
        category: 'open_question',
        statement: 'Was there any electrical anomaly during the gala?',
        supportingEvidenceCodes: [],
        status: 'resolved',
        lastUpdatedInVersion: 2,
        changeReason: 'Answered by EV-03 power surge log.',
        createdAt: new Date('2026-10-31T01:06:00Z'),
        updatedAt: new Date('2026-10-31T01:10:00Z'),
      },
      {
        caseId: caseAObjectId,
        category: 'hypothesis',
        statement: 'Statue removed at 21:42 with no technical anomalies.',
        supportingEvidenceCodes: ['EV-01'],
        hypothesisDetails: {
          hypothesisId: 'H-1',
          title: 'Direct Early Theft',
          rationale: 'Telemetry showed immediate zero-reading.',
          unresolvedPoints: ['Did not account for power surge.'],
        },
        status: 'superseded',
        lastUpdatedInVersion: 2,
        changeReason: 'Superseded after discovery of power surge EV-03.',
        createdAt: new Date('2026-10-31T01:07:00Z'),
        updatedAt: new Date('2026-10-31T01:12:00Z'),
      },

      // Case B Memory (Must NEVER be returned when querying Case A)
      {
        caseId: caseBObjectId,
        category: 'fact',
        statement: 'CONFIDENTIAL: Case B isolated fact that must not leak.',
        supportingEvidenceCodes: ['EV-99'],
        status: 'active',
        lastUpdatedInVersion: 1,
        changeReason: 'Private Case B intelligence.',
        createdAt: new Date('2026-10-31T01:15:00Z'),
        updatedAt: new Date('2026-10-31T01:15:00Z'),
      },
    ]);
    console.log('  ✓ Seeded 4 memories for Case A (2 active, 1 resolved, 1 superseded) and 1 for Case B');

    // 9. Test default status filter (?status omitted -> defaults to 'active')
    console.log('[Test 6] Testing default status filter (defaults to active)...');
    const defaultRes = await fetch(`${baseUrl}/api/cases/${caseAId}/memories`);
    assert.strictEqual(defaultRes.status, 200);
    const defaultData = await defaultRes.json();
    assert.strictEqual(defaultData.success, true);
    assert.strictEqual(defaultData.data.length, 2, 'Default filter should return exactly the 2 active memories');
    assert.ok(defaultData.data.every((m) => m.status === 'active'), 'All returned memories must have status active');
    console.log('  ✓ Default query returns only active memories');

    // 10. Test explicit filtering by status=resolved
    console.log('[Test 7] Testing filtering by status=resolved...');
    const resolvedRes = await fetch(`${baseUrl}/api/cases/${caseAId}/memories?status=resolved`);
    assert.strictEqual(resolvedRes.status, 200);
    const resolvedData = await resolvedRes.json();
    assert.strictEqual(resolvedData.data.length, 1);
    assert.strictEqual(resolvedData.data[0].category, 'open_question');
    assert.strictEqual(resolvedData.data[0].status, 'resolved');
    console.log('  ✓ Filtering status=resolved returned exactly 1 resolved memory');

    // 11. Test explicit filtering by status=superseded
    console.log('[Test 8] Testing filtering by status=superseded...');
    const supersededRes = await fetch(`${baseUrl}/api/cases/${caseAId}/memories?status=superseded`);
    assert.strictEqual(supersededRes.status, 200);
    const supersededData = await supersededRes.json();
    assert.strictEqual(supersededData.data.length, 1);
    assert.strictEqual(supersededData.data[0].category, 'hypothesis');
    assert.strictEqual(supersededData.data[0].status, 'superseded');
    assert.ok(supersededData.data[0].hypothesisDetails, 'Should serialize hypothesisDetails');
    console.log('  ✓ Filtering status=superseded returned exactly 1 superseded memory with hypothesisDetails');

    // 12. Test filtering by status=all
    console.log('[Test 9] Testing filtering by status=all...');
    const allRes = await fetch(`${baseUrl}/api/cases/${caseAId}/memories?status=all`);
    assert.strictEqual(allRes.status, 200);
    const allData = await allRes.json();
    assert.strictEqual(allData.data.length, 4, 'status=all should return all 4 memories of Case A');
    console.log('  ✓ Filtering status=all returned all 4 Case A memories');

    // 13. Test Case Isolation: Case B memories NEVER returned for Case A
    console.log('[Test 10] Testing Case Isolation between Case A and Case B...');
    const caseBLeakCheck = allData.data.some(
      (m) => m.statement.includes('CONFIDENTIAL') || m.caseId === caseBId
    );
    assert.strictEqual(caseBLeakCheck, false, 'Case B memories must NEVER leak into Case A query');

    const caseBQueryRes = await fetch(`${baseUrl}/api/cases/${caseBId}/memories`);
    assert.strictEqual(caseBQueryRes.status, 200);
    const caseBQueryData = await caseBQueryRes.json();
    assert.strictEqual(caseBQueryData.data.length, 1);
    assert.strictEqual(caseBQueryData.data[0].caseId, caseBId);
    assert.ok(caseBQueryData.data[0].statement.includes('CONFIDENTIAL'));
    console.log('  ✓ Strict case isolation verified: Case B memories completely isolated');

    // 14. Verify Case Stats Integration
    console.log('[Test 11] Verifying GET /api/cases/:caseId stats reflects activeMemoriesCount...');
    const caseStatsRes = await fetch(`${baseUrl}/api/cases/${caseAId}`);
    assert.strictEqual(caseStatsRes.status, 200);
    const caseStatsData = await caseStatsRes.json();
    assert.strictEqual(caseStatsData.data.stats.activeMemoriesCount, 2, 'Should reflect 2 active memories in stats');
    console.log('  ✓ Case stats activeMemoriesCount accurately reports 2');

    // 15. Cleanup synthetic test data
    console.log('[Cleanup] Cleaning up test cases and memory documents...');
    await db.collection('memories').deleteMany({
      caseId: { $in: [caseAObjectId, caseBObjectId] },
    });
    await db.collection('cases').deleteMany({
      _id: { $in: [caseAObjectId, caseBObjectId] },
    });
    console.log('  ✓ Cleaned up all test documents');

    console.log('\n==========================================');
    console.log(' ALL MEMORY API TESTS PASSED SUCCESSFULLY! ');
    console.log('==========================================\n');
  } catch (err) {
    console.error('\n❌ Memory Test Failure:', err);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }
    await closeDB();
  }
}

runMemoryTests();
