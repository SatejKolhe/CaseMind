const path = require('path');
const fs = require('fs');
const { analyze } = require('../analyze');

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

  // Direct file path
  const candidate = path.resolve(process.cwd(), arg);
  if (fs.existsSync(candidate)) {
    return candidate;
  }

  throw new Error(`Unable to find fixture matching "${arg}". Available fixtures: "theft", "data_leak".`);
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
  if (!Array.isArray(evidenceList) || evidenceList.length < 2) {
    console.error('❌ Fixture must contain at least 2 evidence items to test incremental analysis.');
    process.exitCode = 1;
    return;
  }

  // All earlier clues act as prior context; the final clue is the newly ingested clue
  const relatedEvidence = evidenceList.slice(0, -1);
  const newEvidence = evidenceList[evidenceList.length - 1];

  console.log(`[tryAnalyze] Case: "${fixtureContent.title}" (${fixtureContent.caseId})`);
  console.log(`  • Prior Clues (${relatedEvidence.length}): ${relatedEvidence.map((e) => e.id).join(', ')}`);
  console.log(`  • Ingesting New Clue: ${newEvidence.id} - "${newEvidence.title}"`);
  console.log('\n[tryAnalyze] Running analyze() pipeline via LLM...');

  const startTime = Date.now();
  try {
    const { report, memoryProposals } = await analyze({
      newEvidence,
      relatedEvidence,
      memories: [
        {
          id: 'MEM-01',
          type: 'claim',
          summary: `Baseline observed from initial evidence: ${relatedEvidence[0]?.title || 'Prior facts'}`,
          evidenceIds: [relatedEvidence[0]?.id || 'EV-01'],
        },
      ],
      previousReport: null,
    });

    const elapsed = Date.now() - startTime;
    console.log(`\n✅ [Analysis Succeeded in ${elapsed}ms]`);

    console.log('\n======================================================');
    console.log('                 SYNTHESIS REPORT');
    console.log('======================================================');

    console.log('\n📌 KNOWN FACTS:');
    report.knownFacts.forEach((f, i) => {
      console.log(`  ${i + 1}. [${f.evidenceIds.join(', ')}] ${f.statement} (Basis: ${f.basis})`);
    });

    console.log('\n❓ UNVERIFIED CLAIMS:');
    report.unverifiedClaims.forEach((c, i) => {
      console.log(`  ${i + 1}. [${c.evidenceIds.join(', ')}] ${c.statement} [${c.verificationStatus}]`);
    });

    console.log('\n🔗 EVIDENCE CONNECTIONS:');
    report.evidenceConnections.forEach((conn, i) => {
      console.log(`  ${i + 1}. [${conn.evidenceIds.join(', ')}] (${conn.status}): ${conn.description} (Why: ${conn.why})`);
    });

    console.log('\n⚡ CONTRADICTIONS:');
    if (report.contradictions.length === 0) {
      console.log('  None detected.');
    } else {
      report.contradictions.forEach((ct, i) => {
        console.log(`  ${i + 1}. Conflict: "${ct.claimA.text}" [${ct.claimA.evidenceIds.join(', ')}] VS "${ct.claimB.text}" [${ct.claimB.evidenceIds.join(', ')}]`);
        console.log(`     Explanation: ${ct.explanation} (Unresolved: ${ct.unresolved})`);
      });
    }

    console.log('\n💡 WORKING HYPOTHESES:');
    report.hypotheses.forEach((h) => {
      console.log(`  • [${h.hypothesisId}] (${h.status}): ${h.description}`);
      console.log(`    Supported by: [${h.supportingEvidenceIds.join(', ')}] | Conflicting: [${h.conflictingEvidenceIds.join(', ')}]`);
    });

    console.log('\n🔍 OPEN QUESTIONS:');
    report.openQuestions.forEach((q, i) => {
      console.log(`  ${i + 1}. ${q.question} (Related: [${q.relatedEvidenceIds.join(', ')}])`);
    });

    console.log('\n🔬 SUGGESTED NEXT CHECKS:');
    report.suggestedNextChecks.forEach((s, i) => {
      console.log(`  ${i + 1}. Check: ${s.check} (Purpose: ${s.purpose})`);
    });

    console.log('\n======================================================');
    console.log(`        MEMORY PROPOSALS (${memoryProposals.length} proposed)`);
    console.log('======================================================');
    memoryProposals.forEach((p, i) => {
      console.log(`  ${i + 1}. [${p.action.toUpperCase()}] (${p.type}, confidence: ${p.confidenceLabel}) ${p.summary} [${p.evidenceIds.join(', ')}]`);
      console.log(`     Reason: ${p.reason}`);
    });

    process.exitCode = 0;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error(`\n❌ [Analysis Failed in ${elapsed}ms]:`);
    console.error(err.message);
    if (err.issues) {
      console.error('Validation issues:', JSON.stringify(err.issues, null, 2));
    }
    process.exitCode = 1;
  }
}

run();
