import { getDb } from "@/db/client";
import { listVotingIdeas } from "@/ideas/queries";

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
              <strong>{i.title}</strong> <small>by {i.authorLogin}</small>
              {(i.feasibility != null || i.viability != null) && (
                <small style={{ marginLeft: 8, color: "#666" }}>
                  feasibility {i.feasibility ?? "–"} · viability {i.viability ?? "–"}
                </small>
              )}
              <p style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{i.why}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
