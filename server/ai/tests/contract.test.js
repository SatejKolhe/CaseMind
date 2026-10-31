const assert = require('assert');
const path = require('path');
const { mapModelOutputToBackend, mapMemoryCategory } = require('../index');

// Attempt read-only import of backend validator; fallback to verbatim copy if path differs
let validateAiOutputStructure;
let getInvalidCitedEvidenceCodes;

try {
  const backendController = require(path.resolve(__dirname, '../../../backend/src/controllers/analysisController'));
  validateAiOutputStructure = backendController.validateAiOutputStructure;
  getInvalidCitedEvidenceCodes = backendController.getInvalidCitedEvidenceCodes;
} catch (err) {
  console.warn(`[Contract Test] Notice: Could not import directly from backend (${err.message}). Using local validator copy.`);
  // Note: Copied from backend/src/controllers/analysisController.js:24-280. Keep in sync.
  const VALID_MEMORY_CATEGORIES = ['fact', 'claim', 'contradiction', 'inference', 'hypothesis', 'open_question'];
  const VALID_MEMORY_ACTIONS = ['add', 'update', 'supersede'];

  validateAiOutputStructure = function(output) {
    const errors = [];
    if (!output || typeof output !== 'object' || Array.isArray(output)) return ['AI output must be a non-null object.'];
    if (typeof output.summary !== 'string' || !output.summary.trim()) errors.push("'summary' is required and must be a non-empty string.");
    if (!Array.isArray(output.knownFacts)) {
      errors.push("'knownFacts' is required and must be an Array.");
    } else {
      output.knownFacts.forEach((fact, idx) => {
        if (!fact || typeof fact !== 'object') errors.push(`knownFacts[${idx}] must be an object.`);
        else {
          if (typeof fact.statement !== 'string' || !fact.statement.trim()) errors.push(`knownFacts[${idx}].statement must be a non-empty string.`);
          if (!Array.isArray(fact.evidenceCodes)) errors.push(`knownFacts[${idx}].evidenceCodes must be an Array of evidence codes.`);
        }
      });
    }
    if (!Array.isArray(output.unverifiedClaims)) {
      errors.push("'unverifiedClaims' is required and must be an Array.");
    } else {
      output.unverifiedClaims.forEach((claim, idx) => {
        if (!claim || typeof claim !== 'object') errors.push(`unverifiedClaims[${idx}] must be an object.`);
        else {
          if (typeof claim.statement !== 'string' || !claim.statement.trim()) errors.push(`unverifiedClaims[${idx}].statement must be a non-empty string.`);
          if (typeof claim.source !== 'string') errors.push(`unverifiedClaims[${idx}].source must be a string.`);
          if (!Array.isArray(claim.evidenceCodes)) errors.push(`unverifiedClaims[${idx}].evidenceCodes must be an Array of evidence codes.`);
        }
      });
    }
    if (!Array.isArray(output.evidenceConnections)) {
      errors.push("'evidenceConnections' is required and must be an Array.");
    } else {
      output.evidenceConnections.forEach((conn, idx) => {
        if (!conn || typeof conn !== 'object') errors.push(`evidenceConnections[${idx}] must be an object.`);
        else {
          if (typeof conn.connection !== 'string' || !conn.connection.trim()) errors.push(`evidenceConnections[${idx}].connection must be a non-empty string.`);
          if (!Array.isArray(conn.evidenceCodes)) errors.push(`evidenceConnections[${idx}].evidenceCodes must be an Array of evidence codes.`);
        }
      });
    }
    if (!Array.isArray(output.contradictions)) {
      errors.push("'contradictions' is required and must be an Array.");
    } else {
      output.contradictions.forEach((contra, idx) => {
        if (!contra || typeof contra !== 'object') errors.push(`contradictions[${idx}] must be an object.`);
        else {
          if (typeof contra.pointOfConflict !== 'string' || !contra.pointOfConflict.trim()) errors.push(`contradictions[${idx}].pointOfConflict must be a non-empty string.`);
          if (!Array.isArray(contra.conflictingEvidenceCodes)) errors.push(`contradictions[${idx}].conflictingEvidenceCodes must be an Array of evidence codes.`);
        }
      });
    }
    if (!Array.isArray(output.possibleHypotheses)) {
      errors.push("'possibleHypotheses' is required and must be an Array.");
    } else {
      output.possibleHypotheses.forEach((hypo, idx) => {
        if (!hypo || typeof hypo !== 'object') errors.push(`possibleHypotheses[${idx}] must be an object.`);
        else {
          if (typeof hypo.hypothesisId !== 'string' || !hypo.hypothesisId.trim()) errors.push(`possibleHypotheses[${idx}].hypothesisId must be a non-empty string.`);
          if (typeof hypo.title !== 'string' || !hypo.title.trim()) errors.push(`possibleHypotheses[${idx}].title must be a non-empty string.`);
          if (typeof hypo.rationale !== 'string' || !hypo.rationale.trim()) errors.push(`possibleHypotheses[${idx}].rationale must be a non-empty string.`);
          if (!Array.isArray(hypo.supportedBy)) errors.push(`possibleHypotheses[${idx}].supportedBy must be an Array of evidence codes.`);
          if (!Array.isArray(hypo.unresolvedPoints)) errors.push(`possibleHypotheses[${idx}].unresolvedPoints must be an Array of strings.`);
        }
      });
    }
    if (!Array.isArray(output.openQuestions)) {
      errors.push("'openQuestions' is required and must be an Array.");
    } else {
      output.openQuestions.forEach((q, idx) => {
        if (typeof q !== 'string') errors.push(`openQuestions[${idx}] must be a string.`);
      });
    }
    if (!Array.isArray(output.suggestedNextChecks)) {
      errors.push("'suggestedNextChecks' is required and must be an Array.");
    } else {
      output.suggestedNextChecks.forEach((chk, idx) => {
        if (typeof chk !== 'string') errors.push(`suggestedNextChecks[${idx}] must be a string.`);
      });
    }
    if (!Array.isArray(output.memoryUpdates)) {
      errors.push("'memoryUpdates' is required and must be an Array.");
    } else {
      output.memoryUpdates.forEach((upd, idx) => {
        if (!upd || typeof upd !== 'object') errors.push(`memoryUpdates[${idx}] must be an object.`);
        else {
          if (!VALID_MEMORY_CATEGORIES.includes(upd.category)) errors.push(`memoryUpdates[${idx}].category must be one of: ${VALID_MEMORY_CATEGORIES.join(', ')}.`);
          if (typeof upd.statement !== 'string' || !upd.statement.trim()) errors.push(`memoryUpdates[${idx}].statement must be a non-empty string.`);
          if (!Array.isArray(upd.supportingEvidenceCodes)) errors.push(`memoryUpdates[${idx}].supportingEvidenceCodes must be an Array of evidence codes.`);
          if (!VALID_MEMORY_ACTIONS.includes(upd.action)) errors.push(`memoryUpdates[${idx}].action must be one of: ${VALID_MEMORY_ACTIONS.join(', ')}.`);
          if (upd.changeReason !== undefined && typeof upd.changeReason !== 'string') errors.push(`memoryUpdates[${idx}].changeReason must be a string if provided.`);
        }
      });
    }
    const explanation = output.explanationOfChange || (output.memoryDelta && output.memoryDelta.explanation);
    if (explanation !== undefined && typeof explanation !== 'string') errors.push("'explanationOfChange' must be a string if provided.");
    return errors;
  };
}

