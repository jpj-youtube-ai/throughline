# Idea photos → issues — design

**Date:** 2026-06-26
**Requirement:** **REQ-031 "Idea photos on issues"** (new — dev/commit convention key; same not-declared-in-a-live-project caveat as REQ-030).
**Task:** TASK-072.

## Problem

When submitting an idea, the user wants to attach **photos** (raster images — screenshots, sketches, references) and have them **transferred to the GitHub issues** generated from that idea, so whoever (Claude Code or a person) works an issue sees the visual context.

Today an idea carries only `title / why / feasibility / viability`. Tasks generated from an idea already carry `origin_idea_id`, so an issue can always trace back to its idea — that is the link this feature rides.

## Decisions (settled in brainstorming)

- **Role:** issue **attachment only** — the photos are NOT fed to task generation (the model does not see them). Matches "transferred to the issue."
- **Scope:** **every** issue generated from the idea carries the idea's photos (no per-task relevance signal, since the model isn't involved).
- **Mechanism:** store the image bytes; serve them from a **public** Throughline route; embed an inline markdown image (`![](url)`) in the issue body. Raster images carry no XSS risk (unlike the raw HTML the prototype feature stopped serving), so a public image route is safe — same pattern as the existing `/preview/<id>.png`.
- **Limits:** max **8** photos per idea; accepted types **PNG, JPEG, WebP, GIF**.

## Design

### 1. Data model
- New **`idea_photos`** table: `id uuid pk`, `idea_id uuid NOT NULL → ideas.id ON DELETE CASCADE`, `image bytea NOT NULL`, `media_type text NOT NULL` (one of `image/png|image/jpeg|image/webp|image/gif`), `created_at timestamptz default now`. Multiple rows per idea.
- **No new event type.** Photo rows are inserted in the **same transaction** as the idea insert and the existing `idea.submitted` event (photos are submission content, like `why`). The `idea.submitted` payload gains `photo_count`.

### 2. Upload UI + submit
- `submitIdea`'s input gains `photos?: { mediaType: string; data: Buffer }[]`. Inside its existing `db.transaction`, after inserting the idea (and before/with the event), it inserts the photo rows for `row.id`. The `idea.submitted` payload includes `photo_count: photos.length`.
- The **"new idea" form** (`src/app/(app)/ideas/new/…`) gets a multi-file image input: `type="file" name="photos" accept="image/png,image/jpeg,image/webp,image/gif" multiple`.
- The submit **server action** reads `formData.getAll("photos")`, filters to `File`s with size > 0, validates: at most **8**; each an accepted image type (by `file.type`); converts each to `{ mediaType: file.type, data: Buffer.from(await file.arrayBuffer()) }`; passes them to `submitIdea`. On a validation failure it returns a clear error (over-count / wrong type) — mirrors the prototype upload guard. The 30 MB server-action `bodySizeLimit` (TASK-070) covers the upload.

### 3. Public serve route
- **`src/app/idea-photo/[id]/route.ts`** — `GET` returns the photo's bytes with `Content-Type: <media_type>` and an immutable cache header; 404 when absent (mirrors `src/app/preview/[id]/route.ts`). `force-dynamic`. A `getIdeaPhoto(db, id): Promise<{ image: Buffer; mediaType: string } | null>` reader (uuid-guarded, like `getPreviewPng`).
- **Auth-exempt:** the route must be reachable **unauthenticated** so GitHub's image proxy (Camo) can fetch it. Add `/idea-photo` to the same public-path allowlist that exempts `/preview` (find how `/preview` is exempted — middleware or auth config — and mirror it).

### 4. Issue transfer
- `createIssuesForTasks`: ensure the pending-tasks select includes `originIdeaId`. For each task with a non-null `originIdeaId`, load that idea's photos (`loadIdeaPhotos(db, ideaId): Promise<{ id: string }[]>`, idea-scoped, newest-first) — **memoized per idea** within the call so N tasks from one idea don't re-query. When `baseUrl` is set and the idea has photos, append:
  ```
  ## Attached photos
  ![photo](BASE_URL/idea-photo/<id>)
  ![photo](BASE_URL/idea-photo/<id>)
  ```
  one image line per photo. Tasks with no `originIdeaId` or an idea with no photos get nothing. Reuses the existing `baseUrl` dep (the same one the design-prototype links used).

### 5. Truth model
- Photo rows written in the `submitIdea` transaction (same tx as `idea.submitted`) — no new event type (REQ-003). No `github_status` write. The issue section only appends to the issue **body**. The serve route is read-only. LLM not involved. No `any` in domain code.

## Data flow

new-idea form (title + why + photos) → submit action (validate + buffers) → `submitIdea` writes idea + `idea_photos` + `idea.submitted` (one tx) → idea approved → generation makes tasks (each with `origin_idea_id`) → worker `createIssuesForTasks` appends an "## Attached photos" section with `![](BASE_URL/idea-photo/<id>)` → GitHub's proxy fetches the public route and renders the photos inline on every issue from the idea.

## Testing
- **Unit (TDD):** `submitIdea` writes the photo rows + `idea.submitted` (with `photo_count`) in one tx; `loadIdeaPhotos` (idea-scoped, ids); `getIdeaPhoto` (bytes + media type, uuid-guard → null); `createIssuesForTasks` includes the "## Attached photos" section with the right `/idea-photo/<id>` URLs for a task whose origin idea has photos, and omits it when the idea has none / the task has no origin idea; the per-idea memoization (two tasks, one idea → one photo query).
- **Non-unit:** the new-idea form upload + the serve route + the auth-exempt path — typecheck/build/runtime.
- **event-integrity review** (touches idea submission + issue creation + schema).
- **Migration** (`idea_photos`) hand-applied to live DB. **New REQ-031.** Deploy: **worker + web** (issue creation runs in the worker; the form/route/serve are web).

## Edge cases
- Idea with no photos → no `idea_photos` rows, no issue section (today's behavior). 
- More than 8 photos / a non-image file → the submit action rejects with a clear message before writing anything.
- An idea deleted → `ON DELETE CASCADE` removes its photos (ideas aren't deleted today, but the FK keeps it clean).
- `baseUrl` unset (no public host configured) → the section is omitted (same guard the prototype links used), so issues never carry a dead image link.
- A scratch idea promoted to voting later → photos were attached at submit; unaffected.
