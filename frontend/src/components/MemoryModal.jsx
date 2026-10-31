import React from 'react';
import MemoryInspector from './MemoryInspector';

export default function MemoryModal({ caseId, isOpen, onClose, onEvidenceClick }) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: '950px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Working Memory Inspector</h2>
          <button type="button" className="btn-close-modal" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Inspect persistent evolving statements, epistemic confidence, and historical rationale behind AI hypothesis updates.
        </p>

        <MemoryInspector
          caseId={caseId}
          onEvidenceClick={onEvidenceClick}
        />
      </div>
    </div>
  );
}
