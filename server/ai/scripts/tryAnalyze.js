const path = require('path');
const fs = require('fs');
const { analyze } = require('../analyze');
const { normalizeProposals } = require('../memoryLogic');

/**
 * Resolves fixture path from CLI argument or shorthand name.
 */
function resolveFixturePath(arg) {
  const defaultFixture = 'theft';
  const name = (arg || defaultFixture).toLowerCase().trim();

  if (name.includes('theft') || name === '1' || name === 'case1') {
    return path.resolve(__dirname, '../tests/fixtures/case1_theft.json');
  }
  if (name.includes('leak') || name.includes('data') || name === '2' || name === 'case2') {
    return path.resolve(__dirname, '../tests/fixtures/case2_data_leak.json');
  }

  const candidate = path.resolve(process.cwd(), arg);
  if (fs.existsSync(candidate)) {
    return candidate;
  }

  throw new Error(`Unable to find fixture matching "${arg}". Available fixtures: "theft", "data_leak".`);
}

/**
 * Applies accepted memory proposals to update working memory state across steps.
 */
function applyProposalsToMemories(memories, acceptedProposals, stepNumber) {
  const updated = [...memories];
  let memCounter = updated.length + 1;

  for (const p of acceptedProposals) {
    if (p.action === 'add') {
      updated.push({
        id: `MEM-${memCounter++}`,
        type: p.type,
        summary: p.summary,
        evidenceIds: p.evidenceIds || [],
        confidenceLabel: p.confidenceLabel,
        status: 'active',
        stepAdded: stepNumber,
      });
    } else if (p.action === 'supersede') {
      // Mark target as superseded
      const target = updated.find((m) => m.id === p.targetMemoryId);
      if (target) {
        target.status = 'superseded';
        target.supersededByStep = stepNumber;
      }
      // Insert new superseded version
      updated.push({
        id: `MEM-${memCounter++}`,
        type: p.type,
        summary: p.summary,
        evidenceIds: p.evidenceIds || [],
        confidenceLabel: p.confidenceLabel,
        status: 'active',
        supersedes: p.targetMemoryId,
        stepAdded: stepNumber,
      });
    } else if (p.action === 'mark_disputed') {
      const target = updated.find((m) => m.id === p.targetMemoryId);
      if (target) {
        target.status = 'disputed';
        target.disputeReason = p.reason;
      }
    } else if (p.action === 'resolve') {
      const target = updated.find((m) => m.id === p.targetMemoryId);
      if (target) {
        target.status = 'resolved';
        target.resolvedReason = p.reason;
      }
    }
  }

  return updated;
}

async function run() {
  const fixtureArg = process.argv[2];
  let fixturePath;

  try {
    fixturePath = resolveFixturePath(fixtureArg);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[tryAnalyze] Loading fixture: ${path.basename(fixturePath)}`);
  const fixtureContent = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const evidenceList = fixtureContent.evidence;

  if (!Array.isArray(evidenceList) || evidenceList.length === 0) {
    console.error('❌ Fixture must contain evidence items.');
    process.exitCode = 1;
    return;
  }

  console.log(`========================================================================`);
  console.log(`CASE: "${fixtureContent.title}" (${fixtureContent.caseId})`);
  console.log(`Total Clues in Sequence: ${evidenceList.length}`);
  console.log(`========================================================================\n`);

  let workingMemories = [];
  let previousReport = null;

  for (let step = 0; step < evidenceList.length; step++) {
    const currentClue = evidenceList[step];
    const priorClues = evidenceList.slice(0, step);
    const stepNumber = step + 1;

    console.log(`------------------------------------------------------------------------`);
    console.log(`STEP ${stepNumber}/${evidenceList.length}: Ingesting ${currentClue.id} ("${currentClue.title}")`);
    console.log(`Prior Clues in Context (${priorClues.length}): ${priorClues.map((e) => e.id).join(', ') || 'None'}`);
    console.log(`Active Working Memories Input (${workingMemories.filter((m) => m.status === 'active').length}):`);
    workingMemories.forEach((m) => {
      console.log(`  • [${m.id}] (${m.status}, ${m.type}): ${m.summary}`);
    });
    console.log(`------------------------------------------------------------------------`);

    const startTime = Date.now();
    try {
      const { report, memoryProposals } = await analyze({
        newEvidence: currentClue,
        relatedEvidence: priorClues,
        memories: workingMemories,
        previousReport,
      });

      const elapsed = Date.now() - startTime;
      console.log(`  ✓ Analysis completed in ${elapsed}ms`);

      // Normalize proposals through memoryLogic
      const { accepted, rejected } = normalizeProposals(memoryProposals, workingMemories);

      console.log(`\n  PROPOSALS AT STEP ${stepNumber}:`);
      console.log(`  • Raw Model Proposals: ${memoryProposals.length}`);
      console.log(`  • Accepted Proposals (${accepted.length}):`);
      if (accepted.length === 0) {
        console.log(`    (none accepted)`);
      } else {
        accepted.forEach((p, i) => {
          const target = p.targetMemoryId ? ` -> target: ${p.targetMemoryId}` : '';
          console.log(`    ${i + 1}. [${p.action.toUpperCase()}] (${p.type}, ${p.confidenceLabel} conf)${target}`);
          console.log(`       Statement: "${p.summary}"`);
          console.log(`       Evidence : [${(p.evidenceIds || []).join(', ')}]`);
          console.log(`       Reason   : ${p.reason}`);
        });
      }

      console.log(`  • Rejected / Dropped Proposals (${rejected.length}):`);
      if (rejected.length === 0) {
        console.log(`    (none rejected)`);
      } else {
        rejected.forEach((r, i) => {
          console.log(`    ${i + 1}. [REJECTED: ${r.reason}]`);
          console.log(`       Action: [${r.proposal?.action || 'unknown'}] "${r.proposal?.summary || ''}"`);
        });
      }

      console.log(`\n  REPORT SUMMARY AT STEP ${stepNumber}:`);
      console.log(`  • Known Facts: ${report.knownFacts.length}`);
      console.log(`  • Unverified Claims: ${report.unverifiedClaims.length}`);
      console.log(`  • Contradictions: ${report.contradictions.length}`);
      console.log(`  • Hypotheses: ${report.hypotheses.map((h) => `${h.hypothesisId} (${h.status})`).join(', ') || 'None'}`);
      console.log(`  • Open Questions: ${report.openQuestions.length}`);

      // Update state for next step
      workingMemories = applyProposalsToMemories(workingMemories, accepted, stepNumber);
      previousReport = report;
      console.log(`\n  Cumulative Memories After Step ${stepNumber}: ${workingMemories.length} total (${workingMemories.filter((m) => m.status === 'active').length} active)\n`);
    } catch (err) {
      console.error(`\n❌ Error during Step ${stepNumber}:`, err.message);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`========================================================================`);
  console.log(`🎉 COMPLETED MULTI-STEP ANALYSIS FOR: ${fixtureContent.title}`);
  console.log(`Final Active Working Memories: ${workingMemories.filter((m) => m.status === 'active').length}`);
  console.log(`========================================================================\n`);
  process.exitCode = 0;
}

run();
