import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { listReports, getReportByVersion, ApiError } from '../api';

export default function ReportsHistoryPage() {
  const { caseId } = useParams();

  const [reportsList, setReportsList] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState(null);

  // Selected versions for side-by-side comparison
  const [versionA, setVersionA] = useState('');
  const [versionB, setVersionB] = useState('');

  // Loaded full report payloads for comparison
  const [reportA, setReportA] = useState(null);
  const [reportB, setReportB] = useState(null);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [comparisonError, setComparisonError] = useState(null);

  // 1. Fetch reports list
  const fetchReportsList = useCallback(async () => {
    if (!caseId) return;
    setLoadingList(true);
    setListError(null);
    try {
      const data = await listReports(caseId);
      const list = Array.isArray(data) ? data : [];
      setReportsList(list);

      // Auto-select initial comparison pair if available
      if (list.length >= 2) {
        // Earlier version on left, newer on right
        setVersionA(String(list[list.length - 1].version));
        setVersionB(String(list[0].version));
      } else if (list.length === 1) {
        setVersionA(String(list[0].version));
        setVersionB(String(list[0].version));
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err.message || 'Failed to load report history.');
      setListError(msg);
    } finally {
      setLoadingList(false);
    }
  }, [caseId]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!caseId) return;
      try {
        const data = await listReports(caseId);
        if (!ignore) {
          const list = Array.isArray(data) ? data : [];
          setReportsList(list);
          if (list.length >= 2) {
            setVersionA(String(list[list.length - 1].version));
            setVersionB(String(list[0].version));
          } else if (list.length === 1) {
            setVersionA(String(list[0].version));
            setVersionB(String(list[0].version));
          }
        }
      } catch (err) {
        if (!ignore) {
          const msg = err instanceof ApiError ? err.message : (err.message || 'Failed to load report history.');
          setListError(msg);
        }
      } finally {
        if (!ignore) {
          setLoadingList(false);
        }
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [caseId]);

  // 2. Fetch full report payloads when comparison version selections change
  useEffect(() => {
    let ignore = false;
    async function loadComparisonReports() {
      if (!caseId || !versionA || !versionB) return;
      setLoadingComparison(true);
      setComparisonError(null);

      try {
        const [docA, docB] = await Promise.all([
          getReportByVersion(caseId, versionA),
          versionA === versionB ? getReportByVersion(caseId, versionA) : getReportByVersion(caseId, versionB),
        ]);

        if (!ignore) {
          setReportA(docA);
          setReportB(docB);
        }
      } catch (err) {
        if (!ignore) {
          const msg = err instanceof ApiError ? err.message : (err.message || 'Failed to load selected report versions.');
          setComparisonError(msg);
        }
      } finally {
        if (!ignore) {
          setLoadingComparison(false);
        }
      }
    }

    loadComparisonReports();
    return () => {
      ignore = true;
    };
  }, [caseId, versionA, versionB]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? dateStr : d.toLocaleString();
    } catch {
      return dateStr;
    }
  };

  // Extract memoryDelta from the newer version (or versionB)
  const activeDelta =
    Number(versionB) >= Number(versionA)
      ? reportB?.memoryDelta || reportA?.memoryDelta
      : reportA?.memoryDelta || reportB?.memoryDelta;

  const memoryAdded = activeDelta?.added || [];
  const memoryChanged = activeDelta?.changed || activeDelta?.updated || [];
  const memoryRetained = activeDelta?.retained || [];
  const memoryContradicted = activeDelta?.contradicted || [];
  const deltaExplanation = activeDelta?.explanation || '';

  return (
    <div className="container">
      {/* Navigation Breadcrumb */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <Link to="/" style={{ color: 'var(--text-subtle)', fontSize: '0.9rem' }}>
              ← Cases
            </Link>
            <span style={{ color: 'var(--text-subtle)' }}>/</span>
            <Link to={`/cases/${caseId}`} style={{ color: 'var(--text-subtle)', fontSize: '0.9rem' }}>
              Workspace
            </Link>
            <span style={{ color: 'var(--text-subtle)' }}>/</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--accent-blue)' }}>
              Report History
            </span>
          </div>
          <h1>Immutable Report History</h1>
          <p>Audit log of synthesized report versions and memory state evolution.</p>
        </div>

        <Link to={`/cases/${caseId}`} className="btn btn-secondary">
          ← Back to Workspace
        </Link>
      </div>

      {listError && (
        <div className="alert alert-danger" style={{ marginBottom: '1.5rem' }}>
          <span>{listError}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={fetchReportsList}>
            Retry
          </button>
        </div>
      )}

      {/* 1. Report Versions List Table */}
      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Available Report Versions</h2>

        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '100px' }}>Version</th>
                <th style={{ width: '220px' }}>Date</th>
                <th style={{ width: '140px' }}>Evidence Count</th>
                <th>Summary</th>
                <th style={{ width: '180px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadingList && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    Loading report history...
                  </td>
                </tr>
              )}

              {!loadingList && reportsList.length === 0 && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No reports generated yet for this case. Run an analysis in the Workspace first.
                  </td>
                </tr>
              )}

              {!loadingList &&
                reportsList.map((item) => {
                  const isLeft = String(item.version) === versionA;
                  const isRight = String(item.version) === versionB;
                  const countDisplay = item.evidenceCount !== undefined
                    ? item.evidenceCount
                    : (item.triggerEvidenceCode ? '1 (Trigger)' : '—');

                  return (
                    <tr key={item._id || item.version}>
                      <td>
                        <span className="badge badge-verified">
                          v{item.version}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                        {formatDate(item.createdAt)}
                      </td>
                      <td>
                        <span className="badge badge-code">
                          {countDisplay} items
                        </span>
                      </td>
                      <td style={{ fontSize: '0.9rem' }}>
                        {item.summary}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.35rem' }}>
                          <button
                            type="button"
                            className={`btn btn-sm ${isLeft ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setVersionA(String(item.version))}
                            title="Set as Left Column"
                          >
                            {isLeft ? '✓ Left' : 'Set Left'}
                          </button>
                          <button
                            type="button"
                            className={`btn btn-sm ${isRight ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setVersionB(String(item.version))}
                            title="Set as Right Column"
                          >
                            {isRight ? '✓ Right' : 'Set Right'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Side-by-Side Comparison Selector Controls */}
      {reportsList.length > 0 && (
        <section style={{ marginBottom: '2rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1rem',
              padding: '1rem 1.25rem',
              background: 'var(--bg-tertiary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div>
              <strong style={{ fontSize: '1.05rem', color: 'var(--text-main)' }}>Side-by-Side Version Comparison</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
                Comparing Version {versionA} against Version {versionB}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label htmlFor="select-version-a" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Column A (Left):
                </label>
                <select
                  id="select-version-a"
                  className="form-select"
                  style={{ width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                  value={versionA}
                  onChange={(e) => setVersionA(e.target.value)}
                >
                  {reportsList.map((r) => (
                    <option key={`a-${r.version}`} value={String(r.version)}>
                      Version {r.version} ({formatDate(r.createdAt).split(',')[0]})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label htmlFor="select-version-b" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Column B (Right):
                </label>
                <select
                  id="select-version-b"
                  className="form-select"
                  style={{ width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                  value={versionB}
                  onChange={(e) => setVersionB(e.target.value)}
                >
                  {reportsList.map((r) => (
                    <option key={`b-${r.version}`} value={String(r.version)}>
                      Version {r.version} ({formatDate(r.createdAt).split(',')[0]})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </section>
      )}

      {comparisonError && (
        <div className="alert alert-danger" style={{ marginBottom: '1.5rem' }}>
          <span>{comparisonError}</span>
        </div>
      )}

      {loadingComparison && (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          Loading comparison data for v{versionA} and v{versionB}...
        </div>
      )}

      {/* 3. "What Changed and Why" & Memory Changes from API */}
      {!loadingComparison && (reportA || reportB) && (
        <>
          <section className="delta-box">
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.75rem', color: 'var(--text-main)' }}>
              What Changed and Why (v{versionA} ➔ v{versionB})
            </h2>

            {/* Explanation from the API */}
            <div style={{ fontSize: '1rem', lineHeight: '1.6', color: 'var(--text-main)', marginBottom: '1.25rem' }}>
              {deltaExplanation ? (
                <span>{deltaExplanation}</span>
              ) : (
                <span style={{ color: 'var(--text-subtle)' }}>
                  No structural change explanation recorded between these report executions.
                </span>
              )}
            </div>

            {/* Memory Changes (Added, Changed, Retained, Contradicted) as provided directly by API */}
            <div className="delta-grid">
              {/* Added */}
              <div className="delta-card" style={{ borderLeft: '3px solid #10b981' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span className="badge badge-status-active">Added</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>({memoryAdded.length})</span>
                </div>
                {memoryAdded.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>None</p>
                ) : (
                  <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                    {memoryAdded.map((item, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Changed / Updated */}
              <div className="delta-card" style={{ borderLeft: '3px solid #f59e0b' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span className="badge badge-status-changed">Changed</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>({memoryChanged.length})</span>
                </div>
                {memoryChanged.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>None</p>
                ) : (
                  <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                    {memoryChanged.map((item, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Retained */}
              <div className="delta-card" style={{ borderLeft: '3px solid #38bdf8' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span className="badge badge-status-retained">Retained</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>({memoryRetained.length})</span>
                </div>
                {memoryRetained.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>None</p>
                ) : (
                  <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                    {memoryRetained.map((item, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Contradicted */}
              <div className="delta-card" style={{ borderLeft: '3px solid #ef4444' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span className="badge badge-status-contradicted">Contradicted</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>({memoryContradicted.length})</span>
                </div>
                {memoryContradicted.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>None</p>
                ) : (
                  <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', color: '#f87171' }}>
                    {memoryContradicted.map((item, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          {/* 4. Two-Column Side-by-Side Comparison */}
          <section>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
              Side-by-Side Analysis Comparison
            </h2>

            <div className="comparison-grid">
              {/* Column 1: Report A */}
              <div className="comparison-column">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
                  <div>
                    <h3 style={{ fontSize: '1.2rem', color: 'var(--accent-blue)' }}>
                      Version {reportA?.version || versionA}
                    </h3>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
                      {formatDate(reportA?.createdAt)}
                    </div>
                  </div>
                  <span className="badge badge-verified">Baseline</span>
                </div>

                {/* Summary */}
                <div style={{ marginBottom: '1.25rem', padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-subtle)', marginBottom: '0.25rem' }}>
                    Summary
                  </div>
                  <div style={{ fontSize: '0.9rem' }}>{reportA?.summary || 'No summary available.'}</div>
                </div>

                {/* Known Facts */}
                <div style={{ marginBottom: '1rem' }}>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--accent-blue)' }}>
                    Known Facts ({reportA?.knownFacts?.length || 0})
                  </strong>
                  <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                    {reportA?.knownFacts?.map((f, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>
                        {f.statement}{' '}
                        {f.evidenceCodes && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                            [{f.evidenceCodes.join(', ')}]
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Unverified Claims */}
                <div style={{ marginBottom: '1rem' }}>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--status-unverified-text)' }}>
                    Unverified Claims ({reportA?.unverifiedClaims?.length || 0})
                  </strong>
                  <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                    {reportA?.unverifiedClaims?.map((c, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>
                        {c.statement}
                        {c.source && <span style={{ color: 'var(--text-subtle)' }}> (Source: {c.source})</span>}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Hypotheses */}
                <div style={{ marginBottom: '1rem' }}>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--cat-hypothesis-text)' }}>
                    Hypotheses ({reportA?.possibleHypotheses?.length || 0})
                  </strong>
                  <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                    {reportA?.possibleHypotheses?.map((h, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>
                        <strong>{h.hypothesisId ? `[${h.hypothesisId}] ` : ''}{h.title}:</strong> {h.rationale}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Contradictions */}
                <div>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--cat-contradiction-text)' }}>
                    Contradictions ({reportA?.contradictions?.length || 0})
                  </strong>
                  <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                    {reportA?.contradictions?.length === 0 ? (
                      <li style={{ color: 'var(--text-subtle)' }}>None detected</li>
                    ) : (
                      reportA?.contradictions?.map((k, idx) => (
                        <li key={idx} style={{ marginBottom: '0.25rem' }}>
                          {k.pointOfConflict || k.statement}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>

              {/* Column 2: Report B */}
              <div className="comparison-column">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
                  <div>
                    <h3 style={{ fontSize: '1.2rem', color: 'var(--accent-cyan)' }}>
                      Version {reportB?.version || versionB}
                    </h3>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
                      {formatDate(reportB?.createdAt)}
                    </div>
                  </div>
                  <span className="badge badge-verified">Target Comparison</span>
                </div>

                {/* Summary */}
                <div style={{ marginBottom: '1.25rem', padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent-cyan)', marginBottom: '0.25rem' }}>
                    Summary
                  </div>
                  <div style={{ fontSize: '0.9rem' }}>{reportB?.summary || 'No summary available.'}</div>
                </div>

                {/* Known Facts */}
                <div style={{ marginBottom: '1rem' }}>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--accent-blue)' }}>
                    Known Facts ({reportB?.knownFacts?.length || 0})
                  </strong>
                  <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                    {reportB?.knownFacts?.map((f, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>
                        {f.statement}{' '}
                        {f.evidenceCodes && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                            [{f.evidenceCodes.join(', ')}]
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Unverified Claims */}
                <div style={{ marginBottom: '1rem' }}>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--status-unverified-text)' }}>
                    Unverified Claims ({reportB?.unverifiedClaims?.length || 0})
                  </strong>
                  <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                    {reportB?.unverifiedClaims?.map((c, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>
                        {c.statement}
                        {c.source && <span style={{ color: 'var(--text-subtle)' }}> (Source: {c.source})</span>}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Hypotheses */}
                <div style={{ marginBottom: '1rem' }}>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--cat-hypothesis-text)' }}>
                    Hypotheses ({reportB?.possibleHypotheses?.length || 0})
                  </strong>
                  <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                    {reportB?.possibleHypotheses?.map((h, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>
                        <strong>{h.hypothesisId ? `[${h.hypothesisId}] ` : ''}{h.title}:</strong> {h.rationale}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Contradictions */}
                <div>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--cat-contradiction-text)' }}>
                    Contradictions ({reportB?.contradictions?.length || 0})
                  </strong>
                  <ul style={{ paddingLeft: '1.25rem', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                    {reportB?.contradictions?.length === 0 ? (
                      <li style={{ color: 'var(--text-subtle)' }}>None detected</li>
                    ) : (
                      reportB?.contradictions?.map((k, idx) => (
                        <li key={idx} style={{ marginBottom: '0.25rem' }}>
                          {k.pointOfConflict || k.statement}
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
