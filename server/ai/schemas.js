const { z } = require('zod');

/**
 * Ethical guardrail forbidden field names.
 * CaseMind explicitly prohibits determining guilt or designating culprits/suspects.
 */
const FORBIDDEN_FIELDS = ['guilty', 'culprit', 'suspectidentified'];

/**
 * Recursively inspects data for any forbidden keys.
 * Returns the forbidden key name if found, or null otherwise.
 */
function findForbiddenField(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenField(item);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_FIELDS.includes(key.toLowerCase())) {
      return key;
    }
    const found = findForbiddenField(value[key]);
    if (found) return found;
  }
  return null;
}

/**
 * Zod refinement to enforce ethical guardrail against guilt/culprit determinations.
 */
function guardrailRefinement(val, ctx) {
  const forbidden = findForbiddenField(val);
  if (forbidden) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Ethical guardrail violation: Field "${forbidden}" is strictly prohibited. CaseMind never determines guilt, culprits, or suspects.`,
    });
  }
}

// ---------------------------------------------------------------------------
// 1. Report Sub-Schemas (8 sections per SPEC.md)
// ---------------------------------------------------------------------------

const ConnectionStatusEnum = z.enum(['possible', 'unconfirmed', 'supported']);
const HypothesisStatusEnum = z.enum(['under_consideration', 'strengthened', 'weakened', 'unsupported']);
const MemoryActionEnum = z.enum(['add', 'supersede', 'mark_disputed', 'resolve']);
const ConfidenceLabelEnum = z.enum(['low', 'medium', 'high']);

/**
 * 1. Known Fact: statement backed by real evidence and a sound basis.
 */
const KnownFactSchema = z.object({
  statement: z.string().min(1, 'statement must not be empty'),
  evidenceIds: z.array(z.string().min(1, 'evidenceId must not be empty')).min(1, 'knownFacts must cite at least one evidenceId'),
  basis: z.string().min(1, 'basis must not be empty'),
}).strict().superRefine(guardrailRefinement);

/**
 * 2. Unverified Claim: statement from witness/source with verification status.
 */
const UnverifiedClaimSchema = z.object({
  statement: z.string().min(1, 'statement must not be empty'),
  evidenceIds: z.array(z.string().min(1, 'evidenceId must not be empty')).min(1, 'unverifiedClaims must cite at least one evidenceId'),
  verificationStatus: z.string().min(1, 'verificationStatus must not be empty'),
}).strict().superRefine(guardrailRefinement);

/**
 * 3. Evidence Connection: linkage between multiple evidence items.
 */
const EvidenceConnectionSchema = z.object({
  description: z.string().min(1, 'description must not be empty'),
  evidenceIds: z.array(z.string().min(1, 'evidenceId must not be empty')).min(1, 'evidenceConnections must cite at least one evidenceId'),
  status: ConnectionStatusEnum,
  why: z.string().min(1, 'why must not be empty'),
}).strict().superRefine(guardrailRefinement);

/**
 * 4. Contradiction: irreconcilable conflict between two cited claims.
 */
const ContradictionClaimSchema = z.object({
  text: z.string().min(1, 'text must not be empty'),
  evidenceIds: z.array(z.string().min(1, 'evidenceId must not be empty')).min(1, 'claim must cite at least one evidenceId'),
}).strict().superRefine(guardrailRefinement);

const ContradictionSchema = z.object({
  claimA: ContradictionClaimSchema,
  claimB: ContradictionClaimSchema,
  explanation: z.string().min(1, 'explanation must not be empty'),
  unresolved: z.boolean(),
}).strict().superRefine(guardrailRefinement);

/**
 * 5. Hypothesis: provisional working investigative theory.
 */
const HypothesisSchema = z.object({
  hypothesisId: z.string().min(1, 'hypothesisId must not be empty'),
  description: z.string().min(1, 'description must not be empty'),
  supportingEvidenceIds: z.array(z.string().min(1, 'supportingEvidenceId must not be empty')),
  conflictingEvidenceIds: z.array(z.string().min(1, 'conflictingEvidenceId must not be empty')),
  status: HypothesisStatusEnum,
}).strict().superRefine(guardrailRefinement);

/**
 * 6. Open Question: investigative intelligence gap (evidence citations optional).
 */
const OpenQuestionSchema = z.object({
  question: z.string().min(1, 'question must not be empty'),
  relatedEvidenceIds: z.array(z.string().min(1, 'relatedEvidenceId must not be empty')),
}).strict().superRefine(guardrailRefinement);

/**
 * 7. Suggested Next Check: investigative next step (hypothesis citations optional).
 */
const SuggestedNextCheckSchema = z.object({
  check: z.string().min(1, 'check must not be empty'),
  purpose: z.string().min(1, 'purpose must not be empty'),
  relatedHypothesisIds: z.array(z.string().min(1, 'relatedHypothesisId must not be empty')),
}).strict().superRefine(guardrailRefinement);

/**
 * 8. Memory Update: proposed update item embedded in the report.
 */
const MemoryUpdateSchema = z.object({
  action: MemoryActionEnum,
  memoryId: z.string().optional().nullable().transform((val) => (val && val.trim() ? val.trim() : undefined)),
  summary: z.string().min(1, 'summary must not be empty'),
  reason: z.string().min(1, 'reason must not be empty'),
  evidenceIds: z.array(z.string().min(1, 'evidenceId must not be empty')).min(1, 'memoryUpdates must cite at least one evidenceId'),
}).strict().superRefine(guardrailRefinement);

/**
 * Full Report Schema containing all 8 sections per SPEC.md.
 */
const ReportSchema = z.object({
  knownFacts: z.array(KnownFactSchema),
  unverifiedClaims: z.array(UnverifiedClaimSchema),
  evidenceConnections: z.array(EvidenceConnectionSchema),
  contradictions: z.array(ContradictionSchema),
  hypotheses: z.array(HypothesisSchema),
  openQuestions: z.array(OpenQuestionSchema),
  suggestedNextChecks: z.array(SuggestedNextCheckSchema),
  memoryUpdates: z.array(MemoryUpdateSchema),
}).strict().superRefine(guardrailRefinement);

// ---------------------------------------------------------------------------
// 2. Memory Proposal Schema (for backend validation & persistence)
// ---------------------------------------------------------------------------

const MemoryProposalSchema = z.object({
  action: MemoryActionEnum,
  type: z.string().min(1, 'type must not be empty'),
  summary: z.string().min(1, 'summary must not be empty'),
  evidenceIds: z.array(z.string().min(1, 'evidenceId must not be empty')).min(1, 'evidenceIds must not be empty'),
  confidenceLabel: ConfidenceLabelEnum,
  targetMemoryId: z.string().optional().nullable().transform((val) => (val && val.trim() ? val.trim() : undefined)),
  reason: z.string().min(1, 'reason must not be empty'),
}).strict().superRefine(guardrailRefinement);

// ---------------------------------------------------------------------------
// 3. Model Output Schema (Combined Report + Memory Proposals)
// ---------------------------------------------------------------------------

const ModelOutputSchema = z.object({
  report: ReportSchema,
  memoryProposals: z.array(MemoryProposalSchema),
}).strict().superRefine(guardrailRefinement);

// ---------------------------------------------------------------------------
// 4. Intake Candidate Schema (for new evidence ingestion)
// ---------------------------------------------------------------------------

const IntakeCandidateSchema = z.object({
  type: z.string().min(1, 'type must not be empty'),
  description: z.string().min(1, 'description must not be empty'),
  sourceLabel: z.string().min(1, 'sourceLabel must not be empty'),
  eventTime: z.string().nullable(),
  eventTimeText: z.string(),
  verificationStatus: z.literal('unverified'),
  originalText: z.string().min(1, 'originalText must not be empty'),
  englishGloss: z.string().nullable(),
}).strict().superRefine(guardrailRefinement);

// ---------------------------------------------------------------------------
// 5. Plain JSON Schema Export for Provider Structured Output (Gemini / OpenAI)
// ---------------------------------------------------------------------------

const modelOutputJsonSchema = {
  type: 'object',
  properties: {
    report: {
      type: 'object',
      properties: {
        knownFacts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              statement: { type: 'string' },
              evidenceIds: { type: 'array', items: { type: 'string' } },
              basis: { type: 'string' },
            },
            required: ['statement', 'evidenceIds', 'basis'],
          },
        },
        unverifiedClaims: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              statement: { type: 'string' },
              evidenceIds: { type: 'array', items: { type: 'string' } },
              verificationStatus: { type: 'string' },
            },
            required: ['statement', 'evidenceIds', 'verificationStatus'],
          },
        },
        evidenceConnections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              evidenceIds: { type: 'array', items: { type: 'string' } },
              status: { type: 'string', enum: ['possible', 'unconfirmed', 'supported'] },
              why: { type: 'string' },
            },
            required: ['description', 'evidenceIds', 'status', 'why'],
          },
        },
        contradictions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              claimA: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  evidenceIds: { type: 'array', items: { type: 'string' } },
                },
                required: ['text', 'evidenceIds'],
              },
              claimB: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  evidenceIds: { type: 'array', items: { type: 'string' } },
                },
                required: ['text', 'evidenceIds'],
              },
              explanation: { type: 'string' },
              unresolved: { type: 'boolean' },
            },
            required: ['claimA', 'claimB', 'explanation', 'unresolved'],
          },
        },
        hypotheses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              hypothesisId: { type: 'string' },
              description: { type: 'string' },
              supportingEvidenceIds: { type: 'array', items: { type: 'string' } },
              conflictingEvidenceIds: { type: 'array', items: { type: 'string' } },
              status: {
                type: 'string',
                enum: ['under_consideration', 'strengthened', 'weakened', 'unsupported'],
              },
            },
            required: ['hypothesisId', 'description', 'supportingEvidenceIds', 'conflictingEvidenceIds', 'status'],
          },
        },
        openQuestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question: { type: 'string' },
              relatedEvidenceIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['question', 'relatedEvidenceIds'],
          },
        },
        suggestedNextChecks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              check: { type: 'string' },
              purpose: { type: 'string' },
              relatedHypothesisIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['check', 'purpose', 'relatedHypothesisIds'],
          },
        },
        memoryUpdates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['add', 'supersede', 'mark_disputed', 'resolve'] },
              memoryId: { type: 'string' },
              summary: { type: 'string' },
              reason: { type: 'string' },
              evidenceIds: { type: 'array', items: { type: 'string' } },
            },
            required: ['action', 'summary', 'reason', 'evidenceIds'],
          },
        },
      },
      required: [
        'knownFacts',
        'unverifiedClaims',
        'evidenceConnections',
        'contradictions',
        'hypotheses',
        'openQuestions',
        'suggestedNextChecks',
        'memoryUpdates',
      ],
    },
    memoryProposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'supersede', 'mark_disputed', 'resolve'] },
          type: { type: 'string' },
          summary: { type: 'string' },
          evidenceIds: { type: 'array', items: { type: 'string' } },
          confidenceLabel: { type: 'string', enum: ['low', 'medium', 'high'] },
          targetMemoryId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['action', 'type', 'summary', 'evidenceIds', 'confidenceLabel', 'reason'],
      },
    },
  },
  required: ['report', 'memoryProposals'],
};

module.exports = {
  // Enums
  ConnectionStatusEnum,
  HypothesisStatusEnum,
  MemoryActionEnum,
  ConfidenceLabelEnum,

  // Section Schemas
  KnownFactSchema,
  UnverifiedClaimSchema,
  EvidenceConnectionSchema,
  ContradictionSchema,
  HypothesisSchema,
  OpenQuestionSchema,
  SuggestedNextCheckSchema,
  MemoryUpdateSchema,

  // Top-Level Schemas
  ReportSchema,
  MemoryProposalSchema,
  ModelOutputSchema,
  IntakeCandidateSchema,

  // Guardrail helpers
  FORBIDDEN_FIELDS,
  findForbiddenField,

  // Plain JSON Schema
  modelOutputJsonSchema,
};
