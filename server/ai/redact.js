const { getConfig } = require('./config');
const { generateJson } = require('./llm');

/**
 * Regex patterns for PII and credential redaction.
 */
const PATTERNS = [
  // 1. URLs with embedded credentials or access tokens (run first to protect URLs)
  {
    type: 'token_url',
    regex: /(https?:\/\/[^\s]+[?&](?:token|key|api_key|access_token|auth|secret|session)=)[^\s&]+/gi,
    replacement: '$1[TOKEN_REDACTED]',
    placeholderPrefix: 'TOKEN_URL',
  },
  // 2. API Keys & Sensitive Tokens
  {
    type: 'api_key',
    regex: /\b(?:sk-[a-zA-Z0-9_\-]{20,}|AIza[0-9A-Za-z\-_]{35}|ghp_[a-zA-Z0-9]{36}|xox[baprs]-[a-zA-Z0-9-]{10,}|(?:api[_-]?key|secret|token)[\s:=]+["']?([a-zA-Z0-9_\-]{16,})["']?)\b/gi,
    placeholderPrefix: 'API_KEY',
  },
  // 3. Email Addresses
  {
    type: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
    placeholderPrefix: 'EMAIL',
  },
  // 4. Phone Numbers (Indian +91, 10-digit mobiles, and international formats)
  {
    type: 'phone',
    regex: /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b|\b(?:\+?1[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    placeholderPrefix: 'PHONE',
  },
  // 5. 12-Digit ID-like numbers (e.g. national identity/Aadhaar formats)
  {
    type: 'id_number',
    regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    placeholderPrefix: 'ID_NUM',
  },
  // 6. Long Digit Sequences (13-19 digits, e.g. credit cards or bank accounts)
  {
    type: 'number_sequence',
    regex: /\b(?:\d[\s-]?){13,19}\b/g,
    placeholderPrefix: 'CARD_ACCOUNT_NUM',
  },
];

/**
 * Executes rule-based regex redaction on raw text.
 * Never logs or stores original sensitive values.
 *
 * @param {string} text Raw input text
 * @returns {{ text: string, redacted: boolean, findings: Array<{ type: string, placeholder: string }> }}
 */
function redactRegex(text) {
  if (typeof text !== 'string' || !text) {
    return { text: text || '', redacted: false, findings: [] };
  }

  let cleaned = text;
  const findings = [];
  const counters = {};

  for (const { type, regex, replacement, placeholderPrefix } of PATTERNS) {
    counters[type] = counters[type] || 0;

    if (replacement) {
      if (regex.test(cleaned)) {
        cleaned = cleaned.replace(regex, replacement);
        findings.push({
          type,
          placeholder: replacement,
        });
      }
    } else {
      cleaned = cleaned.replace(regex, () => {
        counters[type]++;
        const placeholder = `[${placeholderPrefix}_${counters[type]}]`;
        findings.push({
          type,
          placeholder,
        });
        return placeholder;
      });
    }
  }

  return {
    text: cleaned,
    redacted: findings.length > 0,
    findings,
  };
}

/**
 * Optional LLM pass to replace private individuals' names and physical street addresses
 * with stable placeholders ([PERSON_1], [ADDRESS_1]).
 */
async function redactWithLlm(text, baseFindings) {
  const systemPrompt = `You are a privacy redaction filter.
Your task is to identify full names of private individuals and specific street addresses in the provided text.
Replace them with consistent placeholders: [PERSON_1], [PERSON_2], [ADDRESS_1], [ADDRESS_2].
Do NOT redact public officials, role titles (e.g. "DevOps Engineer", "Detective"), organization names, or timestamps.
Return strictly JSON with the redacted text and findings.`;

  const jsonSchema = {
    type: 'object',
    properties: {
      redactedText: { type: 'string' },
      namedEntitiesRedacted: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['person', 'address'] },
            placeholder: { type: 'string' },
          },
          required: ['type', 'placeholder'],
        },
      },
    },
    required: ['redactedText', 'namedEntitiesRedacted'],
  };

  try {
    const result = await generateJson({
      system: systemPrompt,
      user: `Redact private names and street addresses from the following text:\n\n${text}`,
      jsonSchema,
      temperature: 0.0,
    });

    const llmFindings = (result.namedEntitiesRedacted || []).map((item) => ({
      type: item.type,
      placeholder: item.placeholder,
    }));

    return {
      text: result.redactedText || text,
      redacted: baseFindings.length > 0 || llmFindings.length > 0,
      findings: [...baseFindings, ...llmFindings],
    };
  } catch (err) {
    console.warn(`[Redact] LLM redaction pass failed: ${err.message}. Retaining regex redaction.`);
    return {
      text,
      redacted: baseFindings.length > 0,
      findings: baseFindings,
    };
  }
}

/**
 * Main redaction pipeline.
 * Performs deterministic regex pass, followed optionally by LLM entity redaction.
 *
 * @param {string} text Text to redact
 * @param {object} [options]
 * @param {boolean} [options.useLlm] Force LLM pass on/off (defaults to USE_LLM_REDACTION env var)
 * @returns {Promise<{ text: string, redacted: boolean, findings: Array<{ type: string, placeholder: string }> }>}
 */
async function redact(text, options = {}) {
  const regexResult = redactRegex(text);

  const config = getConfig();
  const shouldRunLlm = options.useLlm !== undefined ? Boolean(options.useLlm) : config.USE_LLM_REDACTION;

  if (shouldRunLlm && regexResult.text.trim()) {
    return await redactWithLlm(regexResult.text, regexResult.findings);
  }

  return regexResult;
}

module.exports = {
  redact,
  redactRegex,
};