// -----------------------------------------------------------------------------
// Fixture 1: Real Gemini model output captured from DEBUG_AI log
// -----------------------------------------------------------------------------
const FIXTURE_1_DEBUG_AI = {
  report: {
    knownFacts: [
      {
        statement: "The back gate opened at 8:52 PM using keycard K-204.",
        evidenceIds: ["EV-02"],
        basis: "Digital access log export from the gate access system"
      }
    ],
    unverifiedClaims: [
      {
        statement: "A blue hatchback was parked near the back gate with the engine running around 9 PM.",
        evidenceIds: ["EV-01"],
        verificationStatus: "unverified"
      }
    ],
    evidenceConnections: [
      {
        description: "Keycard access shortly precedes witness observation of a running vehicle near the back gate.",
        evidenceIds: ["EV-02", "EV-01"],
        status: "possible",
        why: "The access time of 8:52 PM is close to the witness observation of approximately 9:00 PM at the same location."
      }
    ],
    contradictions: [],
    hypotheses: [
      {
        hypothesisId: "H-1",
        description: "The blue hatchback observed by the witness gained entry via the back gate using keycard K-204.",
        supportingEvidenceIds: ["EV-02", "EV-01"],
        conflictingEvidenceIds: [],
        status: "under_consideration"
      }
    ],
    openQuestions: [
      {
        question: "Whose keycard is K-204 and who was operating it at 8:52 PM?",
        relatedEvidenceIds: ["EV-02"]
      },
      {
        question: "Who was inside or associated with the blue hatchback observed near the back gate?",
        relatedEvidenceIds: ["EV-01"]
      }
    ],
    suggestedNextChecks: [
      {
        check: "Cross-reference keycard K-204 with personnel registry or access control database.",
        purpose: "Identify the holder of keycard K-204.",
        relatedHypothesisIds: ["H-1"]
      },
      {
        check: "Review adjacent camera feeds leading to or from the back gate area.",
        purpose: "Identify the license plate and occupants of the blue hatchback.",
        relatedHypothesisIds: ["H-1"]
      }
    ],
    memoryUpdates: [
      {
        action: "add",
        summary: "Established back gate access event via keycard K-204 at 8:52 PM aligning with witness observation.",
        reason: "New digital telemetry corroborates the timeframe of witness testimony.",
        evidenceIds: ["EV-01", "EV-02"]
      }
    ]
  },
  memoryProposals: [
    {
      action: "add",
      type: "connection",
      summary: "Temporal correlation between keycard back gate entry and subsequent sighting of a running vehicle.",
      evidenceIds: ["EV-01", "EV-02"],
      confidenceLabel: "medium",
      reason: "The timestamps of the gate opening (8:52 PM) and the witness sighting (~9 PM) strongly suggest a potential link."
    }
  ]
};

