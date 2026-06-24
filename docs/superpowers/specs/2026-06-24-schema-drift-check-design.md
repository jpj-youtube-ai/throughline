# Schema drift check + worker boot guard — design

**Date:** 2026-06-24
**Status:** approved (brainstorming), pending implementation
**Layer:** dev/ops tooling — **no product REQ** (infrastructure, like the `apply-migration` skill and the
test harness). Lands as a `chore(db):` commit, matching the existing `chore(claude):` precedent — *not* a
`[TASK-NNN]` (forcing a REQ link would invent one). User-approved framing.

## Problem

The recurring Throughline footgun (documented in the `apply-migration` skill and project memory): a new
Drizzle migration is generated (`npm run db:generate` → `drizzle/NNNN_*.sql`) but never reaches the live
Postgres, and **nothing catches the gap**:

- `npm run db:migrate` applies the *entire* `schemaSql()` with bare `CREATE TABLE/TYPE` (no
  `IF NOT EXISTS`, no applied-migration tracking) — it's a fresh-provision script that *fails* on an
  already-provisioned DB. So migrations are hand-applied via the `apply-migration` skill (one new file at
  a time, into the Docker `throughline-pg` on :5434).
- The PGlite test DB (`createTestDb`) rebuilds from the full `schemaSql()` every run, so it *always* has
  the newest column → green tests + clean build give false confidence.
- **Symptom:** the running app/worker throws `column "<x>" of relation "<table>" does not exist` at
  runtime, only after deploy (hit on TASK-040's `tasks.branch_created_at`).

The `apply-migration` skill handles *applying*. What's missing is anything that **detects** a migration
you forgot to apply and **fails loudly and early** instead of at the first user request.

## Goals

- Convert the silent runtime failure into a loud, early one: a read-only check that reports exactly which
  tables/columns/enums the live DB is missing relative to the code's schema, and exits non-zero.
- A `npm run db:check` command for use after a schema task / before deploy.
- A worker **boot guard**: the worker refuses to start (fail-fast) when the live DB is behind.

## Non-goals

- **Not** a migrator. This does not write to the live DB or apply anything — the `apply-migration` skill
  still does that. (The root-cause fix — a tracked/idempotent incremental migrator — is a deliberate
  *separate* follow-up; out of scope here, per the chosen staged approach.)
- **No column-type comparison.** Presence-only (table/column/enum/enum-value existence). Comparing types
  across PGlite and real Postgres invites format false-positives, and the footgun is always a *missing*
  object, never a subtly-typed one.
- Web-app boot is **not** guarded (no single clean boot hook; would need a cached one-time check). Worker
  guard + manual command only. (Can be revisited later.)
- No truth-model surface: no events, schema change, `github_status`, or generation. No
  `event-integrity-reviewer` pass needed (read-only introspection + a boot guard).

## Design

### 1. The check — `src/db/check.ts` (new)

Read-only. **Canonical** (what the code expects) vs **live** (what's in the DB), introspected the same
way, then diffed.

```ts
export interface SchemaShape {
  tables: Set<string>;             // public base tables
  columns: Set<string>;            // "table.column"
  enums: Map<string, Set<string>>; // enum typname -> labels
}
export interface SchemaDrift {
  missingTables: string[];
  missingColumns: string[];        // "table.column" (excludes columns of a missing table)
  missingEnums: string[];
  missingEnumValues: string[];     // "enum.value"
}
type QueryFn = (sql: string) => Promise<Record<string, unknown>[]>;

export async function introspectSchema(query: QueryFn): Promise<SchemaShape>;
export function diffSchemas(canonical: SchemaShape, live: SchemaShape): SchemaDrift;
export function hasDrift(d: SchemaDrift): boolean;
export function formatDrift(d: SchemaDrift): string;
export async function checkLiveSchema(databaseUrl?: string): Promise<SchemaDrift>;
```

- Introspection SQL (standard, works on PGlite and Postgres):
  - tables: `information_schema.tables` where `table_schema='public' AND table_type='BASE TABLE'`
  - columns: `information_schema.columns` where `table_schema='public'`
  - enums: `pg_type`/`pg_enum`/`pg_namespace` where `nspname='public'`
- **Canonical** = a throwaway `PGlite` with `schemaSql()` exec'd, then `introspectSchema`. Closed after.
- **Live** = a `pg` `Pool` on `DATABASE_URL` (throws a clear error if unset), then `introspectSchema`.
  Pool ended in `finally`.
- `diffSchemas` = items in canonical **missing** from live. Columns whose table is already in
  `missingTables` are not re-listed. Extra objects in live (e.g. `__drizzle_migrations`) are ignored.

### 2. `npm run db:check` — `src/db/check.ts` `main()`

`loadDotenv()` → `checkLiveSchema()`; on `hasDrift` print `formatDrift(...)` + "apply with the
apply-migration skill, then re-run", `process.exit(1)`; else log "live DB schema is up to date ✓".
Same `isMain` guard pattern as `src/db/migrate.ts`. Add script: `"db:check": "tsx src/db/check.ts"`.

### 3. Worker boot guard — `src/worker/index.ts` `main()`

Right after `loadDotenv()`, before `createDb()`/the loop:
```ts
const drift = await checkLiveSchema();
if (hasDrift(drift)) {
  console.error(formatDrift(drift));
  console.error("[worker] refusing to start — apply pending migration(s) (apply-migration skill), then restart.");
  process.exit(1);
}
```
Only in `main()` (the boot path) — `tick`/`tickForProject` (the tested functions) are untouched, so no
test breakage; the `isMain` guard already keeps `main()` from running on import.

## Error handling

- `checkLiveSchema` throws on missing `DATABASE_URL` or a connection failure → CLI/worker `catch` prints
  the message and exits non-zero (fail closed: if we can't verify, don't silently proceed).
- The check never writes; a false "no drift" is impossible for *missing* objects (presence is exact).

## Testing (TDD) — `src/db/check.test.ts` (new, registered in `package.json`)

- `diffSchemas` (pure): identical → no drift; missing table → reported, its columns **not**
  double-listed; missing column (table present) → reported; missing enum → reported; missing enum value
  (enum present) → reported.
- `introspectSchema` against a small known PGlite schema → expected `{tables,columns,enums}`.
- **End-to-end detector** (two PGlite DBs, no live Postgres):
  - canonical = introspect `PGlite(schemaSql())`.
  - stale = introspect `PGlite(`all `drizzle/*.sql` **except the last file** + `append-only.sql`)` — a
    valid migration prefix simulating a live DB one migration behind.
  - `diffSchemas(canonical, stale)` → `hasDrift` true and non-empty; `diffSchemas(canonical, canonical)`
    → no drift.
- Existing `src/worker/worker.test.ts` exercises `tick`, not `main()` → unaffected (confirm in verify).

## Ops / dogfood

- Branch `chore-db-schema-check`; commit `chore(db): schema drift check + worker boot guard`. No REQ,
  no migration, no SPEC.md/materialize.
- Verify `npm test` / `npm run typecheck` / `npm run build`. Optionally run `npm run db:check` against the
  live :5434 DB to confirm it reports cleanly on a current DB (real-Postgres validation of the
  introspection, which the PGlite tests can't cover).
- Follow-up (noted, not built): harden `db:migrate` into a tracked, idempotent incremental migrator
  (baseline the 12 already-applied migrations) to remove the manual apply step entirely.

## Files touched

- `src/db/check.ts` (new) · `src/db/check.test.ts` (new)
- `src/worker/index.ts` (boot guard in `main()`)
- `package.json` (`db:check` script + register the test)
