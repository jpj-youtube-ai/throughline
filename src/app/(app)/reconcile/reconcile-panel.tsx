import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { project } from "@/db/schema";
import { activeProjectId } from "@/project/current";
import { reconcileStructural } from "@/integrity/reconcile";
import { Card, Pill, buttonClass } from "@/components/ui";
import { rematerialize } from "./actions";

export async function ReconcilePanel() {
  const db = getDb();
  const pid = await activeProjectId();
  const [proj] = await db.select().from(project).where(eq(project.id, pid)).limit(1);
  if (!proj) {
    return <p className="text-sm text-graphite">No project bound yet (REQ-002).</p>;
  }

  const specFile = path.join(proj.localClonePath, proj.specPath);
  const current = fs.existsSync(specFile) ? fs.readFileSync(specFile, "utf8") : "";
  const r = await reconcileStructural(db, current, proj.id);

  return (
    <>
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
