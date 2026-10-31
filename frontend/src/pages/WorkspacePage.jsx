import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getCase, runAnalysis, getLatestReport, ApiError } from '../api';
import EvidenceSection from '../components/EvidenceSection';
import ReportView from '../components/ReportView';
import MemoryInspector from '../components/MemoryInspector';

export default function WorkspacePage() {
  const { caseId } = useParams();

  // Case metadata states
  const [caseData, setCaseData] = useState(null);
  const [loadingCase, setLoadingCase] = useState(true);
  const [caseError, setCaseError] = useState(null);

  // Analysis & Report states
  const [report, setReport] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null); // { kind, message }

  // Evidence citation scroll & highlight state
  const [highlightedEvidenceCode, setHighlightedEvidenceCode] = useState(null);
  const highlightTimeoutRef = useRef(null);

  // 1. Fetch case details and initial latest report (if exists)
  useEffect(() => {
    let ignore = false;

    async function loadWorkspace() {
      if (!caseId) return;

      // Load case info
      try {
        const data = await getCase(caseId);
        if (!ignore) {
          setCaseData(data);
        }
      } catch (err) {
        if (!ignore) {
          const msg = err instanceof ApiError ? err.message : (err.message || 'Failed to load case.');
          setCaseError(msg);
        }
      } finally {
        if (!ignore) {
          setLoadingCase(false);
        }
      }

      // Try loading latest existing report (or mock if USE_MOCK)
      try {
        const latest = await getLatestReport(caseId);
        if (!ignore && latest) {
          setReport(latest);
        }
      } catch {
        // If no report exists yet or latest endpoint isn't present, that's completely normal
      }
    }

    loadWorkspace();
    return () => {
      ignore = true;
    };
  }, [caseId]);

  // 2. Trigger AI Analysis
  const handleAnalyze = useCallback(async () => {
    if (!caseId || analyzing) return;

    setAnalyzing(true);
    setAnalysisError(null);

    try {
      const generatedReport = await runAnalysis(caseId);
      setReport(generatedReport);

      // Smoothly scroll down to the generated report
      setTimeout(() => {
        const reportEl = document.getElementById('investigation-report');
        if (reportEl) {
          reportEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 150);
    } catch (err) {
      const errorKind = err instanceof ApiError ? err.kind : 'network';
      const errorMessage = err instanceof ApiError ? err.message : (err.message || 'Analysis failed unexpectedly.');

      setAnalysisError({
        kind: errorKind,
        message: errorMessage,
      });
    } finally {
      setAnalyzing(false);
    }
  }, [caseId, analyzing]);

  // 3. Handle citation click to scroll & highlight corresponding evidence row
  const handleEvidenceCitationClick = useCallback((evidenceCode) => {
    if (!evidenceCode) return;

    setHighlightedEvidenceCode(evidenceCode);

    // Scroll to the row in the Evidence table
    const targetRow = document.getElementById(`evidence-row-${evidenceCode}`);
    if (targetRow) {
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Reset highlight animation after 2.5 seconds
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    highlightTimeoutRef.current = setTimeout(() => {
      setHighlightedEvidenceCode(null);
    }, 2500);
  }, []);

  // Format error kind badge and explanation
  const getErrorKindDescription = (kind) => {
    switch (kind) {
      case 'ai_provider':
        return {
          title: 'AI Provider Failure (502 Bad Gateway)',
          hint: 'The external LLM provider timed out or was unreachable.',
        };
      case 'ai_output':
        return {
          title: 'Invalid AI Output (422 Unprocessable Entity)',
          hint: 'The AI model generated ungrounded assertions, invalid citations, or schema violations.',
        };
      case 'database':
        return {
          title: 'Database / Concurrency Conflict',
          hint: 'A persistence conflict occurred in MongoDB while attempting to save the report version.',
        };
      case 'validation':
        return {
          title: 'Request Validation Error',
          hint: 'Invalid parameters or missing fields sent to the analysis endpoint.',
        };
      case 'network':
      default:
        return {
          title: 'Network Communication Error',
          hint: 'Could not connect to the CaseMind backend server.',
        };
    }
  };

  return (
    <div className="container">
      {/* Workspace Header & Action Controls */}
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
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--accent-blue)' }}>
              Case {caseId}
            </span>
          </div>

          <h1>{loadingCase ? 'Loading Case...' : caseData?.title || 'Case Workspace'}</h1>
          {caseData?.description && (
            <p style={{ marginTop: '0.25rem' }}>{caseData.description}</p>
          )}
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link to={`/cases/${caseId}/reports`} className="btn btn-secondary">
            View Report History
          </Link>

          {/* Analyze Evidence Button States: idle / loading / error */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleAnalyze}
            disabled={analyzing}
          >
            {analyzing ? 'Analyzing...' : '⚡ Analyze evidence'}
          </button>
        </div>
      </div>

      {/* Case Metadata Load Error */}
      {caseError && (
        <div className="alert alert-danger" style={{ marginBottom: '1.5rem' }}>
          <span>{caseError}</span>
        </div>
      )}

      {/* Analysis Error Banner with Error Kind and Evidence Safety Confirmation */}
      {analysisError && (
        <div
          className="alert alert-danger"
          style={{
            marginBottom: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            borderLeft: '4px solid #ef4444',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <span className="badge badge-disputed" style={{ textTransform: 'uppercase' }}>
                {analysisError.kind}
              </span>
              <strong style={{ fontSize: '0.95rem' }}>
                {getErrorKindDescription(analysisError.kind).title}
              </strong>
            </div>
            <div style={{ fontSize: '0.9rem', marginBottom: '0.35rem' }}>
              {analysisError.message}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#fecaca', opacity: 0.9 }}>
              {getErrorKindDescription(analysisError.kind).hint}
            </div>
          </div>

          {/* Explicit confirmation that evidence is still saved */}
          <div
            style={{
              padding: '0.5rem 0.75rem',
              background: 'rgba(0, 0, 0, 0.25)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              color: '#a7f3d0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <span>
              ✓ <strong>Evidence Confirmed Safe:</strong> All submitted evidence records remain permanently saved in MongoDB. Prior report versions are unaffected.
            </span>

            {/* Retry Analysis Button */}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleAnalyze}
              disabled={analyzing}
            >
              {analyzing ? 'Retrying...' : '↻ Retry analysis'}
            </button>
          </div>
        </div>
      )}

      {/* Evidence Section with Monospace IDs, Form, and Row Highlighting */}
      <EvidenceSection
        caseId={caseId}
        highlightedEvidenceCode={highlightedEvidenceCode}
      />

      {/* Working Memory Inspector Panel */}
      <MemoryInspector
        caseId={caseId}
        onEvidenceClick={handleEvidenceCitationClick}
        refreshTrigger={report ? report.version : 0}
      />

      {/* Synthesized Investigation Report View */}
      <ReportView
        report={report}
        onEvidenceClick={handleEvidenceCitationClick}
      />
    </div>
  );
}
