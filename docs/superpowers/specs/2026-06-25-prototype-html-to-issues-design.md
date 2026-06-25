# HTML prototypes → frontend issues — design

**Date:** 2026-06-25
**Requirement:** REQ-030 (Design prototype context) — redesign, no new REQ.
**Task series:** TASK-071.
**Supersedes:** the image side of the original prototype design (`2026-06-25-design-prototype-library-design.md`) and the per-repo UI (`2026-06-25-per-repo-prototypes-design.md` stays — per-repo management is unchanged).

## Problem

The shipped prototype feature renders each uploaded HTML prototype to a **PNG**, feeds the PNG to generation as a vision image, and links the PNG into the **"Design references" section of *every* issue** in the project. The user wants instead:

1. **Keep the HTML page** — not an image. Drop the PNG pipeline entirely.
2. **Attach the prototype to the GitHub issues that require frontend work** — not image-link it onto all issues.

The system has **no "frontend" signal** on a task today (a generated task carries `title / requirement_key / pointers / acceptance_check / effort / risk / confidence` only), so that signal must be introduced.

## Decisions (settled in brainstorming)

- **Attachment form:** commit the prototype **HTML into the repo on the task's branch**; the issue references the path. (Most useful for the coding agent; no XSS surface; design refs live in the repo.)
- **Frontend signal:** the **model flags it at generation** — it marks each task with the prototype(s) it builds against; a task with prototype(s) *is* a frontend task. This also matches the right prototype to the right task.
- **Image:** **dropped entirely.** Generation works from prototype **labels** (text), not vision. The trade-off — match quality now depends on descriptive labels — is accepted.
- The committed `prototypes/<slug>.html` **merges to `master`** with the task's PR (permanent design-reference files in the repo).

## Design

### 1. Data model
- **Drop the `prototypes.image` column** (it was only the PNG cache). Remaining: `id, project_id, label, html, created_at`. Destructive migration, hand-applied to the live DB (the cached PNGs are derived and unneeded).
- **New join table `task_prototypes`**: `(task_id uuid → tasks.id, prototype_id uuid → prototypes.id)`, composite PK, both FKs. Which prototype(s) a task builds against (many-to-many).

