const { validateConfig } = require('./config');

/**
 * Strips markdown code blocks (e.g. ```json ... ```) from raw LLM text output.
 */
function stripCodeFences(rawText) {
  if (typeof rawText !== 'string') {
    return '';
  }
  let cleaned = rawText.trim();
  // Remove starting ```json or ```
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
  // Remove ending ```
  cleaned = cleaned.replace(/\n?```\s*$/i, '');
  return cleaned.trim();
}

/**
 * Safely parses raw text into a JSON object.
 */
function safeJsonParse(rawText, provider) {
  const cleaned = stripCodeFences(rawText);
  try {
    return JSON.parse(cleaned);
  } catch (parseError) {
    throw new Error(
      `[AI LLM] Failed to parse JSON response from provider "${provider}": ${parseError.message}. Raw output snippet: ${cleaned.slice(0, 200)}`
    );
  }
}

/**
 * Helper to pause execution with exponential backoff delay.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Google Gemini Provider Call via native fetch.
 * Uses native structured JSON schema enforcement via generationConfig.responseSchema.
 * Passes API key via x-goog-api-key header to prevent URL key exposure.
 */
async function callGemini({ config, system, user, jsonSchema, temperature, signal }) {
  const model = encodeURIComponent(config.AI_MODEL);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const generationConfig = {
    temperature: typeof temperature === 'number' ? temperature : 0.2,
    responseMimeType: 'application/json',
  };

  if (jsonSchema && typeof jsonSchema === 'object') {
    generationConfig.responseSchema = jsonSchema;
  }

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: user }],
      },
    ],
    generationConfig,
  };

  if (system && typeof system === 'string' && system.trim()) {
    payload.systemInstruction = {
      parts: [{ text: system.trim() }],
    };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.AI_API_KEY,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson?.error?.message || JSON.stringify(errJson);
    } catch (_) {
      errorDetail = await response.text();
    }
    const err = new Error(`[Gemini HTTP ${response.status}] ${errorDetail || response.statusText}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const textContent = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!textContent && textContent !== '') {
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new Error(
      `[Gemini] Received empty content from model (finishReason: ${finishReason || 'unknown'}).`
    );
  }

  return safeJsonParse(textContent, 'gemini');
}

/**
 * OpenAI Provider Call via native fetch.
 * Uses native structured outputs (json_schema) when schema is provided.
 */
async function callOpenAI({ config, system, user, jsonSchema, temperature, signal }) {
  const endpoint = 'https://api.openai.com/v1/chat/completions';

  const messages = [];
  if (system && typeof system === 'string' && system.trim()) {
    messages.push({ role: 'system', content: system.trim() });
  }
  messages.push({ role: 'user', content: user });

  const payload = {
    model: config.AI_MODEL,
    temperature: typeof temperature === 'number' ? temperature : 0.2,
    messages,
  };

  if (jsonSchema && typeof jsonSchema === 'object') {
    payload.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'structured_analysis',
        strict: true,
        schema: jsonSchema,
      },
    };
  } else {
    payload.response_format = { type: 'json_object' };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.AI_API_KEY}`,
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson?.error?.message || JSON.stringify(errJson);
    } catch (_) {
      errorDetail = await response.text();
    }
    const err = new Error(`[OpenAI HTTP ${response.status}] ${errorDetail || response.statusText}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const textContent = data?.choices?.[0]?.message?.content;

  if (!textContent && textContent !== '') {
    throw new Error('[OpenAI] Received empty response message content.');
  }

  return safeJsonParse(textContent, 'openai');
}

/**
 * Dispatches the call to the configured provider with per-call timeout and retry handling.
 *
 * @param {object} params
 * @param {string} [params.system] System prompt instructions
 * @param {string} params.user User prompt
 * @param {object} [params.jsonSchema] Expected JSON schema
 * @param {number} [params.temperature=0.2] Sampling temperature
 * @returns {Promise<object>} Parsed JSON response
 */
async function generateJson({ system, user, jsonSchema, temperature = 0.2 }) {
  const config = validateConfig();

  if (!user || typeof user !== 'string' || !user.trim()) {
    throw new Error('[AI LLM] User prompt is required and must be a non-empty string.');
  }

  const provider = config.AI_PROVIDER;
  const maxRetries = config.AI_MAX_RETRIES;
  const timeoutMs = config.AI_TIMEOUT_MS;

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    try {
      let result;
      if (provider === 'gemini' || provider === 'google') {
        result = await callGemini({
          config,
          system,
          user,
          jsonSchema,
          temperature,
          signal: controller.signal,
        });
      } else if (provider === 'openai') {
        result = await callOpenAI({
          config,
          system,
          user,
          jsonSchema,
          temperature,
          signal: controller.signal,
        });
      } else {
        throw new Error(`[AI LLM] Unsupported provider "${provider}".`);
      }

      return result;
    } catch (err) {
      lastError = err;

      const isAbort = err.name === 'AbortError' || controller.signal.aborted;
      const status = err.status;

      // Fail fast on auth errors - DO NOT retry
      if (status === 401 || status === 403) {
        throw new Error(
          `[AI LLM] Authentication failed with ${provider} (HTTP ${status}). Please check your AI_API_KEY. Detailed error: ${err.message}`
        );
      }

      // Fail fast on bad request schema errors - DO NOT retry
      if (status === 400 || status === 404) {
        throw new Error(
          `[AI LLM] Client request rejected by ${provider} (HTTP ${status}): ${err.message}`
        );
      }

      // Determine if error is retryable (429 Rate Limit, 5xx Server Error, or Timeout)
      const isRetryable =
        isAbort ||
        status === 429 ||
        (typeof status === 'number' && status >= 500 && status <= 599);

      if (!isRetryable || attempt >= maxRetries) {
        break;
      }

      // Exponential backoff: base 1000ms * 2^attempt + jitter
      const backoffMs = 1000 * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
      const reason = isAbort ? `timeout after ${timeoutMs}ms` : `HTTP ${status}`;
      console.warn(
        `[AI LLM] Request failed (${reason}). Retrying attempt ${attempt + 1}/${maxRetries} in ${backoffMs}ms...`
      );
      await sleep(backoffMs);
    } finally {
      clearTimeout(timer);
    }
  }

  // All retries exhausted or non-retryable error
  const finalMessage = lastError?.name === 'AbortError'
    ? `Request timed out after ${timeoutMs}ms across ${maxRetries + 1} attempt(s).`
    : (lastError?.message || 'Unknown LLM invocation error.');

  throw new Error(`[AI LLM] Failed to generate JSON with provider "${provider}": ${finalMessage}`);
}

module.exports = {
  generateJson,
};
