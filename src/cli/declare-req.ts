// src/cli/declare-req.ts
import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";
import { createDb } from "../db/client";
import { declareRequirement, type Provenance } from "../requirements/declare";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  loadDotenv();
  const title = arg("title");
  if (!title) throw new Error("Usage: declare-req --title <t> [--description <d>] [--provenance imported|voted|drift] [--why <w>]");
  const provenance = (arg("provenance") ?? "drift") as Provenance;
  const { db, close } = createDb();
  try {
    const r = await declareRequirement(db, {
      title,
      description: arg("description") ?? "",
      provenance,
      why: arg("why") ?? null,
    });
    console.error(`[declare-req] declared ${r.key} (${provenance})`);
  } finally {
    await close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[declare-req] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
