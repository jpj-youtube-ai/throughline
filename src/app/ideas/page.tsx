import { getDb } from "@/db/client";
import { listVotingIdeas } from "@/ideas/queries";
import { APPROVAL_GATE } from "@/ideas/gate";

export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const ideas = await listVotingIdeas(getDb());
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
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
