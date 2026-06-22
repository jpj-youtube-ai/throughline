import type { ReactNode } from "react";

export type Tone = "neutral" | "spine" | "shipped" | "planned" | "risk";

const TONE: Record<Tone, string> = {
  neutral: "bg-paper-sunk text-graphite",
  spine: "bg-spine-wash text-spine-deep",
  shipped: "bg-shipped-wash text-shipped",
  planned: "bg-planned-wash text-planned",
  risk: "bg-risk-wash text-risk",
};

// A small status label. Carries an optional leading dot so meaning never rests
// on color alone.
export function Pill({ tone = "neutral", children, dot = true }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-medium tracking-wide ${TONE[tone]}`}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

// A surface panel. The optional `accent` tints it in the spec map's status
// language so a card's lifecycle reads at a glance: `active` = in-progress
// (amber), `shipped` = merged/done (teal). Color stays reinforcing — callers
// also label the state in text — never the sole signal.
export function Card({
  children,
  className = "",
  id,
  accent,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  accent?: "active" | "shipped";
}) {
  const surface =
    accent === "shipped"
      ? "border-shipped/40 bg-shipped-wash"
      : accent === "active"
        ? "border-planned/40 bg-planned-wash"
        : "border-hairline bg-paper-raised";
  return (
    <div id={id} className={`rounded-leaf border ${surface} ${className}`}>
      {children}
    </div>
  );
}

// The page title block. Eyebrow in mono (the section's place in the system),
// title in the wide display face.
export function PageHeader({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-5">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-spine">{eyebrow}</div>
        <h1 className="font-display mt-1.5 text-3xl font-bold text-ink">{title}</h1>
        {lede && <p className="mt-2 max-w-prose text-sm text-graphite">{lede}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-leaf border border-dashed border-hairline bg-paper-raised/50 px-6 py-14 text-center">
      <p className="font-display text-lg text-ink">{title}</p>
      {children && <p className="mt-1.5 text-sm text-graphite">{children}</p>}
    </div>
  );
}

// Primary / quiet action buttons, shared across the app.
export function buttonClass(variant: "primary" | "quiet" = "primary"): string {
  const base =
    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  return variant === "primary"
    ? `${base} bg-spine text-paper-raised hover:bg-spine-deep`
    : `${base} border border-hairline bg-paper-raised text-ink hover:bg-paper-sunk`;
}

export const fieldClass =
  "mt-1.5 w-full rounded-md border border-hairline bg-paper px-3 py-2 text-sm text-ink placeholder:text-graphite focus:border-spine focus:outline-none";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">{label}</span>
      {children}
    </label>
  );
}
