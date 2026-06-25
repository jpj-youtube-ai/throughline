# Design-prototype library for task generation — design

**Date:** 2026-06-25
**Status:** Approved (design); pending implementation plan
**Layer:** Foundation `[1]` (generation context) + Surface `[3]` (upload UI). New requirement.

## Problem

A team has HTML prototypes / design mockups of the product's pages. Today nothing in Throughline knows about them, so generated tasks aren't grounded in the intended design, and the GitHub issues Claude Code works from don't point at the designs. The user wants to **upload the prototype pages**, have them **inform task generation**, and have generated **issues reference them**.

## Decisions (settled in brainstorming)

- **Project-level library** — prototypes are uploaded per project (operator-curated generation context, like `contextPins`), available to all of that project's task generation. Not per-idea/requirement.
- **Fed to generation as rendered screenshots (vision)** — render the prototype HTML→PNG and pass it as an image the model sees, *not* raw HTML (which is token-heavy, noisy, and blows the 40k generation budget). The SDK message format already accepts image blocks and the models (Sonnet/Opus) are vision-capable.
- **Issue "Design references" links** — each generated issue body gets a section linking to the project's prototype screenshots (served publicly, like the preview PNGs).
- **New requirement** — declared via the `declare-req` flow (provenance `drift`, like REQ-028), tentatively **REQ-030 "Design prototype context"**. Implementation tasks link to it. (Confirm the exact number at planning.)

## Architecture

### 1. Storage + truth model

New table **`prototypes`** (`src/db/schema.ts`):

```
prototypes:
  id          uuid pk
  project_id  uuid  FK -> project   (not null)
  label       text  (not null)      -- operator name, e.g. "Search results"
  html        text  (not null)      -- uploaded source
  image       bytea (nullable)      -- rendered-PNG cache (derived; regenerable)
  created_at  timestamptz
```

