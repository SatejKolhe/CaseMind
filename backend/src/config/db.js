const { MongoClient } = require('mongodb');

let client = null;
let db = null;

/**
 * Normalizes connection URI by trimming accidental whitespace.
 * Prevents parser errors without exposing credentials.
 */
function cleanUri(rawUri) {
  if (!rawUri) return '';
  let uri = rawUri.trim();
  uri = uri.replace(/^mongodb:\/\/\s+/, 'mongodb://');
  uri = uri.replace(/^mongodb\+srv:\/\/\s+/, 'mongodb+srv://');
  return uri;
}

/**
 * Initializes required indexes for CaseMind collections.
 * @param {import('mongodb').Db} database
 */
async function initIndexes(database) {
  try {
    // Unique compound index: prevents duplicate evidence codes per case
    await database.collection('evidence').createIndex(
      { caseId: 1, evidenceCode: 1 },
      { unique: true }
    );

    // Timeline index: chronological retrieval of evidence
    await database.collection('evidence').createIndex(
      { caseId: 1, occurredAt: 1 }
    );

    // Unique compound index: ensures immutable, conflict-free report versions
    await database.collection('reports').createIndex(
      { caseId: 1, version: 1 },
      { unique: true }
    );
  } catch (err) {
    console.error(`[MongoDB] Warning: Error ensuring collection indexes: ${err.message}`);
  }
}

/**
 * Connects to MongoDB Atlas and verifies the connection with a ping.
 * @returns {Promise<import('mongodb').Db>}
 */
async function connectDB() {
  if (db && client) {
    return db;
  }

  const rawUri = process.env.MONGODB_URI;
  const dbName = process.env.DB_NAME || 'casemind';

  if (!rawUri) {
    throw new Error('MONGODB_URI environment variable is missing.');
  }

  const uri = cleanUri(rawUri);

  try {
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
    });

    await client.connect();

    // Verify connectivity with a ping command
    const database = client.db(dbName);
    await database.command({ ping: 1 });

    // Ensure required collection indexes are created
    await initIndexes(database);

    db = database;
    console.log(`[MongoDB] Connected successfully to database: ${dbName}`);
    return db;
  } catch (error) {
    // Ensure failed client connection is cleaned up
    if (client) {
      try {
        await client.close();
      } catch (_) {
        // Ignore close error during teardown
      }
      client = null;
      db = null;
    }

    console.error(`[MongoDB] Connection failed: ${error.message}`);
    throw error;
  }
}

/**
 * Returns the active database instance.
 * @returns {import('mongodb').Db}
 */
function getDB() {
  if (!db) {
    throw new Error('Database is not connected. Call connectDB() first.');
  }
  return db;
}

/**
 * Returns the MongoClient instance.
 * @returns {import('mongodb').MongoClient|null}
 */
function getClient() {
  return client;
}

/**
 * Closes the active MongoDB connection.
 */
async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('[MongoDB] Connection closed.');
  }
}

module.exports = {
  connectDB,
  getDB,
  getClient,
  closeDB,
};
