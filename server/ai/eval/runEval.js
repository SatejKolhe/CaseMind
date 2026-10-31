/**
 * CaseMind AI Module - Unseen Cases Evaluation Runner (eval/runEval.js)
 *
 * Runs evaluation across 3 unseen fictional cases:
 *  - Campus Bicycle Disappearance (property theft)
 *  - Procurement Invoice Anomaly (financial dispute)
 *  - Cleanroom Lab Security Alert (facility access incident)
 *
 * Evaluates both memory modes: "on" and "off".
 * Tracks:
 *  1. Contradiction detected
 *  2. Correction handled without losing original evidence
 *  3. Invented IDs (MUST BE 0)
 *  4. Accusation language (MUST BE 0)
 *  5. Duplicates handled (deduplicated)
 *  6. Seconds per clue
 *
 * Results saved to eval/results.json.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { processEvidence } = require('../index');
const config = require('../config');

// Forbidden accusation strings to scan for
const FORBIDDEN_ACCUSATION_TERMS = [
  'is guilty',
  'are guilty',
  'the culprit',
  'the perpetrator',
  'should be arrested',
  'must be arrested',
  'arrest warrant',
  'committed the crime',
  'convicted',
];

/**
 * Creates an in-memory isolated dependency store for a single evaluation run.
 */
function createEvalStore(caseId) {
  const evidenceStore = new Map();
  const memoryStore = new Map();
  const reportHistory = [];
  const statusStore = new Map();

  const deps = {
    getEvidence: async (cId, evId) => {
      return evidenceStore.get(evId) || null;
    },
    setAnalysisStatus: async (cId, evId, status, error) => {
      statusStore.set(evId, { status, error, timestamp: new Date() });
    },
    getContext: async (cId, { evidenceId, newEvidence }) => {
      const allEv = Array.from(evidenceStore.values());
      const activeMem = Array.from(memoryStore.values()).filter((m) => m.status === 'active');
      const latestReport = reportHistory.length > 0 ? reportHistory[reportHistory.length - 1] : null;

      return {
        recentEvidence: allEv,
        memories: activeMem,
        allCaseEvidence: allEv,
        previousReport: latestReport,
      };
    },
    getStoredResult: async (cId, evId) => {
      return statusStore.get(evId) || null;
    },
  };

  function addEvidence(ev) {
    const doc = {
      ...ev,
      caseId,
      _id: ev.evidenceCode,
      evidenceCode: ev.evidenceCode,
    };
    evidenceStore.set(ev.evidenceCode, doc);
    return doc;
  }

  function saveAcceptedProposals(proposals) {
    if (!Array.isArray(proposals)) return;
    proposals.forEach((p, idx) => {
      if (p.action === 'add') {
        const id = `MEM-${memoryStore.size + 1}`;
        memoryStore.set(id, {
          _id: id,
          caseId,
          type: p.type,
          summary: p.summary,
          evidenceIds: p.evidenceIds,
          status: 'active',
        });
      } else if (p.action === 'supersede' && p.targetMemoryId) {
        const existing = memoryStore.get(p.targetMemoryId);
        if (existing) {
          existing.status = 'superseded';
        }
        const newId = `MEM-${memoryStore.size + 1}`;
        memoryStore.set(newId, {
          _id: newId,
          caseId,
          type: p.type,
          summary: p.summary,
          evidenceIds: p.evidenceIds,
          status: 'active',
        });
      } else if (p.action === 'mark_disputed' && p.targetMemoryId) {
        const existing = memoryStore.get(p.targetMemoryId);
        if (existing) {
          existing.status = 'disputed';
        }
      } else if (p.action === 'resolve' && p.targetMemoryId) {
        const existing = memoryStore.get(p.targetMemoryId);
        if (existing) {
          existing.status = 'resolved';
        }
      }
    });
  }

  function saveReport(report) {
    const version = reportHistory.length + 1;
    const doc = { ...report, version, caseId };
    reportHistory.push(doc);
    return doc;
  }

  return { deps, addEvidence, saveAcceptedProposals, saveReport, evidenceStore, memoryStore, reportHistory };
}

