/**
 * CaseMind API Client
 *
 * Implements client bindings for CaseMind REST API conforming strictly to docs/API_CONTRACT.md.
 * Every function throws a typed ApiError with:
 *   { kind: 'validation' | 'database' | 'ai_provider' | 'ai_output' | 'network', message, status?, code?, details? }
 */

// Single feature flag for stubbing endpoints not yet finalized in the contract
export const USE_MOCK = Boolean(import.meta.env?.VITE_USE_MOCK === 'true');

export const API_BASE = (import.meta.env?.VITE_API_URL || 'http://localhost:5000/api').replace(/\/+$/, '');

/**
 * Typed API Error representation matching contract error categories
 */
export class ApiError extends Error {
  /**
   * @param {Object} params
   * @param {'validation' | 'database' | 'ai_provider' | 'ai_output' | 'network'} params.kind
   * @param {string} params.message
   * @param {number} [params.status]
   * @param {string} [params.code]
   * @param {any} [params.details]
   */
  constructor({ kind, message, status = 0, code = 'ERROR', details = null }) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.message = message;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Maps HTTP status codes and API contract error codes to a typed error kind.
 *
 * @param {number} status
 * @param {string} [code]
 * @returns {'validation' | 'database' | 'ai_provider' | 'ai_output'}
 */
function mapErrorToKind(status, code = '') {
  const normalizedCode = String(code).toUpperCase();

  // 1. External AI / LLM Provider Failure (502 Bad Gateway)
  if (
    status === 502 ||
    normalizedCode.includes('LLM_') ||
    normalizedCode.includes('AI_TIMEOUT') ||
    normalizedCode.includes('AI_PROVIDER')
  ) {
    return 'ai_provider';
  }

  // 2. AI Structured Output / Citation Validation Failure (422 Unprocessable Entity)
  if (
    status === 422 ||
    normalizedCode === 'EVIDENCE_NOT_FOUND' ||
    normalizedCode.includes('CITATION') ||
    normalizedCode.includes('AI_OUTPUT') ||
    normalizedCode.includes('GUILT_CLAIM') ||
    normalizedCode.includes('SCHEMA_MISMATCH')
  ) {
    return 'ai_output';
  }

  // 3. Request Validation or Not Found (400, 404)
  if (
    status === 400 ||
    status === 404 ||
    normalizedCode.includes('VALIDATION') ||
    normalizedCode.includes('NOT_FOUND') ||
    normalizedCode.includes('INVALID_')
  ) {
    return 'validation';
  }

  // 4. Concurrency conflict (409) or internal/database persistence error (500)
  if (
    status === 409 ||
    status >= 500 ||
    normalizedCode.includes('DATABASE') ||
    normalizedCode.includes('DUPLICATE') ||
    normalizedCode.includes('TRANSACTION') ||
    normalizedCode.includes('CONFLICT')
  ) {
    return 'database';
  }

  return 'validation';
}

/**
 * Generic fetch wrapper enforcing JSON contracts and throwing typed ApiError.
 *
 * @template T
 * @param {string} endpoint
 * @param {RequestInit} [options]
 * @returns {Promise<T>}
 */
async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (err) {
    throw new ApiError({
      kind: 'network',
      message: `Network request failed: ${err.message || 'Unable to connect to CaseMind backend'}.`,
      status: 0,
      code: 'NETWORK_ERROR',
    });
  }

  let json = null;
  try {
    json = await response.json();
  } catch (err) {
    const errorKind = response.status >= 500 ? 'database' : 'validation';
    throw new ApiError({
      kind: errorKind,
      message: `Malformed JSON response from server (HTTP ${response.status}).`,
      status: response.status,
      code: 'INVALID_SERVER_RESPONSE',
    });
  }

  if (!response.ok || (json && json.success === false)) {
    const errorPayload = json?.error || {};
    const errorCode = errorPayload.code || `HTTP_${response.status}`;
    const errorMessage = errorPayload.message || `Request to ${endpoint} failed with status ${response.status}.`;
    const errorKind = mapErrorToKind(response.status, errorCode);

    throw new ApiError({
      kind: errorKind,
      message: errorMessage,
      status: response.status,
      code: errorCode,
      details: errorPayload.details || null,
    });
  }

  return json.data;
}

// ============================================================================
// Endpoint Implementations (1 function per API_CONTRACT.md endpoint)
// ============================================================================

/**
 * POST /api/cases
 * Creates a new fictional investigation case.
 *
 * @param {{ title: string, description?: string }} caseData
 * @returns {Promise<{ _id: string, title: string, description: string, status: string, createdAt: string, updatedAt: string }>}
 */
export async function createCase(caseData) {
  return request('/cases', {
    method: 'POST',
    body: JSON.stringify(caseData || {}),
  });
}

/**
 * GET /api/cases
 * Lists all cases ordered newest first.
 *
 * @returns {Promise<Array<{ _id: string, title: string, status: string, createdAt: string }>>}
 */
