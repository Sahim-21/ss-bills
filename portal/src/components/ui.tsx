"use client";

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

/** Material Symbols Outlined icon (self-hosted font; works offline). */
export function Icon({ name, className, fill }: { name: string; className?: string; fill?: boolean }) {
  return (
    <span aria-hidden className={cx("material-symbols-outlined", fill && "icon-fill", className)}>
      {name}
    </span>
  );
}

type ButtonVariant = "primary" | "secondary" | "charcoal" | "hold" | "ghost" | "danger" | "success" | "soft";
const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] shadow-level2",
  secondary: "bg-surface-lowest text-ink border border-line hover:bg-surface-low shadow-level1",
  charcoal: "bg-charcoal text-white hover:bg-black",
  hold: "bg-hold-surface text-hold-ink border border-hold hover:bg-[#fde68a]",
  ghost: "text-ink-variant hover:bg-surface-high",
  danger: "bg-error text-white hover:bg-on-error-container",
  success: "bg-tertiary text-white hover:bg-[#00521f]",
  soft: "bg-surface-container text-ink hover:bg-surface-high",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  kbd,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  icon?: string;
  kbd?: string;
}) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none select-none",
        size === "sm" && "h-9 px-3 text-label-md",
        size === "md" && "h-11 px-4 text-label-lg",
        size === "lg" && "h-14 px-6 text-headline-sm",
        BUTTON_STYLES[variant],
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} className={size === "lg" ? "text-[24px]" : "text-[20px]"} />}
      {children}
      {kbd && <Kbd dark={variant === "primary" || variant === "charcoal" || variant === "danger" || variant === "success"}>{kbd}</Kbd>}
    </button>
  );
}

export function Kbd({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <kbd
      className={cx(
        "rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold",
        dark ? "bg-white/20 text-white" : "bg-surface-high text-ink-variant",
      )}
    >
      {children}
    </kbd>
  );
}

/** FSSAI veg / non-veg mark. */
export function VegMark({ veg, size = 16 }: { veg: boolean; size?: number }) {
  const color = veg ? "var(--color-veg)" : "var(--color-nonveg)";
  return (
    <span
      role="img"
      aria-label={veg ? "Veg" : "Non-veg"}
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] bg-white"
      style={{ width: size, height: size, border: `1.5px solid ${color}` }}
    >
      {veg ? (
        <span className="rounded-full" style={{ width: size / 2, height: size / 2, background: color }} />
      ) : (
        <span
          style={{
            width: 0,
            height: 0,
            borderLeft: `${size / 4}px solid transparent`,
            borderRight: `${size / 4}px solid transparent`,
            borderBottom: `${size / 2.4}px solid ${color}`,
          }}
        />
      )}
    </span>
  );
}

export function Chip({
  active,
  count,
  children,
  onClick,
  icon,
  className,
}: {
  active?: boolean;
  count?: number;
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-label-md transition-all active:scale-95",
        active
          ? "bg-charcoal text-white shadow-level1"
          : "border border-line bg-surface-lowest text-muted hover:bg-surface-low hover:text-ink",
        className,
      )}
    >
      {icon}
      <span>{children}</span>
      {count !== undefined && (
        <span
          className={cx(
            "tnum min-w-5 rounded-full px-1.5 py-0.5 text-label-sm",
            active ? "bg-primary-container text-white" : "bg-surface-container text-muted",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: string }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" className={cx("flex gap-1 rounded-xl bg-surface-container p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 font-semibold transition-all",
              size === "md" ? "h-11 text-label-lg" : "h-9 text-label-md",
              active ? "bg-surface-lowest text-primary shadow-level2" : "text-muted hover:text-ink",
            )}
          >
            {o.icon && <Icon name={o.icon} className="text-[20px]" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-40",
        checked ? "bg-tertiary-container" : "bg-surface-highest",
      )}
    >
      <span
        className={cx(
          "inline-block h-5 w-5 rounded-full bg-white shadow-level2 transition-transform",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl border border-line bg-surface-lowest shadow-level1", className)}>{children}</div>;
}

type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger" | "charcoal";
const BADGE: Record<BadgeTone, string> = {
  neutral: "bg-surface-container text-ink-variant",
  primary: "bg-primary-fixed text-primary",
  success: "bg-[#dcfce7] text-tertiary",
  warning: "bg-hold-surface text-hold-ink",
  danger: "bg-error-container text-on-error-container",
  charcoal: "bg-charcoal text-white",
};

export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label-sm uppercase", BADGE[tone], className)}>
      {children}
    </span>
  );
}

