import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listCases, createCase, ApiError } from '../api';

export default function CasesPage() {
  const navigate = useNavigate();

  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const fetchCases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listCases();
      setCases(Array.isArray(data) ? data : []);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err.message || 'Failed to load cases.');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function loadInitial() {
      try {
        const data = await listCases();
        if (!ignore) {
          setCases(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        if (!ignore) {
          const msg = err instanceof ApiError ? err.message : (err.message || 'Failed to load cases.');
          setError(msg);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadInitial();
    return () => {
      ignore = true;
    };
  }, []);

  const handleCreateCase = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setFormError('Title is required.');
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const newCase = await createCase({
        title: title.trim(),
        description: description.trim(),
      });

      setTitle('');
      setDescription('');
      // Prepend newly created case and keep list updated
      setCases((prev) => [newCase, ...prev]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err.message || 'Failed to create case.');
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="container">
      <h1 style={{ marginBottom: '1.5rem' }}>Cases</h1>

      {/* Global Error Banner */}
      {error && (
        <div className="alert alert-danger" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={fetchCases}
          >
            Retry
          </button>
        </div>
      )}

      {/* Cases Table */}
      <div className="table-wrapper" style={{ marginBottom: '2.5rem' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Created Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan="3" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  Loading cases...
                </td>
              </tr>
            )}

            {!loading && cases.length === 0 && !error && (
              <tr>
                <td colSpan="3" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No cases found. Create your first case using the form below.
                </td>
              </tr>
            )}

            {!loading &&
              cases.map((c) => (
                <tr
                  key={c._id}
                  className="table-row-clickable"
                  tabIndex={0}
                  role="button"
                  aria-label={`Open workspace for case ${c.title}`}
                  onClick={() => navigate(`/cases/${c._id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/cases/${c._id}`);
                    }
                  }}
                >
                  <td style={{ fontWeight: 600 }}>{c.title}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
                    {formatDate(c.createdAt)}
                  </td>
                  <td>
                    <span className="badge badge-verified">{c.status || 'open'}</span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Simple Form to Create a Case */}
      <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Create Case</h2>

      {formError && (
        <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
          {formError}
        </div>
      )}

      <form onSubmit={handleCreateCase} style={{ maxWidth: '600px' }}>
        <div className="form-group">
          <label className="form-label" htmlFor="case-title">
            Title <span className="required">*</span>
          </label>
          <input
            id="case-title"
            type="text"
            className="form-control"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Case title"
            disabled={submitting}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="case-description">
            Description
          </label>
          <textarea
            id="case-description"
            className="form-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Case description"
            disabled={submitting}
            rows={3}
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={submitting || !title.trim()}
        >
          {submitting ? 'Creating Case...' : 'Create Case'}
        </button>
      </form>
    </div>
  );
}
