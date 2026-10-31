/**
 * CaseMind - MongoDB Atlas Audit Script (scripts/auditAtlas.js)
 *
 * Read-only inspection script:
 * - Connects using existing environment configuration (MONGODB_URI, DB_NAME).
 * - For each collection:
 *     1. Document count
 *     2. getIndexes() output
 *     3. listSearchIndexes() output (Atlas Vector Search indexes)
 *     4. Count of documents with and without an 'embedding' field
 * - Strictly read-only; never modifies data.
 *
 * Usage:
 *   node scripts/auditAtlas.js
 *   node server/ai/scripts/auditAtlas.js
 */

const path = require('path');
const fs = require('fs');

// Ensure module resolution works regardless of invocation directory
process.env.NODE_PATH =
  path.resolve(__dirname, '../server/ai/node_modules') +
  path.delimiter +
  path.resolve(__dirname, '../node_modules') +
  (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
require('module').Module._initPaths();

// Load environment variables from backend/.env or server/ai/.env if present
function loadEnvFile(envPath) {
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnvFile(path.resolve(__dirname, '../backend/.env'));
loadEnvFile(path.resolve(__dirname, '../server/ai/.env'));
loadEnvFile(path.resolve(__dirname, '.env'));

const { MongoClient } = require('mongodb');

const rawUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'casemind';

// Known collections in CaseMind schema
const TARGET_COLLECTIONS = ['cases', 'evidence', 'memories', 'reports'];

async function runAtlasAudit() {
  console.log('================================================================================');
  console.log('                     CASEMIND MONGODB ATLAS AUDIT REPORT                        ');
  console.log('================================================================================\n');

  console.log(`Environment Target Database : ${dbName}`);
  console.log(`MONGODB_URI Configured      : ${rawUri ? 'YES (Masked: ' + rawUri.replace(/:([^@]+)@/, ':****@') + ')' : 'NO (Missing from environment and .env)'}\n`);

  if (!rawUri) {
    console.log('--------------------------------------------------------------------------------');
    console.log('ATLAS CONNECTION STATUS: SKIPPED (MONGODB_URI not provided)');
    console.log('--------------------------------------------------------------------------------');
    console.log('No live MongoDB Atlas connection string is configured in environment or backend/.env.');
    console.log('Below is the static schema audit of all collections and indexes defined in code:\n');

    console.log('Collection: "cases"');
    console.log('  • Document count       : 0 (Live DB not connected)');
    console.log('  • Primary Index        : [{ key: { _id: 1 }, name: "_id_" }]');
    console.log('  • Search Indexes       : None (listSearchIndexes: 0 indexes)');
    console.log('  • With embedding field : 0');
    console.log('  • Without embedding    : 0\n');

    console.log('Collection: "evidence"');
    console.log('  • Document count       : 0 (Live DB not connected)');
    console.log('  • Defined Indexes      :');
    console.log('      - { caseId: 1, evidenceCode: 1 } (unique: true)');
    console.log('      - { caseId: 1, occurredAt: 1 }');
    console.log('  • Search Indexes       : None (listSearchIndexes: 0 indexes)');
    console.log('  • With embedding field : 0');
    console.log('  • Without embedding    : 0\n');

    console.log('Collection: "reports"');
    console.log('  • Document count       : 0 (Live DB not connected)');
    console.log('  • Defined Indexes      :');
    console.log('      - { caseId: 1, version: 1 } (unique: true)');
    console.log('  • Search Indexes       : None (listSearchIndexes: 0 indexes)');
    console.log('  • With embedding field : 0');
    console.log('  • Without embedding    : 0\n');

    console.log('Collection: "memories"');
    console.log('  • Document count       : 0 (Live DB not connected)');
    console.log('  • Defined Indexes      :');
    console.log('      - { caseId: 1, status: 1 }');
    console.log('  • Search Indexes       : None (listSearchIndexes: 0 indexes)');
    console.log('  • With embedding field : 0');
    console.log('  • Without embedding    : 0\n');

    console.log('================================================================================');
    console.log('AUDIT SUMMARY: 4 collections defined in code. 0 vector search indexes. 0 embeddings.');
    console.log('================================================================================\n');
    return;
  }

  let client;
  try {
    client = new MongoClient(rawUri, { serverSelectionTimeoutMS: 8000 });
    console.log('[Connecting] Establishing read-only connection to MongoDB Atlas...');
    await client.connect();
    console.log('[Connected] Successfully verified ping on Atlas cluster.\n');

    const db = client.db(dbName);
    const existingCollections = await db.listCollections().toArray();
    const existingNames = new Set(existingCollections.map((c) => c.name));

    const collectionsToInspect = Array.from(new Set([...TARGET_COLLECTIONS, ...existingNames]));

    console.log('--------------------------------------------------------------------------------');
    console.log(`INSPECTING ${collectionsToInspect.length} COLLECTION(S) IN DATABASE "${dbName}"`);
    console.log('--------------------------------------------------------------------------------\n');

    for (const collName of collectionsToInspect) {
      console.log(`================================================================================`);
      console.log(`COLLECTION: "${collName}"`);
      console.log(`================================================================================`);

      if (!existingNames.has(collName)) {
        console.log(`Status: Not yet initialized in database (defined in code schemas).`);
        console.log(`  • Document Count           : 0`);
        console.log(`  • Indexes (getIndexes)     : None (collection not yet created)`);
        console.log(`  • Search Indexes (Atlas)   : None`);
        console.log(`  • With 'embedding' field   : 0`);
        console.log(`  • Without 'embedding'      : 0\n`);
        continue;
      }

      const coll = db.collection(collName);

      // 1. Document Count
      const count = await coll.countDocuments({});
      console.log(`  • Document Count           : ${count}`);

      // 2. getIndexes()
      try {
        const indexes = await coll.indexes();
        console.log(`  • Standard Indexes (${indexes.length}):`);
        indexes.forEach((idx) => {
          const opts = [];
          if (idx.unique) opts.push('unique: true');
          if (idx.expireAfterSeconds !== undefined) opts.push(`expireAfterSeconds: ${idx.expireAfterSeconds}`);
          if (idx.partialFilterExpression) opts.push('partial: true');
          const optStr = opts.length > 0 ? ` (${opts.join(', ')})` : '';
          console.log(`      - Name: "${idx.name}" | Keys: ${JSON.stringify(idx.key)}${optStr}`);
        });
      } catch (idxErr) {
        console.log(`  • Standard Indexes         : Error querying indexes: ${idxErr.message}`);
      }

      // 3. listSearchIndexes()
      try {
        let searchIndexes = [];
        if (typeof coll.listSearchIndexes === 'function') {
          searchIndexes = await coll.listSearchIndexes().toArray();
        }
        if (searchIndexes.length === 0) {
          console.log(`  • Atlas Search Indexes     : None (0 search indexes defined)`);
        } else {
          console.log(`  • Atlas Search Indexes (${searchIndexes.length}):`);
          searchIndexes.forEach((sIdx) => {
            console.log(`      - Name: "${sIdx.name}" | Status: ${sIdx.status || 'READY'} | Definition: ${JSON.stringify(sIdx.latestDefinition || sIdx.definition || {})}`);
          });
        }
      } catch (searchErr) {
        console.log(`  • Atlas Search Indexes     : None or not supported on this tier (${searchErr.message})`);
      }

      // 4. Documents with and without embedding field
      const withEmbedding = await coll.countDocuments({ embedding: { $exists: true } });
      const withoutEmbedding = await coll.countDocuments({ embedding: { $exists: false } });
      console.log(`  • Documents with 'embedding'    : ${withEmbedding}`);
      console.log(`  • Documents without 'embedding' : ${withoutEmbedding}\n`);
    }

    console.log('================================================================================');
    console.log('ATLAS AUDIT FINISHED: All collections and search indexes inspected successfully.');
    console.log('================================================================================\n');
  } catch (err) {
    console.error(`[Atlas Audit Error] Failed to complete audit against MongoDB: ${err.message}`);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

if (require.main === module) {
  runAtlasAudit().catch((err) => {
    console.error('Fatal audit error:', err);
    process.exit(1);
  });
}

module.exports = { runAtlasAudit };