New event types **`prototype.added`** / **`prototype.removed`**, emitted **in the same transaction** as the insert/delete — the `contextPins` precedent (`setContextPins` emits `project.context_pins_changed` in-tx). The rendered `image` is a derived cache (no event when it's filled, mirroring `tasks.preview_image` and `requirements.diagram_html`). Needs a Drizzle migration, **hand-applied to the live DB**.

### 2. Upload + manage (board, on `/connect`)

A "Design prototypes" section on the project-settings page (`src/app/(app)/connect/page.tsx`), alongside `contextPins`:
- **`addPrototype`** server action — reads the uploaded HTML file + label, inserts the row + emits `prototype.added` (in tx), scoped to the active project. **No rendering on the request path.**
- **`removePrototype`** server action — deletes the row + emits `prototype.removed` (in tx).
- The section lists current prototypes (label + thumbnail from the served PNG) with a remove control.
Both auth-gated; mirror the existing pins action shape.

### 3. Rendering (worker sweep)

A new worker step **`renderPrototypeImages(db, projectId)`** in `tickForProject`: find the project's prototypes with `image IS NULL`, render `html`→PNG via the existing **`renderHtmlToPng`**, store the PNG. Best-effort + idempotent (skips already-rendered), in its own try/catch + log — mirroring how the worker renders task previews and the other sweeps. Keeps Puppeteer off the web request path; a freshly-uploaded prototype gets its PNG within a tick.

### 4. Generation context (the core)

- **`loadProjectPrototypes(db, projectId)`** (in the `src/prototypes/` module): returns the project's prototypes that have a rendered `image`, newest-first, capped at **6**, as `{ label, image: Buffer }[]`.
- **`orchestrate.ts`** (`generateForApprovedIdea` + `generateForRequirement`): load the prototype images and pass them to `generateTasks`; fold their token estimate (~1.5k each) into `fixed` so the repo slice shrinks to fit the 40k cap.
- **`run.ts` `generateTasks`**: accept `images?: { mediaType: string; data: string }[]`; build the first user message `content` as `[{ type: "text", text: userMessage }, ...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.data } }))]` instead of a bare string. (Vision input is orthogonal to the structured-output config — both work.)
- **`prompt.ts` `SYSTEM_PROMPT`**: add a rule — *"You may be given design-prototype screenshots of the product. Use them to ground each task's UI/UX pointers and acceptance checks in the actual intended design; don't invent UI that contradicts them."*

### 5. Issue "Design references"

- **`/prototype/[id]/route.ts`** — a public, `force-dynamic` GET serving the prototype's cached PNG (mirrors `/preview/[id]/route.ts` via a `getPrototypePng(db, id)` reader), so it embeds in a GitHub issue without auth (for Claude Code).
- **`createIssuesForTasks`** (`src/github/issues.ts`): if the project has prototypes, append a `## Design references` section to each issue body listing `- [label](PUBLIC_BASE_URL/prototype/<id>.png)`. Serving the **rendered PNG** (not the raw uploaded HTML) keeps the one public route XSS-safe and consistent with the preview embed.

## Truth-model constraints

- `prototype.added` / `prototype.removed` emitted **in the same tx** as the row insert/delete (state change ⇒ event, per `contextPins`).
- The rendered `image` is a **derived cache** — filled by the worker sweep with **no event** (precedent: `preview_image`, `diagram_html`).
- No `github_status` write; no spec/event-log changes beyond the two new event types.
- Generation stays read-only of prototypes; LLM output still validated/retried as today (images only change the input).

## Error handling

- Render sweep — best-effort: a render failure leaves `image` null (re-tried next tick), logged; never aborts the tick.
- Generation — skips prototypes without a rendered image (a just-uploaded one is fed once rendered, within a tick); a missing/oversized image never blocks generation.
- Issue references — only listed for prototypes that exist; an empty library adds no section.
- Upload — rejects a non-HTML / empty file with a typed error (like the genesis-import upload).

## Components

**New**
- `prototypes` table + migration; `prototype.added`/`prototype.removed` event types.
- `src/prototypes/*` (or `src/project/prototypes.ts`): `addPrototype`, `removePrototype`, `loadProjectPrototypes`, `getPrototypePng`, `renderPrototypeImages` (worker sweep).
- `/prototype/[id]/route.ts` (public PNG serve).
- `/connect` "Design prototypes" upload+list UI + its server actions.

**Modified**
- `src/db/schema.ts` (table); `src/db/events.ts` (event types, if enumerated).
- `src/generation/run.ts` (image content blocks); `src/generation/orchestrate.ts` (load + pass + budget); `src/prompt.ts` (SYSTEM_PROMPT rule).
- `src/worker/index.ts` (render sweep step + dep).
- `src/github/issues.ts` (Design references section).

## Testing

- `addPrototype`/`removePrototype`: insert/delete + the matching event in one tx; project-scoped.
- `renderPrototypeImages`: renders only null-image prototypes (injected fake `renderHtmlToPng`), stores the PNG, best-effort on failure, project-scoped.
- `loadProjectPrototypes`: returns rendered ones only, newest-first, capped at 6, scoped.
- `generateTasks`: builds image content blocks when `images` are passed; bare text when none.
- `SYSTEM_PROMPT`: contains the prototype-grounding rule.
- `createIssuesForTasks`: issue body includes the `## Design references` section (with the right URLs) when the project has prototypes, and omits it when none.
- Upload UI, the `/prototype/[id]` serve route, and a real generation-with-prototype run verified at runtime.

## Scope / phasing (for the plan)

1. **Schema + migration** — `prototypes` table + event types; apply to live DB.
2. **Prototype domain** — `addPrototype`/`removePrototype`/`loadProjectPrototypes`/`getPrototypePng` (+ tests).
3. **Render sweep** — `renderPrototypeImages` + worker wiring (+ tests).
4. **Generation** — image content blocks in `generateTasks`, load+pass+budget in `orchestrate`, `SYSTEM_PROMPT` rule (+ tests).
5. **Serve route + issue references** — `/prototype/[id]` + `createIssuesForTasks` Design references (+ tests).
6. **Upload UI** — `/connect` "Design prototypes" section + actions (Surface; impeccable/ui-ux-pro-max).
7. **Verify** — suite + typecheck + build; event-integrity; runtime walkthrough (upload → renders → generation uses it → issue links it).

## Requirement linkage

A **new requirement** — tentatively **REQ-030 "Design prototype context"** — declared via `npm run declare-req` (provenance `drift`) + materialize, like REQ-028. Implementation tasks link to it. Confirm the exact REQ number at planning (per-project numbering; align with the tool's own monotonic sequence after REQ-029).

## Out of scope (YAGNI)

- No per-task / per-idea / per-requirement prototype association (project-level only).
- No raw-HTML feeding to the model (screenshots only).
- No relevance/semantic selection of which prototypes apply to a task (feed all, capped at 6).
- No in-place editing of a prototype (remove + re-add to change one).
- No re-render on a schedule (immutable once rendered; remove + re-add to refresh).