export async function listCases() {
  return request('/cases', {
    method: 'GET',
  });
}

/**
 * GET /api/cases/:caseId
 * Retrieves a single case by ID with counts of associated evidence, active memories, and latest report version.
 *
 * @param {string} caseId
 * @returns {Promise<{ _id: string, title: string, description: string, status: string, stats: { evidenceCount: number, activeMemoriesCount: number, latestReportVersion: number }, createdAt: string, updatedAt: string }>}
 */
export async function getCase(caseId) {
  if (!caseId) {
    throw new ApiError({
      kind: 'validation',
      message: 'caseId parameter is required.',
      status: 400,
      code: 'MISSING_PARAM',
    });
  }
  return request(`/cases/${encodeURIComponent(caseId)}`, {
    method: 'GET',
  });
}

/**
 * POST /api/cases/:caseId/evidence
 * Submits and persists a new piece of evidence scoped to the specified case.
 *
 * @param {string} caseId
 * @param {{ title: string, content: string, source: string, sourceType: 'witness'|'physical'|'digital'|'document'|'cctv', verificationStatus: 'verified'|'unverified'|'disputed', occurredAt: string }} evidenceData
 * @returns {Promise<{ _id: string, caseId: string, evidenceCode: string, title: string, content: string, source: string, sourceType: string, verificationStatus: string, occurredAt: string, createdAt: string }>}
 */
export async function addEvidence(caseId, evidenceData) {
  if (!caseId) {
    throw new ApiError({
      kind: 'validation',
      message: 'caseId parameter is required.',
      status: 400,
      code: 'MISSING_PARAM',
    });
  }
  return request(`/cases/${encodeURIComponent(caseId)}/evidence`, {
    method: 'POST',
    body: JSON.stringify(evidenceData || {}),
  });
}

/**
 * GET /api/cases/:caseId/evidence
 * Retrieves all evidence records scoped to the case, chronologically ordered by occurredAt ascending.
 *
 * @param {string} caseId
 * @returns {Promise<Array<{ _id: string, caseId: string, evidenceCode: string, title: string, content: string, source: string, sourceType: string, verificationStatus: string, occurredAt: string, createdAt: string }>>}
 */
export async function listEvidence(caseId) {
  if (!caseId) {
    throw new ApiError({
      kind: 'validation',
      message: 'caseId parameter is required.',
      status: 400,
      code: 'MISSING_PARAM',
    });
  }
  return request(`/cases/${encodeURIComponent(caseId)}/evidence`, {
    method: 'GET',
  });
}

/**
 * POST /api/cases/:caseId/analyze
 * Triggers the AI synthesis pipeline.
 *
 * @param {string} caseId
 * @param {{ triggerEvidenceCode?: string }} [options={}]
 * @returns {Promise<any>}
 */
