import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";

// The full schema DDL: generated Drizzle migrations (tables/enums/constraints)
// followed by the append-only trigger. Used to provision both the prod database
// and ephemeral PGlite instances in tests.
export function schemaSql(): string {
  const dir = path.resolve("drizzle");
  const migrationFiles = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    : [];
  if (migrationFiles.length === 0) {
    throw new Error("No migrations found in ./drizzle — run `npm run db:generate` first.");
  }
  const migrations = migrationFiles.map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
  const appendOnly = fs.readFileSync(path.resolve("src/db/append-only.sql"), "utf8");
  return [...migrations, appendOnly].join("\n");
}

async function main(): Promise<void> {
  loadDotenv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — required to migrate the production database.");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(schemaSql());
    console.error("[migrate] schema applied to DATABASE_URL");
  } finally {
    await pool.end();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[migrate] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
