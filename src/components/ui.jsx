import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';

export const ACCENTS = {
  violet: { color: '#a78bfa', grad: 'linear-gradient(135deg, #7c5cff, #a78bfa)', soft: 'rgba(124, 92, 255, 0.16)' },
  cyan: { color: '#22d3ee', grad: 'linear-gradient(135deg, #0891b2, #22d3ee)', soft: 'rgba(34, 211, 238, 0.16)' },
  amber: { color: '#fbbf24', grad: 'linear-gradient(135deg, #d97706, #fbbf24)', soft: 'rgba(251, 191, 36, 0.16)' },
  rose: { color: '#fb7185', grad: 'linear-gradient(135deg, #e11d48, #fb7185)', soft: 'rgba(251, 113, 133, 0.16)' },
  emerald: { color: '#34d399', grad: 'linear-gradient(135deg, #059669, #34d399)', soft: 'rgba(52, 211, 153, 0.16)' },
  gold: { color: '#f5c451', grad: 'linear-gradient(135deg, #b45309, #f5c451)', soft: 'rgba(245, 196, 81, 0.16)' },
};

export function accentOf(name) {
  return ACCENTS[name] || ACCENTS.violet;
}

/* --------------------------------- formatters -------------------------------- */

const dateFormatter = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateFormatter.format(d);
}

export function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFormatter.format(d);
}

export function timeAgo(value) {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return '—';
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.round(hours / 24);
  if (days < 30) return `قبل ${days} يوم`;
  return formatDate(value);
}

export function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('ar-EG-u-nu-latn').format(value);
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '؟';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[1][0]}`;
}

/* ---------------------------------- status ----------------------------------- */

export const STATUS_META = {
  pending_provider: { labelAr: 'بانتظار ربط المزوّد', tone: 'warn', icon: 'clock' },
  queued: { labelAr: 'في قائمة المعالجة', tone: 'info', icon: 'clock' },
  processing: { labelAr: 'جارٍ التوليد', tone: 'info', icon: 'refresh' },
  completed: { labelAr: 'مكتمل', tone: 'success', icon: 'check' },
  failed: { labelAr: 'فشل', tone: 'danger', icon: 'alert' },
  cancelled: { labelAr: 'ملغى', tone: 'default', icon: 'x' },
};

export function statusMeta(status) {
  return STATUS_META[status] || { labelAr: status || 'غير معروف', tone: 'default', icon: 'clock' };
}

/* ---------------------------------- toasts ----------------------------------- */

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message, tone = 'success') => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setToasts((list) => [...list, { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), 4200)
      );
      return id;
    },
    [dismiss]
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((timer) => clearTimeout(timer));
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast ${toast.tone === 'error' ? 'toast-error' : 'toast-success'}`}
            onClick={() => dismiss(toast.id)}
          >
            <Icon name={toast.tone === 'error' ? 'alert' : 'check'} size={18} />
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/* --------------------------------- primitives -------------------------------- */

export function Badge({ children, tone = 'default', dot = false, icon, style }) {
  const cls = tone && tone !== 'default' ? `badge badge-${tone}` : 'badge';
  return (
    <span className={cls} style={style}>
      {dot && <span className="badge-dot" />}
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}

export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="جارٍ التحميل" />;
}

export function LoaderScreen({ label = 'جارٍ التحميل…' }) {
  return (
    <div className="loader-screen">
      <Spinner size={26} />
      <p className="muted small">{label}</p>
    </div>
  );
}

export function Progress({ value, max, tone = 'violet' }) {
  const pct = max === null || max === undefined ? 0 : Math.min(100, Math.round((value / Math.max(max, 1)) * 100));
  const accent = accentOf(tone);
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max ?? 0}>
      <div className="progress-bar" style={{ width: `${pct}%`, background: accent.grad }} />
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone = 'violet' }) {
  const accent = accentOf(tone);
  return (
    <div className="stat card">
      <div className="row-between">
        <span className="stat-label">{label}</span>
        {icon && (
          <span className="tool-icon" style={{ width: 34, height: 34, borderRadius: 10, background: accent.soft, color: accent.color }}>
            <Icon name={icon} size={17} />
          </span>
        )}
      </div>
      <span className="stat-value">{value}</span>
      {hint && <span className="faint small">{hint}</span>}
    </div>
  );
}

export function EmptyState({ icon = 'sparkles', title, children, action }) {
  return (
    <div className="empty-state">
      <span className="feature-icon" style={{ background: 'rgba(124,92,255,0.14)', color: '#a78bfa' }}>
        <Icon name={icon} size={24} />
      </span>
      <h3>{title}</h3>
      {children && <p className="muted small">{children}</p>}
      {action}
    </div>
  );
}

export function Field({ label, hint, error, htmlFor, children, required }) {
  return (
    <div className="field">
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label} {required && <span style={{ color: 'var(--rose)' }}>*</span>}
        </label>
      )}
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, width = 520 }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row-between" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{title}</h3>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="إغلاق">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="stack">{children}</div>
        {footer && <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>{footer}</div>}
      </div>
    </div>
  );
}

export function ConnectionBadge({ connected, compact = false }) {
  return connected ? (
    <Badge tone="success" dot>
      {compact ? 'مُهيّأ' : 'المزوّد مُهيّأ على الخادم'}
    </Badge>
  ) : (
    <Badge tone="warn" dot>
      {compact ? 'غير متصل' : 'غير متصل بمزوّد بعد'}
    </Badge>
  );
}