export async function runAnalysis(caseId, options = {}) {
  if (!caseId) {
    throw new ApiError({
      kind: 'validation',
      message: 'caseId parameter is required.',
      status: 400,
      code: 'MISSING_PARAM',
    });
  }
  return request(`/cases/${encodeURIComponent(caseId)}/analyze`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
}

/**
 * Mock report payload conforming to API_CONTRACT.md section 4.3 and 7.
 * Used for getLatestReport stubbing when USE_MOCK is active.
 */
export const MOCK_LATEST_REPORT = {
  _id: '67232e04a1b2c3d4e5f60031',
  caseId: '67232e01a1b2c3d4e5f60001',
  version: 2,
  summary:
    'Chronological conflict identified between display sensor telemetry (21:42) and witness sighting (21:55). Confounding electrical surge recorded at 21:42.',
  knownFacts: [
    {
      statement: 'Display pedestal pressure sensor registered 15.2kg load drop to zero at 21:42:10.',
      evidenceCodes: ['EV-01'],
    },
    {
      statement: 'Building electrical surge and circuit breaker reset occurred at 21:42:00.',
      evidenceCodes: ['EV-03'],
    },
  ],
  unverifiedClaims: [
    {
      statement: 'Server Clara Bell observed statue on pedestal at 21:55.',
      source: 'Catering Staff Witness Statement',
      evidenceCodes: ['EV-02'],
    },
  ],
  evidenceConnections: [
    {
      connection:
        'The 13-minute gap between the sensor zero-reading at 21:42 and witness observation at 21:55 creates a direct timeline conflict. Concurrently, the electrical surge at 21:42 provides a potential alternative explanation for the telemetry drop.',
      evidenceCodes: ['EV-01', 'EV-02', 'EV-03'],
    },
  ],
  contradictions: [
    {
      pointOfConflict:
        'Sensor telemetry indicates pedestal was empty at 21:42:10 (EV-01), whereas witness statement asserts statue remained in place at 21:55 (EV-02). Neither source is definitively ruled out.',
      conflictingEvidenceCodes: ['EV-01', 'EV-02'],
    },
  ],
  possibleHypotheses: [
    {
      hypothesisId: 'H-1',
      title: 'Theft at 21:42 (Witness Mistaken)',
      rationale:
        'Sensor telemetry is objective and verified; witness Clara Bell may have misremembered time or glanced at an empty case in dim gala lighting.',
      supportedBy: ['EV-01'],
      unresolvedPoints: ['Requires verification of witness reliability and gala lighting conditions.'],
    },
    {
      hypothesisId: 'H-2',
      title: 'Electrical Surge / Sensor Anomaly (Theft After 21:55)',
      rationale:
        'Building electrical surge at 21:42 may have caused a false telemetry drop on the pedestal, which is consistent with witness observing statue at 21:55. This explanation is strictly hypothetical.',
      supportedBy: ['EV-01', 'EV-03'],
      unresolvedPoints: [
        'Telemetry log EV-01 does not show weight returning after surge; sensor diagnostic test needed.',
      ],
    },
  ],
  openQuestions: [
    'Did any other guests or servers observe the pedestal between 21:42 and 21:55?',
    'Do gallery alarm diagnostic logs show sensor recalibration around 21:42?',
  ],
  suggestedNextChecks: [
    'Audit server room electrical and reset logs for 21:40–22:00.',
    'Interview second catering server assigned to the display room.',
  ],
  memoryDelta: {
    added: [
      'Fact: Building electrical surge and breaker reset logged at 21:42:00 (EV-03).',
      'Claim: Witness Clara Bell states statue present at 21:55 (EV-02).',
      'Contradiction: Discrepancy between sensor telemetry drop at 21:42 (EV-01) and witness sighting at 21:55 (EV-02).',
      'Hypothesis H-2: Electrical surge anomaly at 21:42 with theft occurring after 21:55 (EV-01, EV-03).',
    ],
    updated: ['Hypothesis H-1 updated to reflect unresolved witness and power-surge factors.'],
    explanation:
      'Ingested EV-02 and EV-03; identified that sensor drop at 21:42 may be an artifact of the logged electrical surge rather than physical removal, given witness observation at 21:55.',
  },
  triggerEvidenceCode: 'EV-03',
  createdAt: '2026-10-31T02:18:00.000Z',
};

/**
 * CONTRACT QUESTION:
 * docs/API_CONTRACT.md specifies GET /api/cases/:caseId/reports (list) and
 * GET /api/cases/:caseId/reports/:version (by version number), but does NOT define
 * a dedicated GET /api/cases/:caseId/reports/latest route.
 *
 * When USE_MOCK is true, this function returns MOCK_LATEST_REPORT.
 * When USE_MOCK is false, it attempts to fetch /api/cases/:caseId/reports/latest,
 * allowing the backend to support this alias or throw a typed ApiError.
 *
 * @param {string} caseId
 * @returns {Promise<any>}
 */
export async function getLatestReport(caseId) {
  if (!caseId) {
    throw new ApiError({
      kind: 'validation',
      message: 'caseId parameter is required.',
      status: 400,
      code: 'MISSING_PARAM',
    });
  }

  if (USE_MOCK) {
    // Return mock data scoped to requested caseId
    return {
      ...MOCK_LATEST_REPORT,
      caseId,
    };
  }

  // Attempt the endpoint against the backend
  return request(`/cases/${encodeURIComponent(caseId)}/reports/latest`, {
    method: 'GET',
  });
}

/**
 * GET /api/cases/:caseId/reports
 * Lists all generated report versions for the case, ordered by version descending (newest first).
 *
 * @param {string} caseId
 * @returns {Promise<Array<{ _id: string, version: number, summary: string, triggerEvidenceCode?: string, createdAt: string }>>}
 */
export async function listReports(caseId) {
  if (!caseId) {
    throw new ApiError({
      kind: 'validation',
      message: 'caseId parameter is required.',
      status: 400,
      code: 'MISSING_PARAM',
    });
  }
  return request(`/cases/${encodeURIComponent(caseId)}/reports`, {
    method: 'GET',
  });
}

/**
 * GET /api/cases/:caseId/memories
 * Retrieves all working memory items scoped to the case.
 *
 * @param {string} caseId
 * @param {'active'|'resolved'|'superseded'|'all'} [status='active']
 * @returns {Promise<Array<{ _id: string, caseId: string, category: string, statement: string, supportingEvidenceCodes: string[], conflictingEvidenceCodes?: string[], hypothesisDetails?: any, source?: string, status: string, lastUpdatedInVersion: number, changeReason: string, updatedAt: string }>>}
 */
export async function getMemories(caseId, status = 'active') {
  if (!caseId) {
    throw new ApiError({
      kind: 'validation',
      message: 'caseId parameter is required.',
      status: 400,
      code: 'MISSING_PARAM',
    });
  }
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return request(`/cases/${encodeURIComponent(caseId)}/memories${query}`, {
    method: 'GET',
  });
}
