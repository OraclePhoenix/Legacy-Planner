import { useEffect, useRef } from 'react';

export function Alert({ kind = 'error', children }) {
  if (!children) return null;
  return <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Field({ label, id, hint, children }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}

export function ProgressBar({ value, total, label }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="progress-wrap">
      <div className="progress-label"><span>{label}</span><span>{value} of {total} ({pct}%)</span></div>
      <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Native <dialog> gives focus trapping and Escape-to-close for free.
export function Modal({ open, title, onClose, children }) {
  const ref = useRef(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  // Only report closes the user caused (Escape), not ones driven by the open prop.
  const handleClose = () => { if (openRef.current) onClose(); };
  return (
    <dialog ref={ref} className="modal" aria-labelledby="modal-title" onClose={handleClose}>
      <h2 id="modal-title">{title}</h2>
      {open && children}
    </dialog>
  );
}

export const StatusBadge = ({ status }) => <span className={`badge badge-${status}`}>{status.replace(/_/g, ' ')}</span>;
