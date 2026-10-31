import React from 'react';
import EvidenceSection from './EvidenceSection';

export default function EvidenceModal({ caseId, isOpen, onClose, onEvidenceAdded }) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: '850px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Case Evidence Ledger</h2>
          <button type="button" className="btn-close-modal" onClick={onClose}>
            ✕
          </button>
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Permanent, immutable evidence entries scoped to this case file.
        </p>

        <EvidenceSection
          caseId={caseId}
          onEvidenceAdded={onEvidenceAdded}
        />
      </div>
    </div>
  );
}
