import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { listTasks } from "@/tasks/queries";
import { Card, Pill, Empty, buttonClass, type Tone } from "@/components/ui";
import { unclaim } from "./actions";
import { ClaimButton } from "./claim-button";
import { activeProjectId } from "@/project/current";

const RISK_TONE: Record<string, Tone> = { low: "shipped", med: "planned", high: "risk" };

export async function TasksPanel() {
  const session = await auth();
  const pid = await activeProjectId();
  const tasks = await listTasks(getDb(), pid);

  return (
    <>
      {tasks.length === 0 ? (
        <Empty title="No tasks yet.">They appear once an approved idea is generated into spec-linked work.</Empty>
      ) : (
        <ul className="grid gap-3">
          {tasks.map((t) => (
            <li key={t.id}>
              <Card
                className="p-4"
                accent={
                  t.githubStatus === "closed" ? "shipped" : t.claimState === "claimed" ? "active" : undefined
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-mono text-sm text-spine-deep">{t.key}</span>
                    <span className="ml-2 text-ink">{t.title}</span>
                  </div>
                  <a href={`/spec#${t.requirementKey}`} className="shrink-0">
                    <Pill tone="spine" dot={false}>
                      {t.requirementKey}
                    </Pill>
                  </a>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Pill tone="neutral" dot={false}>
                    effort {t.effort}
                  </Pill>
                  <Pill tone={RISK_TONE[t.risk] ?? "neutral"}>risk {t.risk}</Pill>
                  <Pill tone="neutral" dot={false}>
                    confidence {t.confidence}
                  </Pill>
                  <Pill tone={t.githubStatus === "closed" ? "shipped" : "neutral"}>{t.githubStatus}</Pill>
                  {t.githubIssueUrl && (
                    <a
                      href={t.githubIssueUrl}
                      className="font-mono text-xs text-graphite underline decoration-hairline underline-offset-2 hover:text-ink"
                    >
                      issue ↗
                    </a>
                  )}
                </div>

                <div className="mt-3 border-t border-hairline pt-3 text-sm">
                  {t.claimState === "claimed" ? (
                    <div className="flex flex-wrap items-center gap-2 text-graphite">
                      <span>
                        Claimed by <span className="font-medium text-ink">{t.claimerLogin}</span>
                      </span>
                      <code className="font-mono text-xs text-spine-deep">{t.branchName}</code>
                      {session?.user?.login && session.user.login === t.claimerLogin && (
                        <form action={unclaim} className="ml-auto">
                          <input type="hidden" name="taskId" value={t.id} />
                          <button type="submit" className={buttonClass("quiet")}>
                            Unclaim
                          </button>
                        </form>
                      )}
                    </div>
                  ) : session?.user?.id ? (
                    <ClaimButton taskId={t.id} />
                  ) : (
                    <span className="text-graphite">Sign in to claim.</span>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
