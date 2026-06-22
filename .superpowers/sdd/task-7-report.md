# Task 7 Report — Finalize: NOT NULL, per-project key uniques, required emitEvent.projectId

## Files modified

**Schema:**
- `src/db/schema.ts` — added `.notNull()` to `projectId` on requirements, ideas, tasks, events, narratives; dropped `.unique()` on `requirements.key` and `tasks.key`; added table-level composites `requirements_project_key_unique(project_id, key)` and `tasks_project_key_unique(project_id, key)`.
- `src/db/events.ts` — `EmitEventInput.projectId` changed from `string?` to `string`; insert drops `?? null`.

**Migration:**
- `drizzle/0005_hesitant_norman_osborn.sql` — drops `requirements_key_unique` + `tasks_key_unique`; SET NOT NULL on 5 columns; adds the two composite uniques. Replays correctly after 0004's backfill.

**Source callers fixed for required projectId:**
- `src/genesis/import.ts` — `importGenesisSpec(db, specText, filename, projectId: string)` now requires a real projectId; `main()` resolves it via `getActiveProjectId(db, null)`.
- `src/spec/materialize.ts` — removed `.catch(() => undefined)` from `getActiveProjectId`; throws if no project.
- `src/narrative/materialize.ts` — same pattern.
- `src/drift/flag.ts` — `resolveDrift` throws if `flaggedTask.projectId` is null; both `requirement.declared` and `drift.resolved` emitEvent calls now pass `projectId`.
- `src/work/retroactive.ts` — resolves `projectId` from the task row (falls back to oldest project); passes it to emitEvent.
- `src/project/bind.ts` — `project.bound` emitEvent now passes `projectId: row.id`.
- `src/requirements/declare.ts` — throws if project not found; passes `projectId: string` to emitEvent.
- `src/app/(app)/spec/actions.ts` — resolves `getActiveProjectId` before calling `importGenesisSpec`.

**Test files updated** (seeded a project row + pass projectId to all inserts/emitEvent):
- `src/db/events.test.ts`, `src/digest/queries.test.ts`, `src/digest/send.test.ts`, `src/events/feed.test.ts`, `src/generation/orchestrate-requirement.test.ts`, `src/generation/persist-requirement.test.ts`, `src/generation/persist.test.ts`, `src/spec/materialize.test.ts`, `src/tasks/claim.test.ts`, `src/work/retroactive.test.ts`, `src/requirements/lifecycle.test.ts`

**New test:**
- `src/db/multiproject-schema.test.ts` — added `"REQ/TASK keys are unique per project, not globally"` test (failed before migration, passes after).

## Results

- Full suite: **122 pass / 0 fail**
- `npm run typecheck`: clean (0 errors)
- `npm run build`: succeeded
- Migration filename: `drizzle/0005_hesitant_norman_osborn.sql`

## Concerns

None. The backfill in 0004 ensures all existing rows have `project_id` set before 0005 enforces NOT NULL. The per-project unique constraints replace the previous global uniques cleanly.
