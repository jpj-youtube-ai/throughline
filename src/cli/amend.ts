import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";
import { createDb } from "../db/client";
import { amendRequirement } from "../requirements/amend";

// Amend a requirement's definition (records requirement.amended):
//   npx tsx src/cli/amend.ts --key REQ-NNN --description "…" --why "…" [--title "…"]
async function main(): Promise<void> {
  loadDotenv();
  const { values } = parseArgs({
    options: {
      key: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      why: { type: "string" },
    },
  });
  if (!values.key || !values.description || !values.why) {
    throw new Error('Usage: npx tsx src/cli/amend.ts --key REQ-NNN --description "…" --why "…" [--title "…"]');
  }
  const { db, close } = createDb();
  try {
    const r = await amendRequirement(db, {
      key: values.key,
      title: values.title,
      description: values.description,
      why: values.why,
    });
    console.error(`[amend] ${r.key} amended.`);
  } finally {
    await close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[amend] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
