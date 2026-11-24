import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function ArReviewDialog({ title, onClose, busy = false, children }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; previousFocus?.focus?.(); };
  }, []);
  function keyDown(event) {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  return createPortal(<div className="ar-review ar-dialog-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ar-dialog-title" aria-busy={busy} onKeyDown={keyDown} className="ar-dialog"><header><div><p className="ar-eyebrow">Annual Return</p><h2 id="ar-dialog-title">{title}</h2></div><button ref={closeRef} type="button" aria-label="Close popup" disabled={busy} onClick={onClose}><X size={20} /></button></header><div className="ar-dialog-content">{children}</div></section></div>, document.body);
}
