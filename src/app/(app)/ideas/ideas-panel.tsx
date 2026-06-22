// src/app/(app)/ideas/ideas-panel.tsx
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { listVotingIdeas, idsUserVotedFor } from "@/ideas/queries";
import { APPROVAL_GATE } from "@/ideas/gate";
import { ideaDecay } from "@/ideas/decay";
import { listScratchIdeas } from "@/ideas/scratch";
import { Card, Pill, Empty, buttonClass } from "@/components/ui";
import { approve, promote } from "./actions";
import { activeProjectId } from "@/project/current";

export async function IdeasPanel() {
  const session = await auth();
  const db = getDb();
  const pid = await activeProjectId();
  const votedIds = session?.user?.id ? new Set(await idsUserVotedFor(db, session.user.id)) : new Set<string>();
  const scratch = session?.user?.id ? await listScratchIdeas(db, pid, session.user.id) : [];
  const now = Date.now();
  const ideas = (await listVotingIdeas(db, pid))
    .map((i) => ({ ...i, decay: ideaDecay(i.lastActivityAt, now) }))
    .sort((a, b) => b.decay.idleDays - a.decay.idleDays || b.voteCount - a.voteCount);

  return (
    <>
      {ideas.length === 0 ? (
        <Empty title="No ideas in voting.">Submit one to open it for the team&apos;s votes.</Empty>
      ) : (
        <ul className="grid gap-3">
          {ideas.map((i) => {
            const passed = i.voteCount >= APPROVAL_GATE;
            return (
              <li key={i.id}>
                <Card className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <strong className="font-display text-lg text-ink">{i.title}</strong>
                    <div className="flex shrink-0 items-center gap-2">
                      {i.decay.level === "stale" && <Pill tone="planned">stale {i.decay.idleDays}d</Pill>}
                      {i.decay.level === "quiet" && <Pill tone="neutral" dot={false}>quiet {i.decay.idleDays}d</Pill>}
                      <Pill tone={passed ? "shipped" : "neutral"} dot={!passed}>{i.voteCount} / {APPROVAL_GATE} approvals</Pill>
                    </div>
                  </div>
                  <div className="mt-1 font-mono text-xs text-graphite">
                    by {i.authorLogin}
                    {i.feasibility != null && ` · feasibility ${i.feasibility}`}
                    {i.viability != null && ` · viability ${i.viability}`}
                  </div>
                  <p className="font-serif mt-3 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-soft">{i.why}</p>
                  <div className="mt-3 border-t border-hairline pt-3 text-sm">
                    {!session?.user?.id ? (
                      <span className="text-graphite">Sign in to vote.</span>
                    ) : votedIds.has(i.id) ? (
                      <Pill tone="shipped">you approved this</Pill>
                    ) : (
                      <form action={approve}>
                        <input type="hidden" name="ideaId" value={i.id} />
                        <button type="submit" className={buttonClass("primary")}>Approve</button>
                      </form>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {scratch.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex items-center gap-2.5">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">Scratch · yours</h2>
            <span className="font-mono text-[11px] text-graphite">{scratch.length}</span>
            <div className="h-px flex-1 bg-hairline" />
          </div>
          <ul className="grid gap-2">
            {scratch.map((s) => (
              <li key={s.id}>
                <Card className="flex items-center gap-3 border-dashed p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-ink">{s.title}</div>
                    {s.why && <div className="truncate text-[13px] text-graphite">{s.why}</div>}
                  </div>
                  <form action={promote} className="shrink-0">
                    <input type="hidden" name="ideaId" value={s.id} />
                    <button type="submit" className={buttonClass("quiet")}>Submit for voting</button>
                  </form>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
