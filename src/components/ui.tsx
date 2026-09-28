import clsx from 'clsx';
import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';

// ---------------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'accent' | 'ghost' | 'danger' | 'success';
const variants: Record<Variant, string> = {
  // iSchool UI design system: pill buttons, blue main, blue outline, orange secondary
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 focus-visible:ring-brand-500 disabled:bg-slate-300 disabled:text-white/80 disabled:opacity-100',
  secondary: 'bg-white text-brand-600 ring-1 ring-inset ring-brand-600 hover:bg-brand-50 active:bg-brand-100 focus-visible:ring-brand-500',
  accent: 'bg-orange-500 text-white hover:bg-orange-600 active:bg-orange-700 focus-visible:ring-orange-400 disabled:bg-orange-500/40 disabled:text-white/80 disabled:opacity-100',
  ghost: 'text-brand-600 hover:bg-brand-50 hover:text-brand-700 focus-visible:ring-brand-500',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500 shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500 shadow-sm',
};

export function Button({
  variant = 'primary', size = 'md', loading, className, children, disabled, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'h-8 px-3.5 text-xs',
        size === 'md' && 'h-10 px-5 text-sm',
        size === 'lg' && 'h-12 px-6 text-sm',
        variants[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('rounded-2xl border border-slate-200 bg-white shadow-card', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

type Tone = 'slate' | 'blue' | 'orange' | 'green' | 'amber' | 'red' | 'violet' | 'cyan';
const tones: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-brand-50 text-brand-700 ring-brand-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  violet: 'bg-deci-50 text-deci-700 ring-deci-200',
  cyan: 'bg-demi-50 text-demi-700 ring-demi-200',
};
export function Badge({ tone = 'slate', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone], className)}>
      {children}
    </span>
  );
}

export function OrgBadge({ org }: { org: 'DEMI' | 'DECI' }) {
  return <Badge tone={org === 'DEMI' ? 'cyan' : 'violet'}>{org}</Badge>;
}

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={clsx('flex items-center justify-center gap-2 py-10 text-sm text-slate-500', className)}>
      <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
      {label ?? 'Loading…'}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, className }: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const map = {
    info: ['border-brand-200 bg-brand-50 text-brand-900', Info],
    warning: ['border-amber-200 bg-amber-50 text-amber-900', AlertTriangle],
    error: ['border-rose-200 bg-rose-50 text-rose-900', XCircle],
    success: ['border-emerald-200 bg-emerald-50 text-emerald-900', CheckCircle2],
  } as const;
  const [cls, Icon] = map[tone];
  return (
    <div className={clsx('flex gap-3 rounded-xl border px-4 py-3 text-sm', cls, className)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5', 'break-words')}>{children}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, required }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

const inputCls =
  'block w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputCls, props.className)} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(inputCls, 'pr-8', props.className)} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(inputCls, 'resize-y', props.className)} />;
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={clsx(
          'relative flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl',
          size === 'md' && 'sm:max-w-lg',
          size === 'lg' && 'sm:max-w-2xl',
          size === 'xl' && 'sm:max-w-5xl',
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">{icon}</div>}
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, breadcrumb }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <div className="mb-6 flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && <div className="mb-1 text-xs font-medium text-slate-500">{breadcrumb}</div>}
        <h1 className="break-words text-2xl font-semibold tracking-tight text-slate-900 sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 break-words text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, icon, tone = 'blue', hint }: { label: string; value: ReactNode; icon?: ReactNode; tone?: 'blue' | 'green' | 'amber' | 'violet' | 'slate' | 'red'; hint?: ReactNode }) {
  const bg = {
    blue: 'bg-brand-50 text-brand-600', green: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-deci-50 text-deci-700', slate: 'bg-slate-100 text-slate-600', red: 'bg-rose-50 text-rose-600',
  }[tone];
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900">{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        {icon && <div className={clsx('rounded-2xl p-3', bg)}>{icon}</div>}
      </div>
    </Card>
  );
}

export function ProgressBar({ value, max, tone = 'blue', className }: { value: number; max: number; tone?: 'blue' | 'green' | 'amber'; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={clsx('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div
        className={clsx('h-full rounded-full transition-all', tone === 'blue' && 'bg-brand-600', tone === 'green' && 'bg-emerald-500', tone === 'amber' && 'bg-amber-500')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
interface Toast { id: number; tone: 'success' | 'error' | 'info'; message: string }
const ToastCtx = createContext<(tone: Toast['tone'], message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'pointer-events-auto flex max-w-sm items-start gap-2 rounded-2xl px-4 py-3 text-sm text-white shadow-lg',
              t.tone === 'success' && 'bg-emerald-600',
              t.tone === 'error' && 'bg-rose-600',
              t.tone === 'info' && 'bg-slate-900',
            )}
            role="status"
          >
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : t.tone === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export function formatScore(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toFixed(digits).replace(/\.00$/, '');
}

export function formatDate(v: string | null | undefined) {
  if (!v) return '—';
  return new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
