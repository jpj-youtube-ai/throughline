---
name: declare-req
description: Declare a requirement outside the idea→vote and genesis paths (provenance=drift) and regenerate SPEC.md. Use for a requirement added deliberately beyond the imported spec — e.g. REQ-028 (Overview dashboard). This is the operator step that puts the requirement row in the DB and materializes the spec.
disable-model-invocation: true
---

# Declare a requirement (out-of-band) and materialize

Most requirements enter Throughline via genesis import or the idea→vote→gate path. When you deliberately add one beyond the original spec, declare it explicitly so its row exists, an event is emitted, and `SPEC.md` regenerates. Without this step a feature works in the app but shows as `planned` / missing from the spec map and reconcile views.

## Steps

1. **Declare it.** `declareRequirement` inserts the row and emits `requirement.declared` in one transaction; the key comes from `nextRequirementKey` (max existing REQ-NNN + 1).
   ```bash
   npx tsx src/cli/declare-req.ts \
     --title "<short title>" \
     --description "<one or two sentences>" \
     --provenance drift \
     --why "<why this exists, since it's not from the imported spec or a board vote>"
   ```
   Use `--provenance drift` for anything not imported and not board-voted (the enum is `imported | voted | drift`).

2. **Materialize the spec.**
   ```bash
   npm run materialize
   ```
   This regenerates `SPEC.md` from requirement events and commits it via the GitHub App. SPEC.md is a generated projection — never hand-edit it.

3. **Confirm.** The new `REQ-NNN` should appear in the `/spec` map; once a `[TASK-NNN]` for it merges, its status transitions off `planned` automatically.

## Known pending example

Project memory notes **REQ-028 (Overview dashboard)** may still be undeclared — the `/dashboard` feature shipped but the requirement row/materialize step was outstanding. If so, this is exactly the skill to run for it (title "Overview dashboard", provenance `drift`).
