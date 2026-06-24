import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";
import { schemaSql } from "./migrate";

/**
 * Read-only schema drift check. Compares the CANONICAL schema (what the code
 * expects — the concatenation of all drizzle migrations, the same schemaSql()
 * the tests apply) against the LIVE database, and reports what the live DB is
 * missing. Turns the recurring "forgot to apply a migration" footgun — a silent
 * runtime `column does not exist` — into a loud, early failure (npm run db:check
 * and the worker boot guard). It never writes; applying migrations is still the
 * job of the apply-migration skill.
 */

export interface SchemaShape {
  tables: Set<string>; // public base tables
  columns: Set<string>; // "table.column"
  enums: Map<string, Set<string>>; // enum typname -> labels
}

export interface SchemaDrift {
  missingTables: string[];
  missingColumns: string[]; // "table.column" (excludes columns of an entirely-missing table)
  missingEnums: string[];
  missingEnumValues: string[]; // "enum.value"
}

export type QueryFn = (sql: string) => Promise<Record<string, unknown>[]>;

const TABLES_SQL =
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'";
const COLUMNS_SQL =
  "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'";
const ENUMS_SQL =
  "SELECT t.typname AS enum_name, e.enumlabel AS enum_value " +
  "FROM pg_type t " +
  "JOIN pg_enum e ON e.enumtypid = t.oid " +
  "JOIN pg_namespace n ON n.oid = t.typnamespace " +
  "WHERE n.nspname = 'public'";

/** Introspect a database (via any QueryFn) into a comparable SchemaShape. */
export async function introspectSchema(query: QueryFn): Promise<SchemaShape> {
  const tables = new Set<string>();
  for (const r of await query(TABLES_SQL)) tables.add(String(r.table_name));

  const columns = new Set<string>();
  for (const r of await query(COLUMNS_SQL)) columns.add(`${r.table_name}.${r.column_name}`);

  const enums = new Map<string, Set<string>>();
  for (const r of await query(ENUMS_SQL)) {
    const name = String(r.enum_name);
    let values = enums.get(name);
    if (!values) {
      values = new Set<string>();
      enums.set(name, values);
    }
    values.add(String(r.enum_value));
  }

  return { tables, columns, enums };
}

/** What the canonical schema has that `live` is missing. */
export function diffSchemas(canonical: SchemaShape, live: SchemaShape): SchemaDrift {
  const missingTables = [...canonical.tables].filter((t) => !live.tables.has(t)).sort();
  const missingTableSet = new Set(missingTables);

  const missingColumns = [...canonical.columns]
    .filter((c) => !live.columns.has(c))
    // Don't double-report every column of a table that's missing wholesale.
    .filter((c) => !missingTableSet.has(c.slice(0, c.indexOf("."))))
    .sort();

  const missingEnums: string[] = [];
  const missingEnumValues: string[] = [];
  for (const [name, values] of canonical.enums) {
    const liveValues = live.enums.get(name);
    if (!liveValues) {
      missingEnums.push(name);
      continue;
    }
    for (const v of values) if (!liveValues.has(v)) missingEnumValues.push(`${name}.${v}`);
  }

  return {
    missingTables,
    missingColumns,
    missingEnums: missingEnums.sort(),
    missingEnumValues: missingEnumValues.sort(),
  };
}

export function hasDrift(d: SchemaDrift): boolean {
  return (
    d.missingTables.length > 0 ||
    d.missingColumns.length > 0 ||
    d.missingEnums.length > 0 ||
    d.missingEnumValues.length > 0
  );
}

/** A human-readable report of what the live DB is missing. */
export function formatDrift(d: SchemaDrift): string {
  if (!hasDrift(d)) return "[db:check] live DB schema is up to date ✓";
  const lines = ["[db:check] live DB is behind the code's schema — a migration has not been applied:"];
  if (d.missingTables.length) lines.push(`  missing tables: ${d.missingTables.join(", ")}`);
  if (d.missingColumns.length) lines.push(`  missing columns: ${d.missingColumns.join(", ")}`);
  if (d.missingEnums.length) lines.push(`  missing enum types: ${d.missingEnums.join(", ")}`);
  if (d.missingEnumValues.length) lines.push(`  missing enum values: ${d.missingEnumValues.join(", ")}`);
  return lines.join("\n");
}

/**
 * Build the canonical SchemaShape from schemaSql() in a throwaway PGlite, then
 * introspect the live DATABASE_URL and diff. Read-only on the live DB.
 */
export async function checkLiveSchema(databaseUrl?: string): Promise<SchemaDrift> {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — required to check the live schema.");

  const { PGlite } = await import("@electric-sql/pglite");
  const canonicalClient = new PGlite();
  let canonical: SchemaShape;
  try {
    await canonicalClient.exec(schemaSql());
    canonical = await introspectSchema(async (sql) => (await canonicalClient.query(sql)).rows as Record<string, unknown>[]);
  } finally {
    await canonicalClient.close();
  }

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url });
  try {
    const live = await introspectSchema(async (sql) => (await pool.query(sql)).rows as Record<string, unknown>[]);
    return diffSchemas(canonical, live);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  loadDotenv();
  const drift = await checkLiveSchema();
  if (hasDrift(drift)) {
    console.error(formatDrift(drift));
    console.error("\nApply the pending migration(s) with the apply-migration skill, then re-run `npm run db:check`.");
    process.exit(1);
  }
  console.error("[db:check] live DB schema is up to date ✓");
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[db:check] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
