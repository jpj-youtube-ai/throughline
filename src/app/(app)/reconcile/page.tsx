import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { project } from "@/db/schema";
import { reconcileStructural } from "@/integrity/reconcile";
import { materializeSpec } from "@/spec/materialize";
import { PageHeader, Card, Pill, buttonClass } from "@/components/ui";

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
    return <PageHeader eyebrow="Integrity" title="Reconciliation" lede="No project bound yet (REQ-002)." />;
  }

  const specFile = path.join(proj.localClonePath, proj.specPath);
  const current = fs.existsSync(specFile) ? fs.readFileSync(specFile, "utf8") : "";
  const r = await reconcileStructural(db, current);

  return (
    <>
      <PageHeader
        eyebrow="Integrity"
        title="Reconciliation"
        lede="Does the spec still match the log and the code? Reconciliation reports divergence — it never rewrites the spec to match the code."
      />

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
              SPEC.md vs requirements
            </div>
            <div className="mt-2 flex items-center gap-2.5">
              <Pill tone={r.specStale ? "risk" : "shipped"}>{r.specStale ? "stale" : "up to date"}</Pill>
              <span className="text-sm text-graphite">{r.requirementCount} requirements</span>
            </div>
          </div>
          {r.specStale && (
            <form action={rematerialize}>
              <button type="submit" className={buttonClass("primary")}>
                Re-materialize SPEC.md
              </button>
            </form>
          )}
        </div>
      </Card>

      <p className="mt-5 max-w-prose text-sm text-graphite">
        For the code-level pass — features mapping to no requirement — run{" "}
        <code className="font-mono text-spine-deep">npm run reconcile</code>.
      </p>
    </>
  );
}
