import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

const toastStyles = {
  success: {
    icon: CheckCircle2,
    shell: 'toast-message-success',
    label: 'Success'
  },
  error: {
    icon: XCircle,
    shell: 'toast-message-error',
    label: 'Error'
  },
  warning: {
    icon: AlertTriangle,
    shell: 'toast-message-warning',
    label: 'Warning'
  },
  info: {
    icon: Info,
    shell: 'toast-message-info',
    label: 'Info'
  }
};

export default function ToastMessage({ type = 'info', children, actionLabel = '', onAction, className = '' }) {
  const style = toastStyles[type] || toastStyles.info;
  const Icon = style.icon;
  const [visible, setVisible] = useState(true);
  const isCloseAction = actionLabel.trim().toLowerCase() === 'close';
  const closeToast = () => {
    setVisible(false);
    if (isCloseAction && onAction) onAction();
  };

  useEffect(() => {
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [children, type]);

  if (!visible) return null;

  return (
    <div className={`toast-message ${style.shell} ${className}`} role="status" aria-label={style.label}>
      <span className="toast-message-icon">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <strong className="toast-message-title">{type === 'error' ? 'Failed!' : `${style.label}!`}</strong>
        <p className="toast-message-copy">{children}</p>
      </div>
      {onAction && !isCloseAction ? (
        <button type="button" onClick={onAction} className="toast-message-action">
          {actionLabel || 'Action'}
        </button>
      ) : null}
      <button type="button" onClick={closeToast} className="toast-message-close" aria-label="Close message">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastClose({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="toast-message-close" aria-label="Close message">
      <X className="h-4 w-4" />
    </button>
  );
}