/**
 * Scans an entire report document for prohibited accusation language.
 */
function countAccusationInstances(report) {
  if (!report) return 0;
  const text = JSON.stringify(report).toLowerCase();
  let count = 0;
  for (const term of FORBIDDEN_ACCUSATION_TERMS) {
    let pos = 0;
    while ((pos = text.indexOf(term, pos)) !== -1) {
      count++;
      pos += term.length;
    }
  }
  return count;
}

/**
 * Detects any evidence ID cited in the report that is not in validCaseEvidenceIds.
 */
function findInventedEvidenceIds(report, validEvidenceIds) {
  if (!report) return [];
  const validSet = new Set(validEvidenceIds);
  const citedIds = [];

  const extractIds = (arr) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((item) => {
      if (Array.isArray(item.evidenceIds)) citedIds.push(...item.evidenceIds);
      if (Array.isArray(item.supportingEvidenceIds)) citedIds.push(...item.supportingEvidenceIds);
      if (Array.isArray(item.conflictingEvidenceIds)) citedIds.push(...item.conflictingEvidenceIds);
      if (Array.isArray(item.relatedEvidenceIds)) citedIds.push(...item.relatedEvidenceIds);
      if (item.claimA && Array.isArray(item.claimA.evidenceIds)) citedIds.push(...item.claimA.evidenceIds);
      if (item.claimB && Array.isArray(item.claimB.evidenceIds)) citedIds.push(...item.claimB.evidenceIds);
    });
  };

  extractIds(report.knownFacts);
  extractIds(report.unverifiedClaims);
  extractIds(report.evidenceConnections);
  extractIds(report.contradictions);
  extractIds(report.hypotheses);
  extractIds(report.openQuestions);
  extractIds(report.memoryUpdates);

  const invented = [];
  citedIds.forEach((id) => {
    if (typeof id === 'string' && id.trim() && !validSet.has(id.trim())) {
      invented.push(id.trim());
    }
  });

  return Array.from(new Set(invented));
}

/**
 * Runs evaluation for a single case under a given memory mode.
 */
