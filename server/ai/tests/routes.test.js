const assert = require('assert');
const http = require('http');
const express = require('express');
const router = require('../routes');
const { startupCheck } = require('../startupCheck');

/**
 * Sends a real HTTP request to the ephemeral test server.
 */
function apiRequest(server, method, path, body = null) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed = data;
          try {
            parsed = JSON.parse(data);
          } catch (_) {}
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runRoutesTests() {
  console.log('--- Testing server/ai/routes.js and startupCheck.js ---');

  const app = express();
  app.use(express.json());
  // Mount routes at /api/cases
  app.use('/api/cases', router);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // Setup mock deps for route testing
    const mockDeps = {
      getEvidence: async (caseId, evidenceId) => {
        if (evidenceId === 'ev-missing') return null;
        return {
          _id: evidenceId,
          evidenceCode: 'EV-01',
          title: 'Badge Record',
          content: 'Badge 1042 was scanned at 22:15 at server door.',
          verificationStatus: 'verified',
        };
      },
      getContext: async () => ({
        recentEvidence: [],
        memories: [],
      }),
      llmCall: async () => ({
        report: {
          knownFacts: [{ statement: 'Badge 1042 used at server door', evidenceIds: ['EV-01'], basis: 'Log' }],
          unverifiedClaims: [],
          evidenceConnections: [],
          contradictions: [],
          hypotheses: [],
          openQuestions: [],
          suggestedNextChecks: [],
          memoryUpdates: [],
        },
        memoryProposals: [],
      }),
      setAnalysisStatus: async () => {},
    };

    router.setDeps(mockDeps);

    // Test 1: POST /api/cases/:caseId/intake returns candidates; nothing saved
    console.log('Test 1: POST /api/cases/:caseId/intake returns atomic candidates without saving');
    {
      const res = await apiRequest(server, 'POST', '/api/cases/case-123/intake', {
        rawText: 'Witness says: John was at the lobby at 10:00 AM. Another worker saw the vault open at 10:15 AM.',
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.data.candidates));
      assert.ok(res.body.data.candidates.length >= 2);
      assert.ok(res.body.data.notice.includes('Nothing has been saved'));
      console.log(`  Passed: Intake returned ${res.body.data.candidates.length} candidates with confirmation notice.`);
    }

    // Test 2: POST /api/cases/:caseId/evidence/:evidenceId/analyze
    console.log('Test 2: POST /api/cases/:caseId/evidence/:evidenceId/analyze');
    {
      const res = await apiRequest(server, 'POST', '/api/cases/case-123/evidence/ev-1/analyze?memory=on');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, 'ok');
      assert.ok(res.body.data.report);
      assert.strictEqual(res.body.data.changeSummary, null);
      console.log('  Passed: Analysis endpoint returned 200 with verified report.');
    }

    // Test 3: POST /api/cases/:caseId/evidence/:evidenceId/reanalyze
    console.log('Test 3: POST /api/cases/:caseId/evidence/:evidenceId/reanalyze');
    {
      const res = await apiRequest(server, 'POST', '/api/cases/case-123/evidence/ev-1/reanalyze');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.status, 'ok');
      console.log('  Passed: Reanalyze endpoint returned 200.');
    }

    // Test 4: GET /api/cases/:caseId/evidence/:evidenceId/analysis-status
    console.log('Test 4: GET /api/cases/:caseId/evidence/:evidenceId/analysis-status');
    {
      const res = await apiRequest(server, 'GET', '/api/cases/case-123/evidence/ev-1/analysis-status');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.caseId, 'case-123');
      assert.strictEqual(res.body.data.evidenceId, 'ev-1');
      console.log('  Passed: Analysis status endpoint returned 200.');
    }

    // Test 5: Startup check refuses to start if DB connectivity is missing
    console.log('Test 5: Startup check validation and refusal when missing prerequisites');
    {
      // Test checkDb=false (AI config only)
      const aiOnlyResult = await startupCheck({ checkDb: false });
      assert.strictEqual(aiOnlyResult.status, 'ready');
      console.log('  Passed: AI configuration valid.');

      // Test checkDb=true when MONGODB_URI is absent -> must refuse to start
      const originalUri = process.env.MONGODB_URI;
      delete process.env.MONGODB_URI;

      let threw = false;
      try {
        await startupCheck({ checkDb: true });
      } catch (err) {
        threw = true;
        assert.ok(err.message.includes('REFUSAL TO START'));
        assert.ok(err.message.includes('MONGODB_URI'));
      } finally {
        if (originalUri) process.env.MONGODB_URI = originalUri;
      }

      assert.ok(threw, 'startupCheck must throw clear refusal message when MONGODB_URI is missing');
      console.log('  Passed: Startup check properly refuses to start with clear diagnostic message.');
    }

    console.log('--- All routes & startupCheck tests PASSED! ---');
  } finally {
    server.close();
  }
}

runRoutesTests().catch((err) => {
  console.error('Routes Test Suite Failed:', err);
  process.exitCode = 1;
});
