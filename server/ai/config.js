const path = require('path');
const fs = require('fs');

/**
 * Safely loads environment variables from a file without throwing if it doesn't exist.
 * Uses native Node.js process.loadEnvFile (Node 20.6+) with fallback to dotenv.
 */
function loadEnvSafely(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(filePath);
      return;
    }
  } catch (_) {
    // If native loadEnvFile has parse warnings, proceed to fallback
  }

  try {
    let dotenv;
    try {
      dotenv = require('dotenv');
    } catch (_) {
      try {
        dotenv = require('../../backend/node_modules/dotenv');
      } catch (_) {
        dotenv = null;
      }
    }

    if (dotenv) {
      dotenv.config({ path: filePath });
      return;
    }

    // Lightweight zero-dependency fallback parser
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        // Remove enclosing quotes if present
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key && !(key in process.env)) {
          process.env[key] = val;
        }
      }
    }
  } catch (_) {
    // Ignore read errors during env discovery
  }
}

// Load environment variables from possible locations
// Priority: server/ai/.env -> backend/.env -> project root .env
loadEnvSafely(path.resolve(__dirname, '.env'));
loadEnvSafely(path.resolve(__dirname, '../../backend/.env'));
loadEnvSafely(path.resolve(__dirname, '../../.env'));

/**
 * Safely parses integer from environment variable with fallback default.
 */
function parseNumber(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Safely parses boolean from environment variable with fallback default.
 */
function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const str = String(value).trim().toLowerCase();
  return str === 'true' || str === '1' || str === 'yes';
}

/**
 * Returns current AI configuration values.
 */
function getConfig() {
  return {
    AI_PROVIDER: process.env.AI_PROVIDER ? process.env.AI_PROVIDER.trim().toLowerCase() : '',
    AI_API_KEY: process.env.AI_API_KEY ? process.env.AI_API_KEY.trim() : '',
    AI_MODEL: process.env.AI_MODEL ? process.env.AI_MODEL.trim() : '',
    AI_TIMEOUT_MS: parseNumber(process.env.AI_TIMEOUT_MS, 60000),
    AI_MAX_RETRIES: parseNumber(process.env.AI_MAX_RETRIES, 2),
    CONTEXT_TOKEN_BUDGET: parseNumber(process.env.CONTEXT_TOKEN_BUDGET, 6000),
    USE_LLM_REDACTION: parseBoolean(process.env.USE_LLM_REDACTION, false),
  };
}

/**
 * Validates that required environment variables are present and valid.
 * Throws a clear descriptive error naming each missing variable.
 * Never prints secret key values.
 */
function validateConfig() {
  const config = getConfig();
  const missing = [];

  if (!config.AI_PROVIDER) {
    missing.push('AI_PROVIDER');
  }
  if (!config.AI_API_KEY) {
    missing.push('AI_API_KEY');
  }
  if (!config.AI_MODEL) {
    missing.push('AI_MODEL');
  }

  if (missing.length > 0) {
    throw new Error(
      `[AI Config] Missing required environment variable(s): ${missing.join(', ')}. ` +
      'Please define them in your environment or .env file without committing secrets.'
    );
  }

  const supportedProviders = ['gemini', 'google', 'openai'];
  if (!supportedProviders.includes(config.AI_PROVIDER)) {
    throw new Error(
      `[AI Config] Unsupported AI_PROVIDER "${config.AI_PROVIDER}". Supported providers: ${supportedProviders.join(', ')}.`
    );
  }

  return config;
}

module.exports = {
  getConfig,
  validateConfig,
};
