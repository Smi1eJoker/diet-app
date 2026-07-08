export function Modal({ title, children, onClose, className = "" }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className={`modal-card ${className}`.trim()} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <strong>{title}</strong>
          <button type="button" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalActions({ onCancel, submitText }) {
  return (
    <div className="modal-actions">
      <button type="button" className="ghost-button" onClick={onCancel}>
        취소
      </button>
      <button type="submit" className="primary-button">
        {submitText}
      </button>
    </div>
  );
}
