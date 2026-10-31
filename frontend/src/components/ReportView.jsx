import React from 'react';

/**
 * ReportView Component
 *
 * Displays the synthesized investigation report conforming to docs/API_CONTRACT.md:
 * - Version number and creation timestamp
 * - Summary box
 * - Four labeled sections: Facts, Unverified Claims, Inferences, Hypotheses
 * - Contradictions and Unknowns
 * - Interactive evidence citation links that scroll to and highlight rows
 */
export default function ReportView({ report, onEvidenceClick }) {
  if (!report) {
    return null;
  }

  const {
    version,
    createdAt,
    summary,
    knownFacts = [],
    unverifiedClaims = [],
    evidenceConnections = [],
    possibleHypotheses = [],
    contradictions = [],
    openQuestions = [],
    suggestedNextChecks = [],
  } = report;

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? dateStr : d.toLocaleString();
    } catch {
      return dateStr;
    }
  };

  const renderCitationBadge = (code) => {
    if (!code) return null;
    return (
      <button
        key={code}
        type="button"
        className="citation-link"
        title={`Jump to evidence ${code}`}
        onClick={() => onEvidenceClick && onEvidenceClick(code)}
      >
        {code}
      </button>
    );
  };

  return (
    <section className="report-container" id="investigation-report">
      {/* Report Header: Version & Timestamp */}
      <div className="report-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <h2 style={{ fontSize: '1.5rem' }}>Investigation Synthesis Report</h2>
            <span className="badge badge-verified" style={{ fontSize: '0.85rem' }}>
              Version {version || 1}
            </span>
          </div>
          <div className="report-meta">
            <span>Created: {formatDate(createdAt)}</span>
            {report.triggerEvidenceCode && (
              <span>
                Triggered by:{' '}
                {renderCitationBadge(report.triggerEvidenceCode)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Summary Section */}
      {summary && (
        <div className="report-summary-box">
          <div style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent-blue)', marginBottom: '0.25rem' }}>
            Executive Summary
          </div>
          <div>{summary}</div>
        </div>
      )}

      {/* Four Primary Labeled Sections: Facts, Unverified Claims, Inferences, Hypotheses */}
      <div className="report-grid">
        {/* 1. Facts */}
        <div className="report-section-card">
          <div className="report-section-header">
            <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="badge badge-fact">Facts</span>
              <span>({knownFacts.length})</span>
            </h3>
          </div>
          <div className="report-item-list">
            {knownFacts.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-subtle)' }}>No verified facts recorded.</p>
            ) : (
              knownFacts.map((fact, idx) => (
                <div key={idx} className="report-item" style={{ borderLeftColor: 'var(--accent-blue)' }}>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{fact.statement}</div>
                  {Array.isArray(fact.evidenceCodes) && fact.evidenceCodes.length > 0 && (
                    <div className="report-citations">
                      {fact.evidenceCodes.map(renderCitationBadge)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* 2. Unverified Claims */}
        <div className="report-section-card">
          <div className="report-section-header">
            <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="badge badge-claim">Unverified Claims</span>
              <span>({unverifiedClaims.length})</span>
            </h3>
          </div>
          <div className="report-item-list">
            {unverifiedClaims.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-subtle)' }}>No unverified claims recorded.</p>
            ) : (
              unverifiedClaims.map((claim, idx) => (
                <div key={idx} className="report-item" style={{ borderLeftColor: 'var(--status-unverified-text)' }}>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{claim.statement}</div>
                  {claim.source && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', marginTop: '0.2rem' }}>
                      Source: {claim.source}
                    </div>
                  )}
                  {Array.isArray(claim.evidenceCodes) && claim.evidenceCodes.length > 0 && (
                    <div className="report-citations">
                      {claim.evidenceCodes.map(renderCitationBadge)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* 3. Inferences */}
        <div className="report-section-card">
          <div className="report-section-header">
            <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="badge badge-inference">Inferences</span>
              <span>({evidenceConnections.length})</span>
            </h3>
          </div>
          <div className="report-item-list">
            {evidenceConnections.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-subtle)' }}>No deductions or evidence links deduced yet.</p>
            ) : (
              evidenceConnections.map((conn, idx) => (
                <div key={idx} className="report-item" style={{ borderLeftColor: 'var(--accent-purple)' }}>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>
                    {conn.connection || conn.statement}
                  </div>
                  {Array.isArray(conn.evidenceCodes) && conn.evidenceCodes.length > 0 && (
                    <div className="report-citations">
                      {conn.evidenceCodes.map(renderCitationBadge)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* 4. Hypotheses */}
        <div className="report-section-card">
          <div className="report-section-header">
            <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="badge badge-hypothesis">Hypotheses</span>
              <span>({possibleHypotheses.length})</span>
            </h3>
          </div>
          <div className="report-item-list">
            {possibleHypotheses.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-subtle)' }}>No working investigative theories.</p>
            ) : (
              possibleHypotheses.map((hyp, idx) => (
                <div key={idx} className="report-item" style={{ borderLeftColor: 'var(--cat-hypothesis-text)' }}>
                  <div className="report-item-header">
                    <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>
                      {hyp.hypothesisId ? `[${hyp.hypothesisId}] ` : ''}
                      {hyp.title}
                    </strong>
                  </div>
                  {hyp.rationale && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                      {hyp.rationale}
                    </div>
                  )}
                  {Array.isArray(hyp.unresolvedPoints) && hyp.unresolvedPoints.length > 0 && (
                    <div style={{ marginTop: '0.35rem', fontSize: '0.8rem', color: 'var(--status-unverified-text)' }}>
                      <strong>Unresolved:</strong>
                      <ul style={{ paddingLeft: '1.25rem', marginTop: '0.2rem' }}>
                        {hyp.unresolvedPoints.map((pt, pIdx) => (
                          <li key={pIdx}>{pt}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(hyp.supportedBy) && hyp.supportedBy.length > 0 && (
                    <div className="report-citations">
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', alignSelf: 'center', marginRight: '4px' }}>
                        Supported by:
                      </span>
                      {hyp.supportedBy.map(renderCitationBadge)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Additional Required Sections: Contradictions and Unknowns */}
      <div className="report-grid">
        {/* Contradictions */}
        <div className="report-section-card">
          <div className="report-section-header">
            <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="badge badge-contradiction">Contradictions &amp; Conflicts</span>
              <span>({contradictions.length})</span>
            </h3>
          </div>
          <div className="report-item-list">
            {contradictions.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-subtle)' }}>No direct chronological or factual contradictions detected.</p>
            ) : (
              contradictions.map((contra, idx) => (
                <div key={idx} className="report-item" style={{ borderLeftColor: 'var(--cat-contradiction-text)' }}>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>
                    {contra.pointOfConflict || contra.statement}
                  </div>
                  {Array.isArray(contra.conflictingEvidenceCodes) && contra.conflictingEvidenceCodes.length > 0 && (
                    <div className="report-citations">
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', alignSelf: 'center', marginRight: '4px' }}>
                        Conflicting codes:
                      </span>
                      {contra.conflictingEvidenceCodes.map(renderCitationBadge)}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Unknowns (Open Questions & Suggested Next Checks) */}
        <div className="report-section-card">
          <div className="report-section-header">
            <h3 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="badge badge-question">Unknowns &amp; Intelligence Gaps</span>
              <span>({openQuestions.length + suggestedNextChecks.length})</span>
            </h3>
          </div>
          <div className="report-item-list">
            {openQuestions.length === 0 && suggestedNextChecks.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-subtle)' }}>No unresolved open questions identified.</p>
            ) : (
              <>
                {openQuestions.length > 0 && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                      Open Questions:
                    </div>
                    <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                      {openQuestions.map((q, idx) => (
                        <li key={idx} style={{ marginBottom: '0.25rem' }}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {suggestedNextChecks.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                      Suggested Next Checks:
                    </div>
                    <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', color: 'var(--accent-blue)' }}>
                      {suggestedNextChecks.map((check, idx) => (
                        <li key={idx} style={{ marginBottom: '0.25rem' }}>{check}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
