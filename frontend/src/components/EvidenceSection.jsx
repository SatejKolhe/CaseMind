import React, { useState, useEffect, useCallback } from 'react';
import { listEvidence, addEvidence, ApiError } from '../api';

const ALLOWED_VERIFICATION_STATUSES = ['unverified', 'verified', 'disputed'];
const ALLOWED_SOURCE_TYPES = ['witness', 'physical', 'digital', 'document', 'cctv'];

export default function EvidenceSection({ caseId, highlightedEvidenceCode }) {
  const [evidenceList, setEvidenceList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  // Form input states
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [sourceType, setSourceType] = useState('witness');
  const [timestamp, setTimestamp] = useState('');
  const [verificationStatus, setVerificationStatus] = useState('unverified');

  // Form submission & error states
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formSuccess, setFormSuccess] = useState(null);

  // Fetch existing evidence for this case
  const fetchEvidence = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setFetchError(null);
    try {
      const data = await listEvidence(caseId);
      setEvidenceList(Array.isArray(data) ? data : []);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err.message || 'Failed to load evidence.');
      setFetchError(msg);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!caseId) return;
      try {
        const data = await listEvidence(caseId);
        if (!ignore) {
          setEvidenceList(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!ignore) {
          const msg = err instanceof ApiError ? err.message : (err.message || 'Failed to load evidence.');
          setFetchError(msg);
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
  }, [caseId]);

  // Client-side validation and submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    // Client-side required field validations
    if (!title.trim()) {
      setFormError('Title/summary is required.');
      return;
    }
    if (!content.trim()) {
      setFormError('Evidence content is required.');
      return;
    }
    if (!source.trim()) {
      setFormError('Source description is required.');
      return;
    }
    if (!timestamp) {
      setFormError('Timestamp (occurred at) is required.');
      return;
    }

    const parsedDate = new Date(timestamp);
    if (isNaN(parsedDate.getTime())) {
      setFormError('Please enter a valid date/time timestamp.');
      return;
    }

    setSaving(true);

    try {
      const payload = {
        title: title.trim(),
        content: content.trim(),
        source: source.trim(),
        sourceType,
        verificationStatus,
        occurredAt: parsedDate.toISOString(),
      };

      // Call API to persist evidence in MongoDB
      const createdEvidence = await addEvidence(caseId, payload);

      // Only add to table AFTER the API confirms write
      setEvidenceList((prev) => [...prev, createdEvidence]);

      // Reset form
      setTitle('');
      setContent('');
      setSource('');
      setSourceType('witness');
      setTimestamp('');
      setVerificationStatus('unverified');
      setFormSuccess(`Evidence code ${createdEvidence.evidenceCode || ''} committed successfully.`);
    } catch (err) {
      // Display backend error inline
      const backendMessage = err instanceof ApiError ? err.message : (err.message || 'Failed to save evidence.');
      setFormError(backendMessage);
    } finally {
      setSaving(false);
    }
  };

  const formatTimestamp = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? dateStr : d.toLocaleString();
    } catch {
      return dateStr;
    }
  };

  const getBadgeClass = (status) => {
    switch (status) {
      case 'verified':
        return 'badge-verified';
      case 'disputed':
        return 'badge-disputed';
      case 'unverified':
      default:
        return 'badge-unverified';
    }
  };

  return (
    <section className="evidence-section" style={{ marginTop: '2rem' }}>
      <h2 style={{ fontSize: '1.4rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
        Case Evidence
      </h2>

      {/* Evidence Submission Form */}
      <div style={{ maxWidth: '720px', marginBottom: '2.5rem' }}>
        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-muted)' }}>
          Submit New Evidence
        </h3>

        {/* Inline Backend / Client Error Display */}
        {formError && (
          <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
            <span>{formError}</span>
          </div>
        )}

        {formSuccess && (
          <div className="alert alert-success" style={{ marginBottom: '1rem' }}>
            <span>{formSuccess}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Title / Summary */}
          <div className="form-group">
            <label className="form-label" htmlFor="evidence-title">
              Title / Summary <span className="required">*</span>
            </label>
            <input
              id="evidence-title"
              type="text"
              className="form-control"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Display Case Pressure Sensor Telemetry"
              disabled={saving}
            />
          </div>

          {/* Content */}
          <div className="form-group">
            <label className="form-label" htmlFor="evidence-content">
              Content <span className="required">*</span>
            </label>
            <textarea
              id="evidence-content"
              className="form-textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Detailed excerpt, witness narrative, or telemetry log..."
              disabled={saving}
              rows={3}
            />
          </div>

          {/* Source and Source Type */}
          <div className="form-group-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="evidence-source">
                Source <span className="required">*</span>
              </label>
              <input
                id="evidence-source"
                type="text"
                className="form-control"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. Gallery Telemetry Server Log #81"
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="evidence-source-type">
                Source Type <span className="required">*</span>
              </label>
              <select
                id="evidence-source-type"
                className="form-select"
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                disabled={saving}
              >
                {ALLOWED_SOURCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Timestamp and Verification Status */}
          <div className="form-group-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="evidence-timestamp">
                Timestamp (Occurred At) <span className="required">*</span>
              </label>
              <input
                id="evidence-timestamp"
                type="datetime-local"
                className="form-control"
                value={timestamp}
                onChange={(e) => setTimestamp(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="evidence-verification">
                Verification Status <span className="required">*</span>
              </label>
              <select
                id="evidence-verification"
                className="form-select"
                value={verificationStatus}
                onChange={(e) => setVerificationStatus(e.target.value)}
                disabled={saving}
              >
                {ALLOWED_VERIFICATION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving}
            style={{ marginTop: '0.5rem' }}
          >
            {saving ? 'Saving Evidence...' : 'Add Evidence'}
          </button>
        </form>
      </div>

      {/* Existing Evidence Table */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ fontSize: '1.1rem', color: 'var(--text-muted)' }}>
            Existing Evidence ({evidenceList.length})
          </h3>
          {fetchError && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={fetchEvidence}
            >
              Retry Load
            </button>
          )}
        </div>

        {fetchError && (
          <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
            <span>{fetchError}</span>
          </div>
        )}

        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '110px' }}>ID</th>
                <th>Summary</th>
                <th>Source</th>
                <th>Timestamp</th>
                <th style={{ width: '130px' }}>Verification</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    Loading evidence records...
                  </td>
                </tr>
              )}

              {!loading && evidenceList.length === 0 && !fetchError && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                    No evidence submitted yet for this case.
                  </td>
                </tr>
              )}

              {!loading &&
                evidenceList.map((item) => {
                  const isHighlighted = highlightedEvidenceCode === item.evidenceCode;
                  return (
                    <tr
                      key={item._id || item.evidenceCode}
                      id={`evidence-row-${item.evidenceCode}`}
                      className={isHighlighted ? 'highlighted-evidence-row' : ''}
                    >
                      <td>
                        <span className="badge badge-code">
                          {item.evidenceCode || (item._id ? String(item._id).slice(-5) : 'EV-—')}
                        </span>
                      </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.title}</div>
                      {item.content && (
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                          {item.content}
                        </div>
                      )}
                    </td>
                    <td>
                      <div>{item.source}</div>
                      {item.sourceType && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', textTransform: 'capitalize' }}>
                          {item.sourceType}
                        </div>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                      {formatTimestamp(item.occurredAt)}
                    </td>
                    <td>
                      <span className={`badge ${getBadgeClass(item.verificationStatus)}`}>
                        {item.verificationStatus || 'unverified'}
                      </span>
                    </td>
                  </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
