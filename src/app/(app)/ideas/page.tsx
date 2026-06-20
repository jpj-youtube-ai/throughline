import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { listVotingIdeas, idsUserVotedFor } from "@/ideas/queries";
import { castVote } from "@/ideas/vote";
import { APPROVAL_GATE } from "@/ideas/gate";
import { ideaDecay } from "@/ideas/decay";
import { PageHeader, Card, Pill, Empty, buttonClass } from "@/components/ui";

export const dynamic = "force-dynamic";

async function approve(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await castVote(getDb(), String(formData.get("ideaId")), session.user.id);
  revalidatePath("/ideas");
}

export default async function IdeasPage() {
  const session = await auth();
  const db = getDb();
  const votedIds = session?.user?.id ? new Set(await idsUserVotedFor(db, session.user.id)) : new Set<string>();

  // Decorate with decay and float the most-languishing ideas up (REQ-023).
  const now = Date.now();
  const ideas = (await listVotingIdeas(db))
    .map((i) => ({ ...i, decay: ideaDecay(i.lastActivityAt, now) }))
    .sort((a, b) => b.decay.idleDays - a.decay.idleDays || b.voteCount - a.voteCount);

  return (
    <>
      <PageHeader
        eyebrow="Intake"
        title="Ideas in voting"
        lede="Two approvals carry an idea through the gate. Ideas left untended drift to the top — vote them up or let them go."
      >
        <a href="/ideas/new" className={buttonClass("primary")}>
          Submit an idea
        </a>
      </PageHeader>

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
                      {i.decay.level === "quiet" && (
                        <Pill tone="neutral" dot={false}>
                          quiet {i.decay.idleDays}d
                        </Pill>
                      )}
                      <Pill tone={passed ? "shipped" : "neutral"} dot={!passed}>
                        {i.voteCount} / {APPROVAL_GATE} approvals
                      </Pill>
                    </div>
                  </div>
                  <div className="mt-1 font-mono text-xs text-graphite">
                    by {i.authorLogin}
                    {i.feasibility != null && ` · feasibility ${i.feasibility}`}
                    {i.viability != null && ` · viability ${i.viability}`}
                  </div>
                  <p className="font-serif mt-3 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-soft">
                    {i.why}
                  </p>
                  <div className="mt-3 border-t border-hairline pt-3 text-sm">
                    {!session?.user?.id ? (
                      <span className="text-graphite">Sign in to vote.</span>
                    ) : votedIds.has(i.id) ? (
                      <Pill tone="shipped">you approved this</Pill>
                    ) : (
                      <form action={approve}>
                        <input type="hidden" name="ideaId" value={i.id} />
                        <button type="submit" className={buttonClass("primary")}>
                          Approve
                        </button>
                      </form>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
