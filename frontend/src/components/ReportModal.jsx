import React, { useState, useEffect } from 'react';
import { listReports, getReportByVersion, getLatestReport, ApiError } from '../api';
import ReportView from './ReportView';

export default function ReportModal({ caseId, isOpen, onClose, onEvidenceClick }) {
  const [reportsList, setReportsList] = useState([]);
  const [activeTab, setActiveTab] = useState('latest'); // 'latest' | 'compare'
  const [latestReport, setLatestReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Comparison states
  const [versionA, setVersionA] = useState('');
  const [versionB, setVersionB] = useState('');
  const [reportA, setReportA] = useState(null);
  const [reportB, setReportB] = useState(null);
  const [loadingComp, setLoadingComp] = useState(false);

  useEffect(() => {
    let ignore = false;
    if (!caseId || !isOpen) return;

    async function run() {
      try {
        const [listData, latestData] = await Promise.all([
          listReports(caseId).catch(() => []),
          getLatestReport(caseId).catch(() => null),
        ]);
        if (ignore) return;
        const list = Array.isArray(listData) ? listData : [];
        setReportsList(list);
        setLatestReport(latestData);

        if (list.length >= 2) {
          setVersionA(String(list[list.length - 1].version));
          setVersionB(String(list[0].version));
        } else if (list.length === 1) {
          setVersionA(String(list[0].version));
          setVersionB(String(list[0].version));
        }
      } catch (err) {
        if (!ignore) {
          const msg = err instanceof ApiError ? err.message : (err.message || 'Failed to fetch reports.');
          setError(msg);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    run();
    return () => {
      ignore = true;
    };
  }, [caseId, isOpen]);

  // Load comparison reports when versions change in compare tab
  useEffect(() => {
    if (activeTab !== 'compare' || !versionA || !versionB || !caseId) return;

    let ignore = false;
    async function loadPair() {
      setLoadingComp(true);
      try {
        const [a, b] = await Promise.all([
          getReportByVersion(caseId, versionA),
          getReportByVersion(caseId, versionB),
        ]);
        if (!ignore) {
          setReportA(a);
          setReportB(b);
        }
      } catch (err) {
        if (!ignore) {
          console.error('Error loading reports to compare:', err);
        }
      } finally {
        if (!ignore) setLoadingComp(false);
      }
    }
    loadPair();
    return () => {
      ignore = true;
    };
  }, [activeTab, versionA, versionB, caseId]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: '1000px', maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 className="modal-title">Investigation Reports</h2>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className={`btn btn-sm ${activeTab === 'latest' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveTab('latest')}
              >
                Latest Synthesis
              </button>
              <button
                type="button"
                className={`btn btn-sm ${activeTab === 'compare' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveTab('compare')}
                disabled={reportsList.length < 2}
                title={reportsList.length < 2 ? 'Need at least 2 versions to compare' : 'Compare two versions'}
              >
                Compare Versions ({reportsList.length})
              </button>
            </div>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-subtle)' }}>
            Loading investigative reports...
          </div>
        ) : error ? (
          <div className="error-banner" style={{ margin: '16px 0' }}>
            {error}
          </div>
        ) : (
          <div style={{ overflowY: 'auto', maxHeight: 'calc(90vh - 120px)', paddingRight: '4px' }}>
            {activeTab === 'latest' ? (
              latestReport ? (
                <ReportView report={latestReport} onEvidenceClick={onEvidenceClick} />
              ) : (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-subtle)' }}>
                  No synthesized report yet. Ask the AI to analyze the case or click "Analyze Evidence" in the chat.
                </div>
              )
            ) : (
              <div>
                <div style={{ display: 'flex', gap: '16px', background: 'var(--bg-card)', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', display: 'block', marginBottom: '4px' }}>
                      Baseline Version:
                    </label>
                    <select
                      value={versionA}
                      onChange={(e) => setVersionA(e.target.value)}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', background: 'var(--bg-app)', color: 'var(--text-main)', border: '1px solid var(--border-medium)' }}
                    >
                      {reportsList.map((r) => (
                        <option key={r.version} value={r.version}>
                          Version {r.version} ({new Date(r.createdAt).toLocaleDateString()})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-subtle)', display: 'block', marginBottom: '4px' }}>
                      Comparison Version:
                    </label>
                    <select
                      value={versionB}
                      onChange={(e) => setVersionB(e.target.value)}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', background: 'var(--bg-app)', color: 'var(--text-main)', border: '1px solid var(--border-medium)' }}
                    >
                      {reportsList.map((r) => (
                        <option key={r.version} value={r.version}>
                          Version {r.version} ({new Date(r.createdAt).toLocaleDateString()})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {loadingComp ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-subtle)' }}>
                    Loading comparison diff...
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div style={{ background: 'var(--bg-card)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                      <h4 style={{ fontSize: '0.9rem', marginBottom: '8px', color: 'var(--accent-cyan)' }}>Version {versionA}</h4>
                      {reportA ? <ReportView report={reportA} onEvidenceClick={onEvidenceClick} /> : 'No report'}
                    </div>
                    <div style={{ background: 'var(--bg-card)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                      <h4 style={{ fontSize: '0.9rem', marginBottom: '8px', color: 'var(--accent-blue)' }}>Version {versionB}</h4>
                      {reportB ? <ReportView report={reportB} onEvidenceClick={onEvidenceClick} /> : 'No report'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
