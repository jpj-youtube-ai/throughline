import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";
import { createDb } from "../db/client";
import { materializeSpec } from "../spec/materialize";

async function main(): Promise<void> {
  loadDotenv();
  const { db, close } = createDb();
  try {
    const r = await materializeSpec(db);
    console.error(`[materialize] ${r.requirementCount} requirements → spec committed (${r.sha.slice(0, 7)})`);
  } finally {
    await close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[materialize] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
