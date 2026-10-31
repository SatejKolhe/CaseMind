REPORT (8 sections, every item cites real evidenceIds):
knownFacts[]: {statement, evidenceIds[], basis}
unverifiedClaims[]: {statement, evidenceIds[], verificationStatus}
evidenceConnections[]: {description, evidenceIds[], status: "possible"|"unconfirmed"|"supported", why}
contradictions[]: {claimA:{text,evidenceIds[]}, claimB:{text,evidenceIds[]}, explanation, unresolved:true|false}
hypotheses[]: {hypothesisId, description, supportingEvidenceIds[], conflictingEvidenceIds[], status: "under_consideration"|"strengthened"|"weakened"|"unsupported"}
openQuestions[]: {question, relatedEvidenceIds[]}
suggestedNextChecks[]: {check, purpose, relatedHypothesisIds[]}
memoryUpdates[]: {action, memoryId?, summary, reason, evidenceIds[]}

MEMORY PROPOSAL (AI proposes, backend validates and saves):
{action:"add"|"supersede"|"mark_disputed"|"resolve", type, summary, evidenceIds[],
 confidenceLabel:"low"|"medium"|"high", targetMemoryId?, reason}

MY MODULE EXPORTS (/server/ai/index.js):
processEvidence(deps, {caseId, evidenceId, memoryMode:"on"|"off"})
  -> {report, memoryProposals, changeSummary, retrieved, status}
redact(text) -> {text, redacted:boolean, findings[]}
embed(text) -> number[]   // only if the team puts embeddings in my module
