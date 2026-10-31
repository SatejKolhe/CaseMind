const path = require('path');
const { validateConfig, AI_PROVIDER, AI_MODEL } = require('./config');

/**
 * Startup Check for CaseMind AI Module
 *
 * Verifies:
 * 1. AI configuration (provider, model, API keys) via validateConfig()
 * 2. MongoDB Atlas connectivity via connectDB() or direct ping
 *
 * Refuses to start with a clear message if anything is missing.
 */
async function startupCheck({ checkDb = true } = {}) {
  const issues = [];

  // 1. Validate AI Module Config
  try {
    validateConfig();
  } catch (err) {
    issues.push(`[AI Config Error] ${err.message}`);
  }

  // 2. Validate Database Connectivity
  if (checkDb) {
    // Attempt loading backend/.env if MONGODB_URI is not currently in environment
    if (!process.env.MONGODB_URI) {
      try {
        const backendEnvPath = path.resolve(__dirname, '../../backend/.env');
        if (typeof process.loadEnvFile === 'function') {
          process.loadEnvFile(backendEnvPath);
        }
      } catch (_) {
        // Backend .env may not exist
      }
    }

    if (!process.env.MONGODB_URI) {
      issues.push(
        '[Database Error] MONGODB_URI is missing from environment and backend/.env.\n' +
        '  Please set MONGODB_URI in your environment or in backend/.env to connect to MongoDB Atlas.'
      );
    } else {
      let dbModule = null;
      try {
        dbModule = require('../../backend/src/config/db');
      } catch (_) {
        issues.push('[Database Error] Could not load backend database configuration module (backend/src/config/db.js).');
      }

      if (dbModule && typeof dbModule.connectDB === 'function') {
        try {
          const db = await dbModule.connectDB();
          await db.command({ ping: 1 });
        } catch (err) {
          issues.push(`[Database Connectivity Failure] Unable to connect to MongoDB Atlas: ${err.message}`);
        }
      }
    }
  }

  if (issues.length > 0) {
    const refusalMessage =
      '================================================================================\n' +
      '                   CASEMIND STARTUP CHECK: REFUSAL TO START                     \n' +
      '================================================================================\n' +
      issues.map((issue, idx) => `  ${idx + 1}. ${issue}`).join('\n\n') +
      '\n================================================================================\n';
    const error = new Error(refusalMessage);
    error.issues = issues;
    throw error;
  }

  return {
    status: 'ready',
    provider: AI_PROVIDER,
    model: AI_MODEL,
    database: checkDb ? 'connected' : 'skipped',
  };
}

// Allow running standalone from CLI
if (require.main === module) {
  startupCheck()
    .then((result) => {
      console.log('CaseMind Startup Check: ALL SYSTEMS READY.');
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 0;
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}

module.exports = {
  startupCheck,
};
