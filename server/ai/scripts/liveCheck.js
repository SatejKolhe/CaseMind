/**
 * CaseMind Live Check Script (scripts/liveCheck.js)
 *
 * Runs against the running server and real Atlas:
 * 1. Creates a new case via the API
 * 2. Posts three clues given as command-line arguments (with realistic defaults)
 * 3. Triggers evidence analysis via the API
 * 4. Prints each API response
 * 5. Queries the DB directly to confirm evidence, memories, and report versions exist
 *
 * Usage:
 *   node server/ai/scripts/liveCheck.js ["Clue 1 text"] ["Clue 2 text"] ["Clue 3 text"]
 */

const path = require('path');
const http = require('http');
const https = require('https');

// Load environment configuration safely
try {
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(path.resolve(__dirname, '../.env'));
    } catch (_) {}
    try {
      process.loadEnvFile(path.resolve(__dirname, '../../../backend/.env'));
    } catch (_) {}
  }
} catch (_) {}

const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.API_BASE_URL || `http://localhost:${PORT}`;

// 3 Default investigation clues if none provided via command line
const DEFAULT_CLUES = [
  'A security keycard registered to technician #1042 was swiped at the second floor server vault at 23:14.',
  'CCTV camera #4 footage at 23:15 captures an individual in a blue uniform carrying a black hardcase leaving the server vault.',
  'Human Resources shift records indicate technician #1042 was on approved leave and off-site during that week.',
];

/**
 * Lightweight HTTP request helper returning parsed JSON and status.
 */
