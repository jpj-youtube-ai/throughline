import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { listOpenDriftFlags } from "@/drift/queries";
import { resolveDrift, type DriftResolution } from "@/drift/flag";

export const dynamic = "force-dynamic";

async function resolve(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await resolveDrift(getDb(), {
    flagId: String(formData.get("flagId")),
    resolution: String(formData.get("resolution")) as DriftResolution,
    resolvedBy: session.user.id,
    rationale: String(formData.get("rationale") ?? ""),
    newReqTitle: String(formData.get("newReqTitle") ?? "") || undefined,
    relinkReqKey: String(formData.get("relinkReqKey") ?? "") || undefined,
  });
  revalidatePath("/drift");
}

export default async function DriftPage() {
  const flags = await listOpenDriftFlags(getDb());

  return (
    <main style={{ padding: 32, maxWidth: 760 }}>
      <h1>Drift</h1>
      <p style={{ color: "#666" }}>Work in a PR that maps to no requirement. Flagged, never auto-resolved.</p>
      {flags.length === 0 ? (
        <p>No open drift flags.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 20 }}>
          {flags.map((f) => (
            <li key={f.id} style={{ border: "1px solid #d33", borderRadius: 8, padding: 16 }}>
              <strong>{f.taskKey}</strong> · PR #{f.prNumber}
              <ul>
                {f.unmappedItems.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
              <form action={resolve} style={{ display: "grid", gap: 8, marginTop: 8 }}>
                <input type="hidden" name="flagId" value={f.id} />
                <textarea name="rationale" required rows={2} placeholder="Why — required" />
                <select name="resolution" defaultValue="out_of_scope">
                  <option value="out_of_scope">Out of scope (acknowledge)</option>
                  <option value="new_req">Declare a new requirement</option>
                  <option value="relink">Relink to a requirement</option>
                </select>
                <input name="newReqTitle" placeholder="New requirement title (for new_req)" />
                <input name="relinkReqKey" placeholder="REQ-NNN (for relink)" />
                <button type="submit" style={{ justifySelf: "start" }}>
                  Resolve
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