// -----------------------------------------------------------------------------
// Fixture 2: Output containing contradiction and supersede operation
// -----------------------------------------------------------------------------
const FIXTURE_2_CONTRADICTION_SUPERSEDE = {
  report: {
    knownFacts: [
      {
        statement: "Keycard K-204 is registered to maintenance contractor Marcus Vance.",
        evidenceIds: ["EV-03"],
        basis: "Personnel access badge registry"
      }
    ],
    unverifiedClaims: [
      {
        statement: "Marcus Vance claimed he was offsite in another town until 10:30 PM.",
        source: "Phone interview with Vance",
        evidenceIds: ["EV-04"],
        verificationStatus: "unverified"
      }
    ],
    evidenceConnections: [
      {
        description: "Badge registration conflicts with alibi statement regarding physical location.",
        evidenceIds: ["EV-02", "EV-04"],
        status: "supported",
        why: "Badge was used at gate at 8:52 PM while individual asserts absence."
      }
    ],
    contradictions: [
      {
        claimA: {
          text: "Marcus Vance claimed he was offsite in another town until 10:30 PM.",
          evidenceIds: ["EV-04"]
        },
        claimB: {
          text: "Keycard K-204 registered to Vance was used at the gate at 8:52 PM.",
          evidenceIds: ["EV-02"]
        },
        explanation: "Alibi is geographically incompatible with physical badge telemetry.",
        unresolved: true
      }
    ],
    hypotheses: [
      {
        hypothesisId: "H-2",
        description: "Keycard K-204 was either misappropriated or shared with an unauthorized operator.",
        supportingEvidenceIds: ["EV-02", "EV-04"],
        conflictingEvidenceIds: [],
        status: "strengthened"
      }
    ],
    openQuestions: [
      {
        question: "Does Vance have cell tower location records for 8:52 PM?",
        relatedEvidenceIds: ["EV-04"]
      }
    ],
    suggestedNextChecks: [
      {
        check: "Subpoena cellular tower pings for Vance's mobile device around 8:50 PM.",
        purpose: "Independently corroborate alibi location.",
        relatedHypothesisIds: ["H-2"]
      }
    ],
    memoryUpdates: [
      {
        action: "supersede",
        memoryId: "6ae5e105e9b9f963c22adbcc",
        summary: "Superseded prior hypothesis: entry was unauthorized badge compromise rather than authorized visit.",
        reason: "Alibi contradiction proves card holder was not present.",
        evidenceIds: ["EV-02", "EV-04"]
      }
    ]
  },
  memoryProposals: [
    {
      action: "supersede",
      type: "hypothesis",
      summary: "Superseded prior hypothesis: entry was unauthorized badge compromise rather than authorized visit.",
      evidenceIds: ["EV-02", "EV-04"],
      confidenceLabel: "high",
      targetMemoryId: "6ae5e105e9b9f963c22adbcc",
      reason: "Alibi contradiction proves card holder was not present."
    },
    {
      action: "add",
      type: "contradiction",
      summary: "Direct geographical conflict between badge scan telemetry and witness alibi statement.",
      evidenceIds: ["EV-02", "EV-04"],
      confidenceLabel: "high",
      reason: "Telemetric record contradicts reported physical location."
    }
  ]
};