function apiRequest(urlStr, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const transport = url.protocol === 'https:' ? https : http;

    const postData = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        Accept: 'application/json',
        ...(postData
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData),
            }
          : {}),
      },
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed,
        });
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(15000, () => {
      req.destroy(new Error(`Request timed out after 15000ms: ${urlStr}`));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Connects to MongoDB Atlas using backend config or direct client.
 */
async function getMongoConnection() {
  let dbModule = null;
  try {
    dbModule = require('../../../backend/src/config/db');
  } catch (_) {
    try {
      dbModule = require('../../backend/src/config/db');
    } catch (_) {}
  }

  if (dbModule && typeof dbModule.connectDB === 'function') {
    return await dbModule.connectDB();
  }

  const { MongoClient } = require('mongodb');
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not defined.');
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  return client.db(process.env.DB_NAME || 'casemind');
}

async function runLiveCheck() {
  console.log('================================================================================');
  console.log('                     CASEMIND LIVE CHECK VERIFICATION                           ');
  console.log('================================================================================');
  console.log(`[Config] Target API: ${BASE_URL}`);

  // Retrieve 3 clues from CLI or defaults
  const args = process.argv.slice(2).filter(Boolean);
  const clues = [
    args[0] || DEFAULT_CLUES[0],
    args[1] || DEFAULT_CLUES[1],
    args[2] || DEFAULT_CLUES[2],
  ];

  console.log('\n[Input Clues for Analysis]:');
  clues.forEach((c, idx) => console.log(`  Clue ${idx + 1}: "${c}"`));

  // 1. Preflight check: Server health
  console.log('\n--------------------------------------------------------------------------------');
  console.log('[Step 1/5] Checking Server Availability at /health...');
  let healthOk = false;
  try {
    const healthRes = await apiRequest(`${BASE_URL}/health`);
    console.log(`[Health Response] HTTP ${healthRes.status}:`, JSON.stringify(healthRes.data, null, 2));
    if (healthRes.status === 200 && healthRes.data && healthRes.data.status === 'ok') {
      healthOk = true;
    }
  } catch (err) {
    console.error(`[Health Check Failed] Server is unreachable at ${BASE_URL}: ${err.message}`);
    console.error('To run live check against a live server, ensure server is running: npm run start');
  }

  // 2. Preflight check: MongoDB Atlas
  console.log('\n--------------------------------------------------------------------------------');
  console.log('[Step 2/5] Checking MongoDB Atlas Connectivity...');
  let db = null;
  try {
    db = await getMongoConnection();
    await db.command({ ping: 1 });
    console.log('[Database] Connected and ping successful to MongoDB Atlas.');
  } catch (err) {
    console.warn(`[Database Warning] Could not connect to Atlas: ${err.message}`);
    console.warn('Note: Live check requires MONGODB_URI set to an accessible Atlas cluster.');
  }

  if (!healthOk) {
    console.log('\n================================================================================');
    console.log('                    LIVE CHECK SUMMARY: SERVER OFFLINE                          ');
    console.log('================================================================================');
    console.log('The CaseMind Express server is not currently running on ' + BASE_URL);
    console.log('To run the live check:');
    console.log('  1. Start the server: node backend/src/server.js');
    console.log('  2. In another terminal: node server/ai/scripts/liveCheck.js');
    console.log('================================================================================\n');
    return;
  }

  // 3. Create a new case via API
  console.log('\n--------------------------------------------------------------------------------');
  console.log('[Step 3/5] Creating New Fictional Case via POST /api/cases...');
  const casePayload = {
    title: `Live Verification Case - ${new Date().toISOString()}`,
    description: 'Automated live test case verifying clue intake, evidence pipeline, and DB persistence.',
  };
  const createCaseRes = await apiRequest(`${BASE_URL}/api/cases`, 'POST', casePayload);
  console.log(`[POST /api/cases] HTTP ${createCaseRes.status}:`, JSON.stringify(createCaseRes.data, null, 2));

  const caseId = createCaseRes.data && createCaseRes.data.data && createCaseRes.data.data._id;
  if (!caseId) {
    throw new Error('Case creation did not return a valid caseId. Aborting live test.');
  }
  console.log(`[Case Created] Case ID: ${caseId}`);

  // 4. Post three clues as evidence via API
  console.log('\n--------------------------------------------------------------------------------');
  console.log(`[Step 4/5] Posting 3 Clues to POST /api/cases/${caseId}/evidence...`);
  const evidenceRecords = [];

  for (let i = 0; i < clues.length; i++) {
    const clueText = clues[i];
    const evidencePayload = {
      title: `Clue Item #${i + 1}`,
      content: clueText,
      source: 'Security Dispatch',
      sourceType: i === 1 ? 'cctv' : i === 2 ? 'document' : 'digital',
      verificationStatus: 'unverified',
      occurredAt: new Date(Date.now() - (3 - i) * 3600000).toISOString(),
    };

    console.log(`\nSubmitting Clue ${i + 1}...`);
    const evRes = await apiRequest(`${BASE_URL}/api/cases/${caseId}/evidence`, 'POST', evidencePayload);
    console.log(`[POST /api/cases/${caseId}/evidence] HTTP ${evRes.status}:`, JSON.stringify(evRes.data, null, 2));

    const evidenceData = evRes.data && evRes.data.data;
    if (evidenceData) {
      evidenceRecords.push(evidenceData);

      // Attempt AI Analysis on the newly submitted evidence
      const evId = evidenceData._id;
      console.log(`Triggering Analysis for Evidence ${evidenceData.evidenceCode} (${evId})...`);
      try {
        const analyzeRes = await apiRequest(
          `${BASE_URL}/api/cases/${caseId}/evidence/${evId}/analyze?memory=on`,
          'POST'
        );
        console.log(`[POST analyze] HTTP ${analyzeRes.status}:`, JSON.stringify(analyzeRes.data, null, 2));
      } catch (analyzeErr) {
        console.warn(`[POST analyze notice] ${analyzeErr.message}`);
      }
    }
  }

  // 5. Query Atlas database to verify records
  console.log('\n--------------------------------------------------------------------------------');
  console.log('[Step 5/5] Querying MongoDB Atlas Directly to Confirm State...');
  if (db) {
    const { ObjectId } = require('mongodb');
    const caseObjectId = new ObjectId(caseId);

    // Query Evidence collection
    const dbEvidence = await db.collection('evidence').find({ caseId: caseObjectId }).toArray();
    console.log(`\n[DB: Evidence Collection] Found ${dbEvidence.length} items for case:`);
    dbEvidence.forEach((doc) => {
      console.log(`  - Code: ${doc.evidenceCode} | Title: "${doc.title}" | Status: ${doc.verificationStatus}`);
    });

    // Query Memories collection
    const dbMemories = await db.collection('memories').find({ caseId: caseObjectId }).toArray();
    console.log(`\n[DB: Memories Collection] Found ${dbMemories.length} working memories for case:`);
    dbMemories.forEach((doc) => {
      console.log(`  - Category: ${doc.category} | Status: ${doc.status} | Statement: "${doc.statement}"`);
    });

    // Query Reports collection
    const dbReports = await db.collection('reports').find({ caseId: caseObjectId }).sort({ version: 1 }).toArray();
    console.log(`\n[DB: Reports Collection] Found ${dbReports.length} report versions for case:`);
    dbReports.forEach((doc) => {
      console.log(`  - Version: ${doc.version} | Trigger: ${doc.triggerEvidenceCode || 'N/A'} | Summary: "${doc.summary || ''}"`);
    });
  } else {
    console.log('[DB Query Skipped] Database connection was not established.');
  }

  console.log('\n================================================================================');
  console.log('                         LIVE CHECK COMPLETE                                    ');
  console.log('================================================================================\n');
}

if (require.main === module) {
  runLiveCheck().catch((err) => {
    console.error(`\n[Live Check Error] ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  runLiveCheck,
};
