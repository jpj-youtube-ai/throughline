import { getDb } from "@/db/client";
import { reviewWhyQuality, type GradedRationale } from "@/quality/review";
import { Card, Pill, Empty, buttonClass, type Tone } from "@/components/ui";

function scoreTone(score: number): Tone {
  if (score >= 75) return "shipped";
  if (score >= 50) return "planned";
  return "risk";
}

export async function WhyQualityPanel({ run }: { run?: string }) {
  // Cheap until asked: the LLM pass only runs on ?run=1.
  if (run !== "1") {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <p className="max-w-prose text-sm text-graphite">
          Runs an AI pass over every recorded rationale and scores it. Costs tokens, so it runs only when you ask.
        </p>
        <a href="/why-quality?run=1" className={buttonClass("primary")}>
          Run review
        </a>
      </Card>
    );
  }

  const review = await reviewWhyQuality(getDb());

  return (
    <>
      <div className="mb-4 flex justify-end">
        <a href="/why-quality?run=1" className={buttonClass("quiet")}>
          Re-run
        </a>
      </div>

      {!review.ok ? (
        <Card className="border-l-2 border-l-risk p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-risk">review failed</div>
          <p className="mt-2 text-sm text-ink-soft">{review.failure}</p>
          <a href="/why-quality?run=1" className={`${buttonClass("quiet")} mt-3`}>
            Try again
          </a>
        </Card>
      ) : review.count === 0 ? (
        <Empty title="No rationales to grade yet.">
          As decisions are recorded with their why, this grades the reasoning behind them.
        </Empty>
      ) : (
        <>
          <div className="mb-7 flex flex-wrap items-end gap-10">
            <div>
              <div className="font-display text-3xl font-bold text-ink">{review.average}</div>
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">average</div>
            </div>
            <div>
              <div className="font-display text-3xl font-bold text-ink">{review.count}</div>
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">rationales graded</div>
            </div>
          </div>
          <ul className="grid gap-3">
            {review.items.map((g) => (
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
          <p className="font-serif mt-1 text-[14px] italic leading-relaxed text-ink">"{g.rationale}"</p>
          <p className="mt-2 border-t border-hairline pt-2 text-[13px] text-graphite">{g.critique}</p>
        </div>
      </Card>
    </li>
  );
}
