import { clsx } from "clsx";
import { AlertTriangle, Info } from "lucide-react";
import type { ReactNode } from "react";

export const cn = (...a: Parameters<typeof clsx>) => clsx(...a);

export function Card({ className, children, title, action, subtitle }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <section className={cn("glass rounded-xl", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            {title && <h2 className="text-[13px] font-semibold tracking-wide text-ink uppercase">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Button({ className, variant = "default", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "ghost" | "primary" | "danger" }) {
  return (
    <button
      {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent",
        variant === "primary" && "bg-accent text-navy hover:bg-blue-300",
        variant === "default" && "border border-line bg-white/5 text-ink hover:bg-white/10",
        variant === "ghost" && "text-muted hover:bg-white/5 hover:text-ink",
        variant === "danger" && "border border-down/40 text-down hover:bg-down/10",
        className,
      )}
    />
  );
}

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn("w-full rounded-lg border border-line bg-navy/70 px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none", className)} />;
}

export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cn("rounded-lg border border-line bg-navy px-2.5 py-2 text-sm text-ink focus:border-accent/60 focus:outline-none", className)} />;
}

const VERDICT_STYLE: Record<string, string> = {
  "STRONG BUY": "bg-up/20 text-up border-up/40",
  BUY: "bg-up/10 text-up border-up/30",
  HOLD: "bg-warn/10 text-warn border-warn/30",
  SELL: "bg-down/10 text-down border-down/30",
  "STRONG SELL": "bg-down/20 text-down border-down/40",
  "INSUFFICIENT DATA": "bg-white/5 text-muted border-line",
};

export function VerdictBadge({ v, className }: { v: string | null | undefined; className?: string }) {
  if (!v) return <span className="text-faint">—</span>;
  return <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap", VERDICT_STYLE[v] ?? VERDICT_STYLE["INSUFFICIENT DATA"], className)}>{v}</span>;
}

export function StatusDot({ s }: { s: string }) {
  const c = s === "ok" ? "bg-up" : s === "partial" || s === "stale" ? "bg-warn" : s === "error" ? "bg-down" : "bg-faint";
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", c)} aria-label={s} />;
}

export function Notice({ kind = "info", children, className }: { kind?: "info" | "warn"; children: ReactNode; className?: string }) {
  const Icon = kind === "warn" ? AlertTriangle : Info;
  return (
    <div className={cn("flex gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed", kind === "warn" ? "border-warn/30 bg-warn/5 text-amber-200" : "border-accent/20 bg-accent/5 text-blue-200", className)}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function Unavailable({ what, why }: { what: string; why?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-muted">
      <div className="font-medium text-ink/80">{what} unavailable</div>
      {why && <div className="mt-1">{why}</div>}
    </div>
  );
}

export const fmtNum = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtPct = (x: number | null | undefined, d = 2) => (x == null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(d)}%`);
export const fmtCompact = (x: number | null | undefined) => (x == null ? "—" : Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 2 }).format(x));
export const tone = (x: number | null | undefined) => (x == null ? "text-muted" : x > 0 ? "text-up" : x < 0 ? "text-down" : "text-muted");

export function Pct({ v, d = 2, className }: { v: number | null | undefined; d?: number; className?: string }) {
  return <span className={cn("num", tone(v), className)}>{fmtPct(v, d)}</span>;
}

export function ScoreBar({ v, label }: { v: number | null; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">{v != null && <div className={cn("h-full rounded-full", v >= 60 ? "bg-up" : v >= 45 ? "bg-warn" : "bg-down")} style={{ width: `${v}%` }} />}</div>
      <span className="num w-9 text-right text-xs text-muted">{v ?? "—"}</span>
      {label && <span className="text-xs text-muted">{label}</span>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent", className)} />;
}

export function SourceLink({ href, children }: { href?: string | null; children: ReactNode }) {
  if (!href) return <span className="text-muted">{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent hover:underline">
      {children}
    </a>
  );
}
