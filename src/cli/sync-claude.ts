import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";
import { createDb } from "../db/client";
import { project } from "../db/schema";
import { syncClaudeMd } from "../integrity/claude-md";
import { commitFileInClone } from "../github/commit";

// Sync the Throughline managed block into the target repo's CLAUDE.md (REQ-014).
async function main(): Promise<void> {
  loadDotenv();
  const { db, close } = createDb();
  try {
    const [proj] = await db.select().from(project).limit(1);
    if (!proj) throw new Error("No project bound (REQ-002).");
    const file = path.join(proj.localClonePath, proj.claudeMdPath);
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const r = await syncClaudeMd(db, current, (content) =>
      commitFileInClone(proj.localClonePath, proj.claudeMdPath, content, "[claude_md] sync managed block"),
    );
    console.error(`[sync-claude] convention v${r.conventionVersion} written (${r.sha.slice(0, 7)})`);
  } finally {
    await close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[sync-claude] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
