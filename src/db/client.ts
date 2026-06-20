import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "./schema";
import { schemaSql } from "./migrate";

// One Db type across the app. Production uses node-postgres; tests/local use
// PGlite (embedded Postgres). The query/transaction API is identical, so the
// PGlite instance is structurally compatible with the node-postgres type.
export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

// Production database from DATABASE_URL.
export function createDb(): DbHandle {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool({ connectionString: url });
  return {
    db: drizzlePg(pool, { schema }) as Db,
    close: async () => {
      await pool.end();
    },
  };
}

// Ephemeral in-memory Postgres (PGlite) with the full schema applied — for tests
// and local experimentation, no external database required.
export async function createTestDb(): Promise<DbHandle> {
  const client = new PGlite();
  await client.exec(schemaSql());
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return {
    db,
    close: async () => {
      await client.close();
    },
  };
}