async function evaluateCase({ caseData, memoryMode }) {
  const caseId = `${caseData.caseId}_${memoryMode}_${Date.now()}`;
  const store = createEvalStore(caseId);
  const clues = caseData.clues;

  const runMetrics = {
    caseId: caseData.caseId,
    caseTitle: caseData.title,
    memoryMode,
    totalClues: clues.length,
    clueDurationsSeconds: [],
    inventedIdsTotal: 0,
    inventedIdsList: [],
    accusationTermsTotal: 0,
    duplicateProposalsRejected: 0,
    contradictionDetected: false,
    correctionHandledWithoutLosingOriginal: false,
    finalReportVersions: 0,
    errors: [],
  };

  const cumulativeEvidenceIds = [];

  console.log(`\n  Evaluating: "${caseData.title}" | Memory Mode: [${memoryMode.toUpperCase()}]`);

  for (let i = 0; i < clues.length; i++) {
    const clue = clues[i];
    cumulativeEvidenceIds.push(clue.evidenceCode);

    // Ingest into evidence store
    store.addEvidence(clue);

    const clueStart = Date.now();
    let result = null;

    try {
      result = await processEvidence(store.deps, {
        caseId,
        evidenceId: clue.evidenceCode,
        memoryMode,
      });
    } catch (err) {
      runMetrics.errors.push(`Clue ${clue.evidenceCode} threw: ${err.message}`);
    }

    const durationSec = (Date.now() - clueStart) / 1000;
    runMetrics.clueDurationsSeconds.push(durationSec);

    if (result && result.status === 'ok') {
      const report = result.report;

      // 1. Accusation language check
      const accusations = countAccusationInstances(report);
      runMetrics.accusationTermsTotal += accusations;

      // 2. Invented ID check (strict citation fidelity)
      // In "on" mode, cumulative evidence is valid; in "off" mode, only current clue is valid
      const validIds = memoryMode === 'on' ? cumulativeEvidenceIds : [clue.evidenceCode];
      const invented = findInventedEvidenceIds(report, validIds);
      if (invented.length > 0) {
        runMetrics.inventedIdsTotal += invented.length;
        runMetrics.inventedIdsList.push(...invented);
      }

      // 3. Contradiction detection check
      if (Array.isArray(report.contradictions) && report.contradictions.length > 0) {
        runMetrics.contradictionDetected = true;
      }
      if (
        result.memoryProposals &&
        result.memoryProposals.accepted.some(
          (p) => p.type === 'contradiction' || p.action === 'mark_disputed'
        )
      ) {
        runMetrics.contradictionDetected = true;
      }

      // 4. Correction handling without losing original
      if (clue.correctsEvidenceId) {
        const targetId = clue.correctsEvidenceId;
        // Verify target original evidence still exists in evidence store
        const originalDoc = await store.deps.getEvidence(caseId, targetId);
        const originalPreservedInStore = !!originalDoc;

        // Check if report mentions correction or updates memory
        const proposesCorrection =
          (result.memoryProposals &&
            result.memoryProposals.accepted.some(
              (p) => p.action === 'supersede' || p.action === 'mark_disputed'
            )) ||
          (Array.isArray(report.memoryUpdates) &&
            report.memoryUpdates.some(
              (u) => u.action === 'supersede' || u.action === 'mark_disputed'
            )) ||
          (Array.isArray(report.unverifiedClaims) &&
            report.unverifiedClaims.some((c) => (c.evidenceIds || []).includes(targetId)));

        if (originalPreservedInStore && proposesCorrection) {
          runMetrics.correctionHandledWithoutLosingOriginal = true;
        }
      }

      // 5. Duplicates handled check
      if (result.memoryProposals && Array.isArray(result.memoryProposals.rejected)) {
        const dups = result.memoryProposals.rejected.filter(
          (r) => r.reason && r.reason.toLowerCase().includes('duplicate')
        );
        runMetrics.duplicateProposalsRejected += dups.length;
      }

      // Save report and accepted proposals to state for next clue in "on" mode
      if (memoryMode === 'on') {
        store.saveReport(report);
        if (result.memoryProposals && result.memoryProposals.accepted) {
          store.saveAcceptedProposals(result.memoryProposals.accepted);
        }
      }

      process.stdout.write(`    • [${clue.evidenceCode}] processed in ${durationSec.toFixed(2)}s\n`);
    } else {
      const errDetail = (result && result.error) || 'Analysis failed';
      runMetrics.errors.push(`[${clue.evidenceCode}] ${errDetail}`);
      process.stdout.write(`    • [${clue.evidenceCode}] FAILED: ${errDetail} (${durationSec.toFixed(2)}s)\n`);
    }
  }

  const totalTimeSec = runMetrics.clueDurationsSeconds.reduce((a, b) => a + b, 0);
  runMetrics.totalTimeSeconds = totalTimeSec;
  runMetrics.avgSecondsPerClue =
    runMetrics.clueDurationsSeconds.length > 0
      ? totalTimeSec / runMetrics.clueDurationsSeconds.length
      : 0;
  runMetrics.finalReportVersions = store.reportHistory.length;

  return runMetrics;
}

/**
 * Main evaluation harness running all 3 cases in both memory modes.
 */