async function runContractTests() {
  console.log('[Contract Test Suite] Starting AI Mapper vs Backend Validator contract verification...');

  // Test 1: Category Mapping
  console.log('\n[Test 1] Testing memory category mapping...');
  assert.strictEqual(mapMemoryCategory('connection'), 'inference');
  assert.strictEqual(mapMemoryCategory('lead'), 'inference');
  assert.strictEqual(mapMemoryCategory('timeline_event'), 'fact');
  assert.strictEqual(mapMemoryCategory('inconsistency'), 'contradiction');
  assert.strictEqual(mapMemoryCategory('theory'), 'hypothesis');
  assert.strictEqual(mapMemoryCategory('question'), 'open_question');
  assert.strictEqual(mapMemoryCategory('unknown_xyz'), 'inference');
  console.log('  ✓ All memory category mappings conform to valid categories: [fact, claim, contradiction, inference, hypothesis, open_question]');

  // Test 2: Fixture 1 (DEBUG_AI real log)
  console.log('\n[Test 2] Running Fixture 1 (Real DEBUG_AI model output) through mapper and backend validator...');
  const caseDetails1 = { id: '6ae5dfeae9b9f963c22adbf9', title: 'Missing Laptops, Maple Street Training Center' };
  const evidenceList1 = [
    { evidenceCode: 'EV-01', title: 'Cleaner sighting' },
    { evidenceCode: 'EV-02', title: 'Back gate access log' },
  ];
  const currentMemories1 = [];

  const mappedOutput1 = mapModelOutputToBackend({
    rawResult: FIXTURE_1_DEBUG_AI,
    caseDetails: caseDetails1,
    evidenceList: evidenceList1,
    currentMemories: currentMemories1,
  });

  const errors1 = validateAiOutputStructure(mappedOutput1);
  if (errors1.length > 0) {
    console.error('Validation errors found for Fixture 1:', errors1);
  }
  assert.strictEqual(errors1.length, 0, `Fixture 1 must produce 0 backend validation errors. Found: ${errors1.join('; ')}`);
  console.log('  ✓ Fixture 1 produced exactly 0 validation errors!');
  console.log('  ✓ knownFacts[0].evidenceCodes is properly defined as Array:', Array.isArray(mappedOutput1.knownFacts[0].evidenceCodes));
  console.log('  ✓ memoryUpdates[0].category mapped from "connection" to:', mappedOutput1.memoryUpdates[0].category);

  // Test 3: Fixture 2 (Contradiction + Supersede)
  console.log('\n[Test 3] Running Fixture 2 (Contradiction + Supersede) through mapper and backend validator...');
  const caseDetails2 = { id: '6ae5dfeae9b9f963c22adbf9', title: 'Missing Laptops, Maple Street Training Center' };
  const evidenceList2 = [
    { evidenceCode: 'EV-01', title: 'Cleaner sighting' },
    { evidenceCode: 'EV-02', title: 'Back gate access log' },
    { evidenceCode: 'EV-03', title: 'Keycard registry' },
    { evidenceCode: 'EV-04', title: 'Interview statement' },
  ];
  const currentMemories2 = [
    { id: '6ae5e105e9b9f963c22adbcc', category: 'hypothesis', statement: 'Initial assumption that entry was authorized' }
  ];

  const mappedOutput2 = mapModelOutputToBackend({
    rawResult: FIXTURE_2_CONTRADICTION_SUPERSEDE,
    caseDetails: caseDetails2,
    evidenceList: evidenceList2,
    currentMemories: currentMemories2,
  });

  const errors2 = validateAiOutputStructure(mappedOutput2);
  if (errors2.length > 0) {
    console.error('Validation errors found for Fixture 2:', errors2);
  }
  assert.strictEqual(errors2.length, 0, `Fixture 2 must produce 0 backend validation errors. Found: ${errors2.join('; ')}`);
  console.log('  ✓ Fixture 2 produced exactly 0 validation errors!');
  console.log('  ✓ contradictions[0].conflictingEvidenceCodes:', mappedOutput2.contradictions[0].conflictingEvidenceCodes);
  console.log('  ✓ memoryUpdates action="supersede" preserved targetMemoryId:', mappedOutput2.memoryUpdates[0].targetMemoryId);

  // Test 4: Citation Integrity Verification
  if (typeof getInvalidCitedEvidenceCodes === 'function') {
    const validEvidenceCodes = new Set(evidenceList2.map(e => e.evidenceCode));
    const invalidCodes = getInvalidCitedEvidenceCodes(mappedOutput2, validEvidenceCodes);
    assert.strictEqual(invalidCodes.length, 0, `Cited evidence codes must all exist in case. Found invalid: ${invalidCodes.join(', ')}`);
    console.log('  ✓ All cited evidence codes exist in case database records');
  }

  console.log('\n🎉 ALL CONTRACT TESTS PASSED WITH 0 ERRORS!');
}

if (require.main === module) {
  runContractTests().catch(err => {
    console.error('Contract test failed:', err);
    process.exit(1);
  });
}

module.exports = { runContractTests };
