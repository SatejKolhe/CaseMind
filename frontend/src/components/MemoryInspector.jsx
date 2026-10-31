import React, { useState, useEffect, useCallback } from 'react';
import { getMemories, ApiError } from '../api';

/**
 * MemoryInspector Component
 *
 * Displays working memories table conforming to docs/API_CONTRACT.md:
 * - Columns: Statement, Type, Status (active / changed / contradicted / retained / superseded),
 *   Linked Evidence IDs, and expandable "Why" row (native <details>).
 * - Highlights contradicted memories with a textual label plus muted red (not color alone).
 */
export default function MemoryInspector({ caseId, onEvidenceClick, refreshTrigger }) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchMemories = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getMemories(caseId, statusFilter);
      setMemories(Array.isArray(data) ? data : []);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err.message || 'Failed to load working memories.');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [caseId, statusFilter]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!caseId) return;
      try {
        const data = await getMemories(caseId, statusFilter);
        if (!ignore) {
          setMemories(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!ignore) {
          const msg = err instanceof ApiError ? err.message : (err.message || 'Failed to load working memories.');
          setError(msg);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [caseId, statusFilter, refreshTrigger]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? dateStr : d.toLocaleString();
    } catch {
      return dateStr;
    }
  };

  const getCategoryBadgeClass = (category) => {
    switch (category) {
      case 'fact':
        return 'badge-fact';
      case 'claim':
        return 'badge-claim';
      case 'contradiction':
        return 'badge-contradiction';
      case 'inference':
        return 'badge-inference';
      case 'hypothesis':
        return 'badge-hypothesis';
      case 'open_question':
        return 'badge-question';
      default:
        return 'badge-fact';
    }
  };

  const getStatusBadge = (item) => {
    const isContradicted =
      item.status === 'contradicted' ||
      item.category === 'contradiction' ||
      (Array.isArray(item.conflictingEvidenceCodes) && item.conflictingEvidenceCodes.length > 0);

    if (isContradicted) {
      return (
        <span className="badge badge-status-contradicted">
          [CONTRADICTED]
        </span>
      );
    }

    switch (item.status) {
      case 'active':
        return <span className="badge badge-status-active">active</span>;
      case 'changed':
        return <span className="badge badge-status-changed">changed</span>;
      case 'retained':
        return <span className="badge badge-status-retained">retained</span>;
      case 'superseded':
        return <span className="badge badge-status-superseded">superseded</span>;
      default:
        return <span className="badge badge-status-active">{item.status || 'active'}</span>;
    }
  };

  return (
    <section className="memory-inspector-section" style={{ marginTop: '2.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem' }}>Working Memory Inspector</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Active epistemological knowledge items, evidence grounding, and evolution history.
          </p>
        </div>

        {/* Status Filter & Refresh Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <label htmlFor="memory-status-filter" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Status Filter:
          </label>
          <select
            id="memory-status-filter"
            className="form-select"
            style={{ width: 'auto', padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Items</option>
            <option value="active">Active Only</option>
            <option value="resolved">Resolved</option>
            <option value="superseded">Superseded</option>
          </select>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={fetchMemories}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
          <span>{error}</span>
        </div>
      )}

      {/* Memory Table */}
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th style={{ minWidth: '300px' }}>Statement &amp; Change Reason</th>
              <th style={{ width: '130px' }}>Type</th>
              <th style={{ width: '150px' }}>Status</th>
              <th style={{ width: '170px' }}>Linked Evidence</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  Loading working memories...
                </td>
              </tr>
            )}

            {!loading && memories.length === 0 && !error && (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No working memories found for the selected filter.
                </td>
              </tr>
            )}

            {!loading &&
              memories.map((item) => {
                const isContradicted =
                  item.status === 'contradicted' ||
                  item.category === 'contradiction' ||
                  (Array.isArray(item.conflictingEvidenceCodes) && item.conflictingEvidenceCodes.length > 0);

                // Collect supporting + conflicting evidence codes
                const linkedCodes = [
                  ...(Array.isArray(item.supportingEvidenceCodes) ? item.supportingEvidenceCodes : []),
                  ...(Array.isArray(item.conflictingEvidenceCodes) ? item.conflictingEvidenceCodes : []),
                ];
                // Deduplicate
                const uniqueCodes = Array.from(new Set(linkedCodes));

                return (
                  <tr
                    key={item._id || item.statement}
                    className={isContradicted ? 'memory-row-contradicted' : ''}
                  >
                    {/* Statement + Expandable "Why" Row */}
                    <td>
                      <div>
                        {/* Accessible Text Label for Contradicted Memories */}
                        {isContradicted && (
                          <span
                            style={{
                              display: 'inline-block',
                              color: '#f87171',
                              fontWeight: 800,
                              marginRight: '6px',
                              fontSize: '0.85rem',
                            }}
                          >
                            [CONTRADICTION DETECTED]
                          </span>
                        )}
                        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                          {item.statement}
                        </span>
                      </div>

                      {/* Source or Hypothesis Details */}
                      {item.source && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', marginTop: '2px' }}>
                          Source: {item.source}
                        </div>
                      )}
                      {item.hypothesisDetails && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          <strong>{item.hypothesisDetails.title || item.hypothesisDetails.hypothesisId}:</strong>{' '}
                          {item.hypothesisDetails.rationale}
                        </div>
                      )}

                      {/* Native <details> Expandable Row showing "Why" and Change History */}
                      <details className="memory-why">
                        <summary>Why / Change History ▾</summary>
                        <div className="memory-why-content">
                          <div style={{ marginBottom: '0.35rem' }}>
                            <strong style={{ color: 'var(--text-main)' }}>Recorded Reason:</strong>{' '}
                            <span>{item.changeReason || 'No explicit reason recorded.'}</span>
                          </div>

                          <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <span>Last Updated in: Report v{item.lastUpdatedInVersion || 1}</span>
                            <span>Updated: {formatDate(item.updatedAt || item.createdAt)}</span>
                          </div>

                          {/* Extra Contradiction Context */}
                          {Array.isArray(item.conflictingEvidenceCodes) && item.conflictingEvidenceCodes.length > 0 && (
                            <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#f87171' }}>
                              <strong>Conflicting Evidence:</strong> {item.conflictingEvidenceCodes.join(', ')}
                            </div>
                          )}

                          {/* Extra Hypothesis Unresolved Points */}
                          {item.hypothesisDetails?.unresolvedPoints?.length > 0 && (
                            <div style={{ marginTop: '0.4rem', fontSize: '0.8rem' }}>
                              <strong style={{ color: 'var(--status-unverified-text)' }}>Unresolved Factors:</strong>
                              <ul style={{ paddingLeft: '1.25rem', marginTop: '2px' }}>
                                {item.hypothesisDetails.unresolvedPoints.map((pt, pIdx) => (
                                  <li key={pIdx}>{pt}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </details>
                    </td>

                    {/* Category Type */}
                    <td>
                      <span className={`badge ${getCategoryBadgeClass(item.category)}`}>
                        {item.category}
                      </span>
                    </td>

                    {/* Status Badge */}
                    <td>
                      {getStatusBadge(item)}
                    </td>

                    {/* Linked Evidence IDs */}
                    <td>
                      {uniqueCodes.length === 0 ? (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>None</span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                          {uniqueCodes.map((code) => (
                            <button
                              key={code}
                              type="button"
                              className="citation-link"
                              title={`Jump to evidence ${code}`}
                              onClick={() => onEvidenceClick && onEvidenceClick(code)}
                            >
                              {code}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
