---
name: apply-migration
description: Generate a Drizzle migration from schema changes and hand-apply it to the live Postgres on :5434, then verify. Use whenever src/db/schema.ts changed, or a new drizzle/*.sql exists that has not reached the live DB. db:migrate is fresh-provision only — it does NOT apply incremental migrations, and PGlite tests never catch a missing apply.
disable-model-invocation: true
---

# Apply a migration to the live DB

The recurring Throughline footgun: a new Drizzle migration is generated but never reaches the live Postgres, because `npm run db:migrate` only provisions a fresh schema and the PGlite test suite uses an embedded DB. This skill closes that gap. **Always show the SQL and get the user's go-ahead before applying — this writes to the live database.**

## Live DB facts (from project memory; verify against `.env`)

- Docker container `throughline-pg` (postgres:16-alpine) on host port **5434**.
- Credentials: user `throughline`, password `throughline`, db `throughline`.
- `DATABASE_URL` in `.env` points at it.

## Steps

1. **Generate the migration** from the current schema:
   ```bash
   npm run db:generate
   ```
   This writes a new `drizzle/NNNN_*.sql` plus a `drizzle/meta/*` snapshot.

2. **Show the new SQL** to the user and read it yourself. Flag anything destructive (DROP COLUMN/TABLE, NOT NULL on existing data, type narrowing). Confirm the user wants it applied.

3. **Confirm the container is up:**
   ```bash
   docker ps --filter name=throughline-pg
   ```
   If it isn't running, start it before proceeding.

4. **Apply the new migration SQL** to the live DB (substitute the actual new file):
   ```bash
   docker exec -i throughline-pg psql -U throughline -d throughline < drizzle/NNNN_<name>.sql
   ```
   Apply only the *new* file(s), not the whole directory.

5. **Verify** the change landed — inspect the affected table:
   ```bash
   docker exec -i throughline-pg psql -U throughline -d throughline -c "\d+ <table>"
   ```
   (Or a targeted query confirming the new column/constraint exists.)

6. **Remind the user** to commit the migration: the `drizzle/NNNN_*.sql` file *and* its `drizzle/meta/*.json` snapshot belong in the same `[TASK-NNN]` change as the schema edit.

## Notes

- The append-only `events` trigger and constraints must survive any DDL — a column add is fine; never write a migration that mutates past event rows.
- If the worktree deploy is in use (`.claude/worktrees/...`), the live web server / worker read the same `DATABASE_URL`, so applying once is enough — but restart the worker if the change affects generation.
