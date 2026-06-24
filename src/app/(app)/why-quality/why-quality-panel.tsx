"use client";

import { useActionState } from "react";
import { runWhyReview, type ReviewState } from "./actions";
import { Card, Pill, Empty, buttonClass, type Tone } from "@/components/ui";
import type { GradedRationale } from "@/quality/review";

function scoreTone(score: number): Tone {
  if (score >= 75) return "shipped";
  if (score >= 50) return "planned";
  return "risk";
}

export function WhyQualityPanel() {
  const [state, action, pending] = useActionState<ReviewState, FormData>(runWhyReview, null);

  return (
    <>
      <form action={action} className="mb-5">
        <button type="submit" disabled={pending} className={buttonClass(state ? "quiet" : "primary")}>
          {pending ? "Running…" : state ? "Re-run" : "Run review"}
        </button>
        {!state && !pending && (
          <p className="mt-2 max-w-prose text-sm text-graphite">
            Runs an AI pass over every recorded rationale and scores it. Costs tokens, so it runs only when you ask.
          </p>
        )}
      </form>

      {pending && (
        <Card className="flex items-center gap-3 p-5">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-hairline border-t-spine" />
          <p className="text-sm text-graphite">Running the review — grading each recorded rationale…</p>
        </Card>
      )}

      {!pending && state?.ok === false && (
        <Card className="border-l-2 border-l-risk p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-risk">review failed</div>
          <p className="mt-2 text-sm text-ink-soft">{state.failure}</p>
        </Card>
      )}

      {!pending && state?.ok === true && state.count === 0 && (
        <Empty title="No rationales to grade yet.">
          As decisions are recorded with their why, this grades the reasoning behind them.
        </Empty>
      )}

      {!pending && state?.ok === true && state.count > 0 && (
        <>
          <div className="mb-7 flex flex-wrap items-end gap-10">
            <div>
              <div className="font-display text-3xl font-bold text-ink">{state.average}</div>
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">average</div>
            </div>
            <div>
              <div className="font-display text-3xl font-bold text-ink">{state.count}</div>
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">rationales graded</div>
            </div>
          </div>
          <ul className="grid gap-3">
            {state.items.map((g) => (
              <RationaleCard key={g.id} g={g} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function RationaleCard({ g }: { g: GradedRationale }) {
  return (
    <li>
      <Card className="flex items-start gap-4 p-4">
        <div className="flex w-12 shrink-0 flex-col items-center">
          <span className="font-display text-2xl font-bold text-spine-deep">{g.score}</span>
          <Pill tone={scoreTone(g.score)} dot={false}>
            {g.score >= 75 ? "strong" : g.score >= 50 ? "fair" : "thin"}
          </Pill>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] text-graphite">
            {g.kind}
            {g.subject ? ` · ${g.subject}` : ""}
          </div>
          <p className="font-serif mt-1 text-[14px] italic leading-relaxed text-ink">&ldquo;{g.rationale}&rdquo;</p>
          <p className="mt-2 border-t border-hairline pt-2 text-[13px] text-graphite">{g.critique}</p>
        </div>
      </Card>
    </li>
  );
}
