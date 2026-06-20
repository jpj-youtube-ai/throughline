import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { project } from "@/db/schema";
import { reconcileStructural } from "@/integrity/reconcile";
import { materializeSpec } from "@/spec/materialize";

export const dynamic = "force-dynamic";

async function rematerialize() {
  "use server";
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await materializeSpec(getDb());
  revalidatePath("/reconcile");
}

export default async function ReconcilePage() {
  const db = getDb();
  const [proj] = await db.select().from(project).limit(1);
  if (!proj) {
    return (
      <main style={{ padding: 32 }}>
        <h1>Reconciliation</h1>
        <p>No project bound yet (REQ-002).</p>
      </main>
    );
  }

  const specFile = path.join(proj.localClonePath, proj.specPath);
  const current = fs.existsSync(specFile) ? fs.readFileSync(specFile, "utf8") : "";
  const r = await reconcileStructural(db, current);

  return (
    <main style={{ padding: 32, maxWidth: 720 }}>
      <h1>Reconciliation</h1>
      <p>
        Spec ({r.requirementCount} requirements):{" "}
        {r.specStale ? (
          <strong style={{ color: "#d33" }}>STALE — SPEC.md does not match the requirements</strong>
        ) : (
          <strong style={{ color: "#137333" }}>up to date</strong>
        )}
      </p>
      {r.specStale && (
        <form action={rematerialize}>
          <button type="submit">Re-materialize SPEC.md</button>
        </form>
      )}
      <p style={{ color: "#666", marginTop: 24 }}>
        For the code-level pass (features mapping to no requirement), run <code>npm run reconcile</code>.
        Reconciliation only reports — it never rewrites the spec to match the code.
      </p>
    </main>
  );
}
