/**
 * CaseMind AI Module - Real Dependencies Adapter (deps.real.js)
 *
 * Adapts Member 1's real functions from the discovery report to the deps interface.
 * Rules:
 * - Do NOT edit Member 1's files.
 * - For any missing function, list it with its exact signature and stop at that point
 *   instead of mocking it.
 * - Redaction before embedding/storing is Member 1's responsibility; confirmed in discovery report.
 */

const path = require('path');

// Safe reference to Member 1's database configuration if available
let dbModule = null;
try {
  dbModule = require('../../backend/src/config/db');
} catch (_) {
  // If backend db module is not accessible at relative path
}

/**
 * Custom error indicating an operation stopped because Member 1 has not provided
 * the required function implementation.
 */
class MissingMember1FunctionError extends Error {
  constructor(signature, description) {
    super(
      `[Missing from Member 1] Function '${signature}' is not implemented by Member 1.\n` +
      `Requirement: ${description}\n` +
      `Project rules strictly prohibit mocking this function. Stopping execution here.`
    );
    this.name = 'MissingMember1FunctionError';
    this.signature = signature;
  }
}

/**
 * Catalog of missing functions and architectural gaps from Member 1's discovery.
 */
const MISSING_FROM_MEMBER_1 = [
  {
    name: 'redact() invocation before storage',
    type: 'Security / Compliance Gap',
    detail:
      'Member 1 does NOT call redact() in backend/src/controllers/evidenceController.js ' +
      '(lines 154-164 directly store raw content.trim() into MongoDB).',
    actionRequired: 'Member 1 must import redact from /server/ai and sanitize content before inserting into MongoDB.',
  },
  {
    signature: 'getEvidence(caseId, evidenceId)',
    type: 'Data Retrieval Function',
    expectedReturn: 'Promise<EvidenceDocument>',
    detail:
      'Member 1 only implemented getEvidenceByCase(req, res) as an Express HTTP controller. ' +
      'No domain function exists to retrieve a single evidence document by ID or code.',
    actionRequired:
      'Member 1 must export async function getEvidence(caseId, evidenceId) returning { _id, evidenceCode, title, content, verificationStatus, ... }',
  },
  {
    signature: 'setAnalysisStatus(caseId, evidenceId, status, error)',
    type: 'Status Lifecycle Function',
    expectedReturn: 'Promise<void>',
    detail:
      'Member 1 does not maintain or update analysis status fields (pending | ok | analysis_failed) on evidence documents.',
    actionRequired:
      'Member 1 must export async function setAnalysisStatus(caseId, evidenceId, status, error) to update evidence.analysisStatus.',
  },
  {
    signature: 'getContext(caseId, options)',
    type: 'Context Retrieval / Semantic Search Function',
    expectedReturn: 'Promise<{ searchHits, memories, hypothesisEvidenceIds, contradictionEvidenceIds, recentEvidence, allCaseEvidence, previousReport }>',
    detail:
      'Member 1 does not provide semantic search, vector embeddings, or an aggregated context query helper.',
    actionRequired:
      'Member 1 must export async function getContext(caseId, { evidenceId, newEvidence }) to return related context items.',
  },
  {
    signature: 'saveReportVersion(caseId, reportData)',
    type: 'Persistence Function',
    expectedReturn: 'Promise<{ version: number, reportId: string }>',
    detail:
      'Member 1 does not provide a service function to atomically increment report version and save AI report outputs.',
    actionRequired:
      'Member 1 must export async function saveReportVersion(caseId, reportData) to persist the AI report to the reports collection.',
  },
  {
    signature: 'applyMemoryProposals(caseId, reportVersion, proposals)',
    type: 'Persistence Function',
    expectedReturn: 'Promise<{ appliedCount: number }>',
    detail:
      'Member 1 does not provide a service function to execute accepted memory proposals (add, supersede, mark_disputed, resolve).',
    actionRequired:
      'Member 1 must export async function applyMemoryProposals(caseId, reportVersion, proposals) to update working memory in MongoDB.',
  },
];

/**
 * Real dependencies adapter object.
 * Any function missing from Member 1 raises MissingMember1FunctionError and halts.
 */
const realDeps = {
  // DB handle adapter from Member 1's db.js if connected
  getDB: () => {
    if (!dbModule || typeof dbModule.getDB !== 'function') {
      throw new MissingMember1FunctionError(
        'getDB()',
        'Database connection module (backend/src/config/db) is missing or uninitialized.'
      );
    }
    return dbModule.getDB();
  },

  connectDB: async () => {
    if (!dbModule || typeof dbModule.connectDB !== 'function') {
      throw new MissingMember1FunctionError(
        'connectDB()',
        'Database connection module (backend/src/config/db) is missing.'
      );
    }
    return await dbModule.connectDB();
  },

  /**
   * 1. Retrieve single evidence item.
   * Missing from Member 1: stop here.
   */
  getEvidence: async (caseId, evidenceId) => {
    throw new MissingMember1FunctionError(
      'getEvidence(caseId, evidenceId)',
      'Member 1 must implement this function to retrieve an evidence item by ID. Mocking is prohibited.'
    );
  },

  /**
   * 2. Set analysis status lifecycle.
   * Missing from Member 1: stop here.
   */
  setAnalysisStatus: async (caseId, evidenceId, status, error) => {
    throw new MissingMember1FunctionError(
      'setAnalysisStatus(caseId, evidenceId, status, error)',
      'Member 1 must implement this function to persist analysis status lifecycle (pending -> ok | analysis_failed).'
    );
  },

  /**
   * 3. Context retrieval / semantic search.
   * Missing from Member 1: stop here.
   */
  getContext: async (caseId, options) => {
    throw new MissingMember1FunctionError(
      'getContext(caseId, options)',
      'Member 1 must implement context retrieval / semantic search. Mocking is prohibited.'
    );
  },

  /**
   * 4. Save report version.
   * Missing from Member 1: stop here.
   */
  saveReportVersion: async (caseId, reportData) => {
    throw new MissingMember1FunctionError(
      'saveReportVersion(caseId, reportData)',
      'Member 1 must implement atomic report version persistence.'
    );
  },

  /**
   * 5. Apply memory proposals.
   * Missing from Member 1: stop here.
   */
  applyMemoryProposals: async (caseId, reportVersion, proposals) => {
    throw new MissingMember1FunctionError(
      'applyMemoryProposals(caseId, reportVersion, proposals)',
      'Member 1 must implement working memory mutation handler.'
    );
  },

  // Export discovery diagnostics
  MISSING_FROM_MEMBER_1,
  MissingMember1FunctionError,
};

module.exports = realDeps;
