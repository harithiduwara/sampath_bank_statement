import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Info, Minus, X, XCircle } from "lucide-react";

/* ------------------------------------------------------------------ Card */

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={clsx("print-full min-w-0 rounded-xl border border-line bg-surface shadow-card", className)}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="text-[0.95rem] font-semibold text-ink">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------- Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md"; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-accent text-accent-ink shadow-card hover:bg-accent-hover",
        variant === "secondary" && "border border-line-strong bg-surface text-ink shadow-card hover:bg-surface-3",
        variant === "ghost" && "text-ink-2 hover:bg-surface-3 hover:text-ink",
        variant === "danger" && "border border-line-strong bg-surface text-crit shadow-card hover:bg-crit-soft",
        className
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- Badge */

export type Tone = "neutral" | "good" | "warn" | "crit" | "info" | "accent";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2",
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  crit: "bg-crit-soft text-crit",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-accent",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium", TONE[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_ICON: Record<"good" | "warn" | "crit" | "info", typeof CheckCircle2> = {
  good: CheckCircle2,
  warn: AlertTriangle,
  crit: XCircle,
  info: Info,
};

/** Status always carries an icon and a label, never colour alone. */
export function Status({ tone, children, title }: { tone: "good" | "warn" | "crit" | "info"; children: ReactNode; title?: string }) {
  const Icon = STATUS_ICON[tone];
  return (
    <Badge tone={tone} title={title}>
      <Icon size={12} aria-hidden="true" />
      {children}
    </Badge>
  );
}

/* ------------------------------------------------------------------ Delta */

/** Change vs. previous period. `goodWhenUp` decides whether up is good news. */
export function Delta({ value, goodWhenUp = true, label = "vs previous period" }: { value: number | null; goodWhenUp?: boolean; label?: string }) {
  if (value === null) return <span className="text-xs text-ink-3">No comparison</span>;
  const flat = Math.abs(value) < 0.5;
  const up = value > 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={clsx("inline-flex items-center gap-0.5 font-medium", good === null ? "text-ink-2" : good ? "text-good" : "text-crit")}>
        <Icon size={13} aria-hidden="true" />
        {flat ? "0%" : `${Math.abs(value) >= 1000 ? ">999" : Math.abs(value).toFixed(1)}%`}
        <span className="sr-only">{flat ? "unchanged" : up ? "increase" : "decrease"}</span>
      </span>
      <span className="text-ink-3">{label}</span>
    </span>
  );
}

/* -------------------------------------------------------------------- KPI */

export function Kpi({
  label,
  value,
  hint,
  footer,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  footer?: ReactNode;
  tone?: "warn" | "crit";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card">
      <p className="flex items-center gap-1 text-xs font-medium text-ink-3" title={hint}>
        {label}
      </p>
      <p className={clsx("mt-1.5 truncate text-[1.45rem] font-semibold tracking-tight", tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : "text-ink")}>
        {value}
      </p>
      {footer && <div className="mt-1 min-h-4">{footer}</div>}
    </div>
  );
}

/* ------------------------------------------------------------ Page header */

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------ Empty state */

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 rounded-xl bg-surface-3 p-3 text-ink-3">{icon}</div>}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-ink-3">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------ Form fields */

export const fieldClass =
  "h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink shadow-card outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/25";

export function Select({
  label,
  value,
  onChange,
  options,
  className,
  hideLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className={clsx("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className={clsx("text-xs font-medium text-ink-3", hideLabel && "sr-only")}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={clsx(fieldClass, "pr-8")}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line-strong bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
            value === o.value ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- Drawer */

/** Right-hand panel. Esc and the backdrop close it; focus moves in and back out. */
export function Drawer({ open, title, subtitle, onClose, children, footer }: { open: boolean; title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex h-full w-full max-w-[460px] flex-col border-l border-line bg-surface shadow-pop outline-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-ink-3">{subtitle}</div>}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel" icon={<X size={16} />} />
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- Description list */

export function DefList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------- Table bits */

export const th = "whitespace-nowrap border-b border-line bg-surface-2 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-3";
export const td = "border-b border-line px-3 py-2.5 align-middle";
