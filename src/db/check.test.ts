import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { schemaSql } from "./migrate";
import {
  introspectSchema,
  diffSchemas,
  hasDrift,
  type SchemaShape,
} from "./check";

function shape(tables: string[], columns: string[], enums: Record<string, string[]> = {}): SchemaShape {
  return {
    tables: new Set(tables),
    columns: new Set(columns),
    enums: new Map(Object.entries(enums).map(([k, v]) => [k, new Set(v)])),
  };
}

// A QueryFn backed by a throwaway PGlite seeded with `ddl`. Caller closes it.
async function pgliteQuery(ddl: string): Promise<{ query: (sql: string) => Promise<Record<string, unknown>[]>; close: () => Promise<void> }> {
  const client = new PGlite();
  await client.exec(ddl);
  return {
    query: async (sql) => (await client.query(sql)).rows as Record<string, unknown>[],
    close: () => client.close(),
  };
}

// schemaSql() with the latest migration omitted — a live DB one migration behind.
function staleSql(): string {
  const dir = path.resolve("drizzle");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const kept = files.slice(0, -1).map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
  const appendOnly = fs.readFileSync(path.resolve("src/db/append-only.sql"), "utf8");
  return [...kept, appendOnly].join("\n");
}

test("diffSchemas: identical shapes report no drift", () => {
  const s = shape(["t"], ["t.a", "t.b"], { mood: ["up", "down"] });
  const d = diffSchemas(s, s);
  assert.equal(hasDrift(d), false);
});

test("diffSchemas: a missing table is reported and its columns are not double-listed", () => {
  const canonical = shape(["t", "u"], ["t.a", "u.x", "u.y"]);
  const live = shape(["t"], ["t.a"]);
  const d = diffSchemas(canonical, live);
  assert.deepEqual(d.missingTables, ["u"]);
  assert.deepEqual(d.missingColumns, []); // u.x / u.y belong to the missing table u
  assert.equal(hasDrift(d), true);
});

test("diffSchemas: a missing column on an existing table is reported", () => {
  const canonical = shape(["t"], ["t.a", "t.b"]);
  const live = shape(["t"], ["t.a"]);
  const d = diffSchemas(canonical, live);
  assert.deepEqual(d.missingColumns, ["t.b"]);
});

test("diffSchemas: a missing enum type and a missing enum value are reported", () => {
  const canonical = shape(["t"], ["t.a"], { mood: ["up", "down"], color: ["red"] });
  const live = shape(["t"], ["t.a"], { mood: ["up"] });
  const d = diffSchemas(canonical, live);
  assert.deepEqual(d.missingEnums, ["color"]);
  assert.deepEqual(d.missingEnumValues, ["mood.down"]);
});

test("introspectSchema reads tables, columns, and enums from a live DB", async () => {
  const { query, close } = await pgliteQuery(
    "CREATE TYPE mood AS ENUM ('happy','sad'); CREATE TABLE foo (id integer, name text, m mood);",
  );
  try {
    const s = await introspectSchema(query);
    assert.ok(s.tables.has("foo"));
    assert.ok(s.columns.has("foo.id") && s.columns.has("foo.name") && s.columns.has("foo.m"));
    assert.deepEqual([...(s.enums.get("mood") ?? [])].sort(), ["happy", "sad"]);
  } finally {
    await close();
  }
});

test("end-to-end: a DB one migration behind is detected as drift; a current DB is clean", async () => {
  const canonical = await pgliteQuery(schemaSql());
  const stale = await pgliteQuery(staleSql());
  try {
    const canonShape = await introspectSchema(canonical.query);
    const staleShape = await introspectSchema(stale.query);

    const behind = diffSchemas(canonShape, staleShape);
    assert.equal(hasDrift(behind), true, "a DB missing the latest migration must show drift");

    const current = diffSchemas(canonShape, canonShape);
    assert.equal(hasDrift(current), false, "a DB at the canonical schema must be clean");
  } finally {
    await canonical.close();
    await stale.close();
  }
});
