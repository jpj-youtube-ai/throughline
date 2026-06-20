import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { listVotingIdeas, idsUserVotedFor } from "@/ideas/queries";
import { castVote } from "@/ideas/vote";
import { APPROVAL_GATE } from "@/ideas/gate";

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
  const ideas = await listVotingIdeas(db);
  const votedIds = session?.user?.id
    ? new Set(await idsUserVotedFor(db, session.user.id))
    : new Set<string>();

  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1>Ideas in voting</h1>
      <p>
        <a href="/ideas/new">+ Submit an idea</a>
      </p>
      {ideas.length === 0 ? (
        <p>No ideas in voting yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 16 }}>
          {ideas.map((i) => (
            <li key={i.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <strong>{i.title}</strong>
                <span style={{ whiteSpace: "nowrap", color: i.voteCount >= APPROVAL_GATE ? "#137333" : "#666" }}>
                  {i.voteCount} / {APPROVAL_GATE} approvals
                </span>
              </div>
              <small style={{ color: "#666" }}>
                by {i.authorLogin}
                {i.feasibility != null && ` · feasibility ${i.feasibility}`}
                {i.viability != null && ` · viability ${i.viability}`}
              </small>
              <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{i.why}</p>
              <div style={{ marginTop: 8 }}>
                {!session?.user?.id ? (
                  <small>
                    <a href="/">sign in</a> to vote
                  </small>
                ) : votedIds.has(i.id) ? (
                  <span style={{ color: "#137333" }}>✓ You approved this</span>
                ) : (
                  <form action={approve}>
                    <input type="hidden" name="ideaId" value={i.id} />
                    <button type="submit">Approve</button>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