### 2. Generation — labels, not vision
- A new loader returns the project's prototypes as `{ id, label }[]` (no image).
- `orchestrate.ts` injects the **labels** into the generation prompt as text (e.g. a "Available design prototypes: …" block). The vision image blocks + image budget are removed.
- `TaskSchema` gains **`prototypes: z.array(z.string())`** — the label(s) from the offered list the task builds against; **empty = non-frontend**.
- `semanticErrors` is given the offered label set and **rejects any `prototypes` label not offered** (→ corrective retry), so no garbage links are persisted. (Empty array is always valid.)
- `SYSTEM_PROMPT`: replace the screenshot-grounding rule with — *"You may be given design prototypes by label. For any task that builds one of those UIs, list the matching label(s) in the task's `prototypes` field; leave it empty otherwise."*
- **Persist:** in the same transaction that writes the tasks and emits the existing `tasks.generated` event, resolve each task's `prototypes` labels → prototype ids → insert `task_prototypes` rows. No new event type — the links are task content (like pointers), covered by `tasks.generated`. (Prototypes uploaded *after* generation apply to future generations only — acceptable, YAGNI.)
- **Label resolution & uniqueness:** labels are **not** enforced unique per project. A model-output label resolves to **every** project prototype with that exact label (deduped) — so if a user gives two prototypes the same label, both attach. The injected list dedupes labels, and `semanticErrors` validates against that exact-label set. (Keeps the model's interface human-readable; duplicate labels are a user choice, not an error.)

### 3. Issue + branch — the attachment
- **Issue body** (`createIssuesForTasks`): remove the PNG "Design references". For a task that has associated prototypes, add a **"## Design prototype"** section naming the label(s) and path: `` Build the UI to match the design prototype committed to this task's branch: `prototypes/<slug>.html`. `` Tasks without prototypes get nothing. (Requires the task→prototype associations; query `task_prototypes` for the pending tasks.)
- **Branch creation** (`createBranchesForClaimedTasks`): after the branch ref is created, for each associated prototype commit its HTML to **`prototypes/<slug>.html`** on that branch via a new `commitFileToBranch(installationId, repoFullName, branch, path, content, message)` helper over the GitHub **Contents API** (`PUT /repos/{owner}/{repo}/contents/{path}` with `branch`). Idempotent (skip if the file already exists with identical content). The kickoff comment notes the committed path. Feature-branch commit — branch protection only guards `main`, so protected-main repos (nbcc) are unaffected.
- **Slug:** derived from the label (lowercase, non-alphanumerics → `-`, trimmed). On collision within a task, suffix a short prototype-id fragment. `.html` extension.

### 4. Removed entirely
- `renderPrototypeImages` + `src/prototypes/render.ts` + `render.test.ts` + the worker render step + `WorkerDeps.renderPrototypes`.
- `src/app/prototype/[id]/route.ts` + `getPrototypePng` + `src/prototypes/serve.ts` + `serve.test.ts`.
- The vision image blocks in `run.ts` (`buildUserContent` image handling) + the `images` arg + the per-image budget in `orchestrate.ts`.
- The `prototypes.image` column.
- `/connect` **thumbnails + "rendering…" / "PNG pending" states** — the list becomes label + Remove only. `listProjectPrototypes` drops the `rendered` field.

### 5. `/connect` UI
Unchanged structure (per-repo blocks from TASK-069). The per-repo list just shows each prototype's **label** with a Remove button — no thumbnail, no render status. Upload still stores HTML.

## Data flow (new)

upload HTML (`/connect`, per repo) → stored in `prototypes` → **generation** loads labels, model marks frontend tasks with prototype labels → **persist** writes `task_prototypes` (in the `tasks.generated` tx) → **issue** gets a "Design prototype" section naming the label + path → task **claimed → branch created** → worker commits each associated prototype's HTML to `prototypes/<slug>.html` on the branch (Contents API) + kickoff comment → Claude Code builds the UI against the real HTML file → PR merges, the file lands on `master`.

## Truth model

- `prototype.added` / `prototype.removed` unchanged (in-tx). No new event types. The `task_prototypes` links are written in the same tx as `tasks.generated` (task content, like pointers).
- No `github_status` writes. The branch-side HTML commit is an external git op (Contents API), outside any DB tx, idempotent + best-effort — mirrors how branch creation and issue creation already work.
- LLM output still validated (`semanticErrors` now also validates prototype labels); no partial/garbage persist.
- No `any` in domain code.

## Testing

- **Unit (TDD):** `task_prototypes` round-trip; `loadProjectPrototypeLabels` (project-scoped, `{id,label}`); `TaskSchema.prototypes` + `semanticErrors` (valid labels pass, unknown label errors, empty ok); persist writes the join rows from labels in-tx; `slugify`; `createIssuesForTasks` emits the Design-prototype section only for tasks with prototypes (and omits it otherwise); `commitFileToBranch` (fake Contents client — commits/skips-on-identical); `createBranchesForClaimedTasks` commits associated prototypes on branch creation.
- **Removals:** delete the corresponding tests with the code.
- **Non-unit:** `/connect` cleanup (typecheck/build/runtime).
- **event-integrity review** (touches generation, persist, schema).
- **Migration** hand-applied to live DB (`DROP COLUMN image`, `CREATE TABLE task_prototypes`). **No new REQ.** Deploy: worker + web (generation, issues, branches, worker render-removal, /connect).

## Edge cases
- Project with no prototypes → labels block empty, model sets `prototypes: []` for all tasks, no issue sections, no branch commits (today's behavior for non-frontend). 
- A frontend task whose branch already has the file (idempotent re-run) → Contents API skip.
- Prototype removed after a task linked it → `task_prototypes` FK; deleting the prototype should cascade/clean the link (the remove path deletes the prototype; add `ON DELETE CASCADE` on `task_prototypes.prototype_id`, or delete links in `removePrototype`'s tx). Decision: `ON DELETE CASCADE` on both FKs (links are derived associations, not events).
- Label collision in slug → id-suffixed path.