export function Stepper({ qty, onChange }: { qty: number; onChange: (q: number) => void }) {
  return (
    <div className="flex h-11 items-center rounded-lg bg-surface-low">
      <button
        type="button"
        aria-label={qty === 1 ? "Remove item" : "Decrease quantity"}
        onClick={() => onChange(qty - 1)}
        className="flex h-11 w-10 items-center justify-center rounded-lg text-ink hover:bg-surface-high"
      >
        <Icon name={qty === 1 ? "delete" : "remove"} className="text-[20px]" />
      </button>
      <span className="tnum w-7 text-center text-headline-sm">{qty}</span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => onChange(qty + 1)}
        className="flex h-11 w-10 items-center justify-center rounded-lg text-ink hover:bg-surface-high"
      >
        <Icon name="add" className="text-[20px]" />
      </button>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  children,
  className,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cx("relative max-h-[92vh] w-full overflow-auto rounded-3xl bg-surface-lowest shadow-level3", className)}
      >
        {children}
      </div>
    </div>
  );
}

/** Right-side slide-over panel. */
export function Drawer({
  open,
  onClose,
  children,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0 bg-charcoal/30" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        className="absolute right-0 top-0 flex h-full flex-col overflow-hidden rounded-l-3xl bg-surface-lowest shadow-level3"
        style={{ width }}
      >
        {children}
      </aside>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="mb-1 text-label-sm uppercase text-primary">{eyebrow}</div>}
        <h1 className="text-headline-lg text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-body-md text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2 text-label-lg text-ink">
        {label}
        {hint && <span className="text-label-md font-medium text-muted">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  "h-12 w-full rounded-xl bg-surface-low px-4 text-body-lg text-ink outline-none transition-all placeholder:text-muted focus:bg-surface-lowest focus:ring-2 focus:ring-primary";

export function SearchInput({
  value,
  onChange,
  placeholder,
  kbd,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  kbd?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("relative flex items-center", className)}>
      <Icon name="search" className="pointer-events-none absolute left-4 text-[22px] text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        data-search
        className={cx(inputClass, "pl-12", kbd && "pr-14")}
      />
      {kbd && (
        <span className="absolute right-3">
          <Kbd>{kbd}</Kbd>
        </span>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-container text-muted">
        <Icon name={icon} className="text-[28px]" />
      </span>
      <div className="text-headline-sm">{title}</div>
      {children && <div className="max-w-xs text-body-md text-muted">{children}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: string;
  tone?: "neutral" | "primary" | "danger";
}) {
  return (
    <Card className={cx("relative overflow-hidden p-5", tone === "primary" && "border-t-4 border-t-primary-container", tone === "danger" && "border-t-4 border-t-error")}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-label-md uppercase text-muted">{label}</div>
        <span
          className={cx(
            "flex h-11 w-11 items-center justify-center rounded-xl",
            tone === "primary" ? "bg-primary-fixed text-primary" : tone === "danger" ? "bg-error-container text-error" : "bg-surface-container text-ink",
          )}
        >
          <Icon name={icon} className="text-[22px]" />
        </span>
      </div>
      <div className="tnum mt-1 text-headline-xl">{value}</div>
      {sub && <div className="mt-3 rounded-lg bg-surface-low px-3 py-2 text-body-md text-muted">{sub}</div>}
    </Card>
  );
}

/** Shown in place of admin screens when a cashier is logged in. */
export function AdminOnly() {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <Card className="max-w-md p-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-fixed text-primary">
          <Icon name="admin_panel_settings" className="text-[30px]" />
        </span>
        <h2 className="mt-4 text-headline-md">Admin only</h2>
        <p className="mt-2 text-body-md text-muted">
          This screen is available to Admin accounts. Ask the owner or manager to log in.
        </p>
      </Card>
    </div>
  );
}
