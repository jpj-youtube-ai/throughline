import { getDb } from "@/db/client";
import { listQuickWins } from "@/metrics/quickwins";
import { Card, Pill, Empty, type Tone } from "@/components/ui";

const RISK_TONE: Record<string, Tone> = { low: "shipped", med: "planned", high: "risk" };

function scoreTone(score: number): Tone {
  if (score >= 70) return "shipped";
  if (score >= 45) return "planned";
  return "neutral";
}

export async function QuickWinsPanel() {
  const wins = await listQuickWins(getDb());

  return (
    <>
      {wins.length === 0 ? (
        <Empty title="Nothing to surface.">
          When there are open, unclaimed tasks, the best ones to pick up next rise to the top here.
        </Empty>
      ) : (
        <ol className="grid grid-cols-1 gap-3">
          {wins.map((w, i) => (
            <li key={w.key}>
              <Card className="flex items-center gap-4 p-4">
                <div className="flex w-12 shrink-0 flex-col items-center">
                  <span className="font-display text-2xl font-bold text-spine-deep">{w.score}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-graphite">score</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-sm text-spine-deep">{w.key}</span>
                    {i === 0 && (
                      <Pill tone="spine" dot={false}>
                        best pickup
                      </Pill>
                    )}
                  </div>
                  <div className="truncate text-ink">{w.title}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <a href={`/spec#${w.requirementKey}`}>
                      <Pill tone="neutral" dot={false}>
                        {w.requirementKey}
                      </Pill>
                    </a>
                    <Pill tone={scoreTone(w.score)} dot={false}>
                      effort {w.effort}/5
                    </Pill>
                    <Pill tone={RISK_TONE[w.risk] ?? "neutral"}>risk {w.risk}</Pill>
                    <Pill tone="neutral" dot={false}>
                      confidence {w.confidence}
                    </Pill>
                  </div>
                </div>
                <a href="/tasks" className="shrink-0 self-center font-mono text-xs text-spine underline decoration-hairline underline-offset-2 hover:text-spine-deep">
                  claim →
                </a>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
