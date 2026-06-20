import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";
import { createDb } from "../db/client";
import { reconcile } from "../integrity/reconcile";

// Spec reconciliation (REQ-015): report divergences, never auto-apply.
async function main(): Promise<void> {
  loadDotenv();
  const { db, close } = createDb();
  try {
    const r = await reconcile(db);
    console.error(`[reconcile] spec: ${r.specStale ? "STALE (run materialize)" : "up to date"} (${r.requirementCount} reqs)`);
    if (r.codeReconciliation === "failed") {
      console.error(`[reconcile] code pass failed: ${r.codeFailure}`);
    } else if (r.unmappedCode.length === 0) {
      console.error("[reconcile] code: all mapped to a requirement.");
    } else {
      console.error(`[reconcile] code mapping to no requirement (${r.unmappedCode.length}):`);
      for (const c of r.unmappedCode) console.error(`  - ${c}`);
    }
  } finally {
    await close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[reconcile] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
