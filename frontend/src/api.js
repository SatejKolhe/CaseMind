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
  } catch {
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

/// ============================================================================
// Mock Data Stores (Used when USE_MOCK is active)
// ============================================================================

export const MOCK_CASES = [
  {
    _id: '67232e01a1b2c3d4e5f60001',
    title: 'The Obsidian Gallery Heist',
    description:
      'Investigation into the theft of a miniature bronze statue from Obsidian Gallery during a private gala.',
    status: 'open',
    stats: {
      evidenceCount: 3,
      activeMemoriesCount: 5,
      latestReportVersion: 2,
    },
    createdAt: '2026-10-31T02:00:00.000Z',
    updatedAt: '2026-10-31T02:18:00.000Z',
  },
];

export const MOCK_EVIDENCE_STORE = [
  {
    _id: '67232e02a1b2c3d4e5f60010',
    caseId: '67232e01a1b2c3d4e5f60001',
    evidenceCode: 'EV-01',
    title: 'Display Case Tamper Sensor Log',
    content: 'Glass case pressure sensor dropped from 15.2kg to 0kg at 21:42:10.',
    source: 'Gallery Telemetry Server Log #81',
    sourceType: 'digital',
    verificationStatus: 'verified',
    occurredAt: '2026-10-30T21:42:10.000Z',
    createdAt: '2026-10-31T02:05:00.000Z',
  },
  {
    _id: '67232e02a1b2c3d4e5f60011',
    caseId: '67232e01a1b2c3d4e5f60001',
    evidenceCode: 'EV-02',
    title: 'Catering Staff Witness Statement',
    content:
      'Server Clara Bell asserts the bronze statue was still present on the pedestal when she served drinks near it at 21:55.',
    source: 'Witness Interview #1 - Investigator Notes',
    sourceType: 'witness',
    verificationStatus: 'unverified',
    occurredAt: '2026-10-30T21:55:00.000Z',
    createdAt: '2026-10-31T02:15:00.000Z',
  },
  {
    _id: '67232e02a1b2c3d4e5f60012',
    caseId: '67232e01a1b2c3d4e5f60001',
    evidenceCode: 'EV-03',
    title: 'Building Power Logbook',
    content: 'Building electrical surge and circuit breaker reset occurred at 21:42:00.',
    source: 'Maintenance Logbook',
    sourceType: 'document',
    verificationStatus: 'verified',
    occurredAt: '2026-10-30T21:42:00.000Z',
    createdAt: '2026-10-31T02:16:00.000Z',
  },
];

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
  if (USE_MOCK) {
    const newCase = {
      _id: `67232e01a1b2c3d4e5f6${String(MOCK_CASES.length + 1).padStart(4, '0')}`,
      title: caseData.title || 'Untitled Case',
      description: caseData.description || '',
      status: 'open',
      stats: { evidenceCount: 0, activeMemoriesCount: 0, latestReportVersion: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    MOCK_CASES.unshift(newCase);
    return newCase;
  }
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
  if (USE_MOCK) {
    return MOCK_CASES.map((c) => ({
      _id: c._id,
      title: c.title,
      status: c.status,
      createdAt: c.createdAt,
    }));
  }
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
  if (USE_MOCK) {
    const found = MOCK_CASES.find((c) => c._id === caseId) || {
      _id: caseId,
      title: 'The Obsidian Gallery Heist',
      description:
        'Investigation into the theft of a miniature bronze statue from Obsidian Gallery during a private gala.',
      status: 'open',
      stats: {
        evidenceCount: MOCK_EVIDENCE_STORE.filter((e) => e.caseId === caseId).length || 3,
        activeMemoriesCount: 5,
        latestReportVersion: 2,
      },
      createdAt: '2026-10-31T02:00:00.000Z',
      updatedAt: '2026-10-31T02:18:00.000Z',
    };
    return found;
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
  if (USE_MOCK) {
    const seq = MOCK_EVIDENCE_STORE.filter((e) => e.caseId === caseId).length + 1;
    const generatedCode = `EV-${String(seq).padStart(2, '0')}`;
    const newDoc = {
      _id: `67232e02a1b2c3d4e5f600${String(seq + 10)}`,
      caseId,
      evidenceCode: generatedCode,
      title: evidenceData.title,
      content: evidenceData.content,
      source: evidenceData.source,
      sourceType: evidenceData.sourceType || 'witness',
      verificationStatus: evidenceData.verificationStatus || 'unverified',
      occurredAt: evidenceData.occurredAt || new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    MOCK_EVIDENCE_STORE.push(newDoc);
    return newDoc;
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
  if (USE_MOCK) {
    return MOCK_EVIDENCE_STORE.filter((e) => e.caseId === caseId || !e.caseId);
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
  if (USE_MOCK) {
    // Artificial delay to simulate AI synthesis
    await new Promise((resolve) => setTimeout(resolve, 600));
    return {
      ...MOCK_LATEST_REPORT,
      caseId,
    };
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
      'Hypothesis H-2: Electrical surge anomaly at 21:42 with theft occurring after 21:55 (EV-01, EV-03).',
    ],
    changed: ['Hypothesis H-1 updated to reflect unresolved witness and power-surge factors.'],
    updated: ['Hypothesis H-1 updated to reflect unresolved witness and power-surge factors.'],
    retained: ['Fact: Display pedestal pressure sensor registered load drop at 21:42:10 (EV-01).'],
    contradicted: [
      'Contradiction: Discrepancy between sensor telemetry drop at 21:42 (EV-01) and witness sighting at 21:55 (EV-02).',
    ],
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

export const MOCK_VERSION_1_REPORT = {
  _id: '67232e04a1b2c3d4e5f60030',
  caseId: '67232e01a1b2c3d4e5f60001',
  version: 1,
  summary:
    'Initial baseline established: Display pedestal sensor recorded a 15.2kg weight drop at 21:42:10.',
  knownFacts: [
    {
      statement: 'Display pedestal pressure sensor registered 15.2kg load drop to zero at 21:42:10.',
      evidenceCodes: ['EV-01'],
    },
  ],
  unverifiedClaims: [],
  evidenceConnections: [],
  contradictions: [],
  possibleHypotheses: [
    {
      hypothesisId: 'H-1',
      title: 'Direct Physical Removal at 21:42',
      rationale: 'Telemetry indicates instant physical removal of statue at 21:42:10.',
      supportedBy: ['EV-01'],
      unresolvedPoints: ['Presence of gala attendees in gallery at 21:42 requires verification.'],
    },
  ],
  openQuestions: ['Who was present in the obsidian room at 21:42?'],
  suggestedNextChecks: ['Audit security desk logbook for 21:30–22:00.'],
  memoryDelta: {
    added: ['Fact: Display pedestal pressure sensor registered load drop at 21:42:10 (EV-01).'],
    changed: [],
    updated: [],
    retained: [],
    contradicted: [],
    explanation: 'Initial case baseline initialized from sensor telemetry log EV-01.',
  },
  triggerEvidenceCode: 'EV-01',
  createdAt: '2026-10-31T02:10:00.000Z',
};

/**
 * GET /api/cases/:caseId/reports
 * Lists all generated report versions for the case, ordered by version descending (newest first).
 *
 * @param {string} caseId
 * @returns {Promise<Array<{ _id: string, version: number, summary: string, triggerEvidenceCode?: string, evidenceCount?: number, createdAt: string }>>}
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
  if (USE_MOCK) {
    return [
      {
        _id: '67232e04a1b2c3d4e5f60031',
        caseId,
        version: 2,
        summary: MOCK_LATEST_REPORT.summary,
        triggerEvidenceCode: 'EV-03',
        evidenceCount: 3,
        createdAt: '2026-10-31T02:18:00.000Z',
      },
      {
        _id: '67232e04a1b2c3d4e5f60030',
        caseId,
        version: 1,
        summary: MOCK_VERSION_1_REPORT.summary,
        triggerEvidenceCode: 'EV-01',
        evidenceCount: 1,
        createdAt: '2026-10-31T02:10:00.000Z',
      },
    ];
  }
  return request(`/cases/${encodeURIComponent(caseId)}/reports`, {
    method: 'GET',
  });
}

/**
 * GET /api/cases/:caseId/reports/:version
 * Retrieves the complete, immutable report payload for a specific version number.
 *
 * @param {string} caseId
 * @param {number|string} version
 * @returns {Promise<any>}
 */
export async function getReportByVersion(caseId, version) {
  if (!caseId) {
    throw new ApiError({
      kind: 'validation',
      message: 'caseId parameter is required.',
      status: 400,
      code: 'MISSING_PARAM',
    });
  }
  if (!version) {
    throw new ApiError({
      kind: 'validation',
      message: 'version parameter is required.',
      status: 400,
      code: 'MISSING_PARAM',
    });
  }
  if (USE_MOCK) {
    if (Number(version) === 1) {
      return { ...MOCK_VERSION_1_REPORT, caseId };
    }
    return { ...MOCK_LATEST_REPORT, caseId };
  }
  return request(`/cases/${encodeURIComponent(caseId)}/reports/${encodeURIComponent(version)}`, {
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
/**
 * Mock memories payload conforming to API_CONTRACT.md section 4.4.
 */
export const MOCK_MEMORIES = [
  {
    _id: '67232e03a1b2c3d4e5f60020',
    caseId: '67232e01a1b2c3d4e5f60001',
    category: 'fact',
    statement: 'Display pedestal pressure sensor recorded 15.2kg drop to 0kg at 21:42:10.',
    supportingEvidenceCodes: ['EV-01'],
    status: 'active',
    lastUpdatedInVersion: 1,
    changeReason: 'Initialized from direct digital telemetry log EV-01.',
    updatedAt: '2026-10-31T02:10:00.000Z',
  },
  {
    _id: '67232e03a1b2c3d4e5f60021',
    caseId: '67232e01a1b2c3d4e5f60001',
    category: 'claim',
    statement: 'Server Clara Bell asserts statue was still present at 21:55.',
    source: 'Server Clara Bell interview',
    supportingEvidenceCodes: ['EV-02'],
    status: 'retained',
    lastUpdatedInVersion: 2,
    changeReason: 'Added unverified claim from witness statement EV-02.',
    updatedAt: '2026-10-31T02:18:00.000Z',
  },
  {
    _id: '67232e03a1b2c3d4e5f60022',
    caseId: '67232e01a1b2c3d4e5f60001',
    category: 'contradiction',
    statement: 'Conflict regarding theft timeline: Sensor triggered at 21:42 (EV-01) vs witness sighting at 21:55 (EV-02).',
    supportingEvidenceCodes: ['EV-01', 'EV-02'],
    conflictingEvidenceCodes: ['EV-01', 'EV-02'],
    status: 'contradicted',
    lastUpdatedInVersion: 2,
    changeReason: 'Identified direct temporal conflict between sensor and witness.',
    updatedAt: '2026-10-31T02:18:00.000Z',
  },
  {
    _id: '67232e03a1b2c3d4e5f60024',
    caseId: '67232e01a1b2c3d4e5f60001',
    category: 'fact',
    statement: 'Building power surge and circuit breaker reset occurred at 21:42:00.',
    supportingEvidenceCodes: ['EV-03'],
    status: 'active',
    lastUpdatedInVersion: 2,
    changeReason: 'Added verified maintenance logbook entry EV-03.',
    updatedAt: '2026-10-31T02:18:00.000Z',
  },
  {
    _id: '67232e03a1b2c3d4e5f60023',
    caseId: '67232e01a1b2c3d4e5f60001',
    category: 'hypothesis',
    statement: 'Electrical surge at 21:42 caused sensor anomaly; theft occurred after 21:55.',
    supportingEvidenceCodes: ['EV-01', 'EV-03'],
    hypothesisDetails: {
      hypothesisId: 'H-2',
      title: 'Electrical Surge / Sensor Anomaly (Theft After 21:55)',
      rationale:
        'Logged power surge at 21:42 coincides with sensor zero-reading; statue was seen at 21:55 by witness.',
      unresolvedPoints: ['Telemetry EV-01 does not show weight returning; requires electrical diagnostics.'],
    },
    status: 'changed',
    lastUpdatedInVersion: 2,
    changeReason: 'Formulated alternative working hypothesis incorporating power surge EV-03.',
    updatedAt: '2026-10-31T02:18:00.000Z',
  },
];

export async function getMemories(caseId, status = 'active') {
  if (!caseId) {
    throw new ApiError({
      kind: 'validation',
      message: 'caseId parameter is required.',
      status: 400,
      code: 'MISSING_PARAM',
    });
  }
  if (USE_MOCK) {
    return MOCK_MEMORIES.map((m) => ({ ...m, caseId }));
  }
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return request(`/cases/${encodeURIComponent(caseId)}/memories${query}`, {
    method: 'GET',
  });
}