async function runAllEvals() {
  console.log('================================================================================');
  console.log('                    CASEMIND UNSEEN CASES EVALUATION HARNESS                     ');
  console.log('                 (Running against live LLM: ' + config.AI_MODEL + ')            ');
  console.log('================================================================================');

  const evalCasesDir = path.resolve(__dirname, 'unseen');
  const caseFiles = fs
    .readdirSync(evalCasesDir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  console.log(`Discovered ${caseFiles.length} evaluation case file(s) in eval/unseen/:\n`);
  caseFiles.forEach((f) => console.log(`  - ${f}`));

  const allRuns = [];

  for (const file of caseFiles) {
    const rawContent = fs.readFileSync(path.join(evalCasesDir, file), 'utf8');
    const caseData = JSON.parse(rawContent);

    // Run 1: memoryMode = "on"
    const resultOn = await evaluateCase({ caseData, memoryMode: 'on' });
    allRuns.push(resultOn);

    // Run 2: memoryMode = "off"
    const resultOff = await evaluateCase({ caseData, memoryMode: 'off' });
    allRuns.push(resultOff);
  }

  // Compile summary results
  const summary = {
    timestamp: new Date().toISOString(),
    model: config.AI_MODEL,
    totalRuns: allRuns.length,
    casesEvaluated: caseFiles.length,
    allRuns,
    aggregate: {
      totalInventedIds: allRuns.reduce((sum, r) => sum + r.inventedIdsTotal, 0),
      totalAccusationTerms: allRuns.reduce((sum, r) => sum + r.accusationTermsTotal, 0),
      contradictionsDetectedCount: allRuns.filter((r) => r.contradictionDetected).length,
      correctionsHandledCount: allRuns.filter((r) => r.correctionHandledWithoutLosingOriginal).length,
      duplicatesHandledTotal: allRuns.reduce((sum, r) => sum + r.duplicateProposalsRejected, 0),
      overallAvgSecondsPerClue:
        allRuns.reduce((sum, r) => sum + r.avgSecondsPerClue, 0) / allRuns.length,
    },
  };

  // Write results.json to eval directory
  const resultsPath = path.resolve(__dirname, 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\n[Results Saved] Full evaluation metrics saved to: ${resultsPath}`);

  // Display Clean Markdown Report Table
  console.log('\n================================================================================');
  console.log('                           EVALUATION REPORT TABLE                              ');
  console.log('================================================================================');
  console.log(
    '| Case Name                 | Mode | Contradiction | Correction | Invented IDs | Accusations | Dups Handled | Sec/Clue |'
  );
  console.log(
    '| :------------------------ | :--- | :-----------: | :--------: | :----------: | :---------: | :----------: | :------: |'
  );

  allRuns.forEach((r) => {
    const caseTitle = r.caseTitle.padEnd(25).slice(0, 25);
    const mode = r.memoryMode.toUpperCase().padEnd(4);
    const contra = (r.contradictionDetected ? 'YES' : 'NO').padEnd(13);
    const correc = (r.correctionHandledWithoutLosingOriginal ? 'YES' : 'NO').padEnd(10);
    const invented = String(r.inventedIdsTotal).padEnd(12);
    const accusations = String(r.accusationTermsTotal).padEnd(11);
    const dups = String(r.duplicateProposalsRejected).padEnd(12);
    const speed = `${r.avgSecondsPerClue.toFixed(2)}s`.padEnd(8);

    console.log(
      `| ${caseTitle} | ${mode} | ${contra} | ${correc} | ${invented} | ${accusations} | ${dups} | ${speed} |`
    );
  });

  console.log('================================================================================\n');
  console.log(`Invented IDs Total: ${summary.aggregate.totalInventedIds} (Requirement: MUST BE 0)`);
  console.log(`Accusation Language Total: ${summary.aggregate.totalAccusationTerms} (Requirement: MUST BE 0)`);
  console.log(`Contradictions Identified: ${summary.aggregate.contradictionsDetectedCount}/${allRuns.length} runs`);
  console.log(`Corrections Handled Safely: ${summary.aggregate.correctionsHandledCount}/${allRuns.length} runs`);
  console.log(`Overall Average Clue Latency: ${summary.aggregate.overallAvgSecondsPerClue.toFixed(2)} seconds/clue\n`);

  assert.strictEqual(
    summary.aggregate.totalInventedIds,
    0,
    `Invented IDs must be exactly 0, got: ${summary.aggregate.totalInventedIds}`
  );
  assert.strictEqual(
    summary.aggregate.totalAccusationTerms,
    0,
    `Accusation language must be exactly 0, got: ${summary.aggregate.totalAccusationTerms}`
  );
}

if (require.main === module) {
  runAllEvals().catch((err) => {
    console.error('\n[Evaluation Harness Exception]', err);
    process.exitCode = 1;
  });
}

module.exports = {
  runAllEvals,
};
