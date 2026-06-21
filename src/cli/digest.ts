import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";
import { createDb } from "../db/client";
import { generateDigest } from "../digest/send";

// Generate the in-app digest (REQ-026): compose a summary of the decisions since
// the last digest and record digest.generated. The Digest page shows the result.
//   npm run digest
async function main(): Promise<void> {
  loadDotenv();
  const { db, close } = createDb();
  try {
    const r = await generateDigest(db);
    if (r.generated) console.error(`[digest] generated (${r.eventCount} decisions)\n\n${r.text}`);
    else console.error(`[digest] nothing recorded: ${r.reason ?? r.failure}`);
  } finally {
    await close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[digest] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
