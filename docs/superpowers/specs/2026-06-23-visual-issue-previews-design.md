# Visual issue previews — design

**Date:** 2026-06-23
**Status:** Approved (design); pending implementation plan
**Layer:** Surface `[3]` — enhances issue creation (REQ-009) with a glanceable visual.
**Task:** TASK-051 · **Requirement:** REQ-009 (task→issue creation)

## Problem

When Throughline generates a GitHub issue per task (`createIssuesForTasks` → `openIssue`, body = the task's generated `body`), the issue is text-only. The user wants a **visual (HTML) prototype of what the change does** embedded in the issue — "way easier to understand" at a glance. A rough prototype is acceptable.

GitHub **sanitizes HTML in issue bodies** (no live HTML/JS/inline-SVG), and its image proxy (Camo) fetches inline images **server-side from the public internet** at render time. So the visual must be a rendered **image at a publicly-reachable URL**.

## Decisions (settled in brainstorming)

1. **Inline image** in the issue body (best glance-value) — not a click-through link.
2. **Hosted by Throughline itself**, served at a **public, no-auth** route, exposed via **Tailscale Funnel on 443**. Funnel is **per-port** (not per-path), so the whole board is internet-reachable — it stays **auth-gated**, and `/preview` is the only unauthenticated route. *(Funnel is already enabled + verified publicly reachable.)*
3. **Puppeteer** (headless Chromium) renders HTML→PNG — full fidelity (chosen over the leaner satori+resvg).
4. **Every task gets a visual, adapted**: a styled UI mockup for user-facing changes; a simple before/after or flow/data sketch for backend tasks. The LLM picks the apt form.
5. Generated **at issue-creation time** (in the worker), **best-effort**.

## Architecture

**Flow** — added inside `createIssuesForTasks`, per pending task, all best-effort:

1. **Generate** a small, self-contained HTML mockup of the change via the Anthropic API (Sonnet/Opus — never Haiku). The prompt takes the task title + body (+ requirement title) and adapts: a styled UI mockup for user-facing changes, or a before/after / flow / data-shape sketch for backend tasks. Output validated (non-empty, contains `<`/`>` markup, ≤ ~20 KB). Retry once on malformed output, then **skip** (return `null`) — never persist garbage.
2. **Render** the HTML → PNG with Puppeteer: a single reused headless-Chromium instance, `page.setContent(html)`, viewport ~900 px wide at `deviceScaleFactor: 2`, full-page screenshot with a height cap (e.g. 2000 px).
3. **Store** `preview_html` (text) + `preview_image` (bytea, the PNG) on the task row.
4. **Embed** `![preview](<PUBLIC_BASE_URL>/preview/<taskId>.png)` at the top of the issue body, then `openIssue` as today.

**Failure handling:** any step failing (LLM, Chromium, store) → log + create the issue **without** the image. The visual never blocks issue creation — same best-effort posture as branch creation (TASK-040). No partial state is stored.

**Serving:** `GET /preview/<taskId>.png` — a **public, unauthenticated** App-Router route handler that reads `tasks.preview_image` by id and streams it as `image/png` with cache headers. The task UUID is the unguessable id. Returns 404 if absent. Must be excluded from any auth middleware — the rest of the app requires auth, which (now that Funnel makes the board internet-reachable) is what protects it.

## Truth-model constraints

- All steps are **external side-effects in the worker**, after the tasks are committed, **never inside a DB transaction**, **never at render time** (the LLM runs in the worker, not in a page/render).
- `preview_html` / `preview_image` are **cache/mirror data** — exactly like the existing `github_issue_number` / `github_issue_url`, which are stored without an event. **No event** is emitted (the visual is a derived convenience, not authoritative state).
- Per-project: previews are generated in the same per-project issue-creation loop; the public route serves by global task id.

## Components

**New**
- `src/preview/generate.ts` — `generatePreviewHtml(task: {key,title,body,requirementKey?}, deps?) => Promise<string | null>` (Anthropic call; validate + size-cap; retry-once-then-`null`). LLM client injectable.
- `src/preview/render.ts` — `renderHtmlToPng(html: string) => Promise<Buffer>` (Puppeteer; reused browser; dimension caps). Exposes a `closeBrowser()` for worker shutdown.
- `src/app/preview/[id]/route.ts` — public `GET` PNG route (no auth).

**Modified**
- `src/github/issues.ts` — wire generate→render→store→embed into `createIssuesForTasks`; `generate`/`render` injectable for tests; build the body with the image markdown; persist preview fields.
- `src/db/schema.ts` — add `tasks.preview_html` (text, null) + `tasks.preview_image` (bytea custom type, null).
- Auth middleware (if a global guard exists) — allow `/preview/*` through unauthenticated.

**Config / env**
- `PUBLIC_BASE_URL` = `https://paul.tailf03436.ts.net` (used to build the image URL).

**Migration**
- New Drizzle migration adding the two columns; **applied to the live orbit DB by hand** (project rule — `db:migrate` is fresh-provision only).

## Setup (operator) — one-time

1. Add `PUBLIC_BASE_URL=https://paul.tailf03436.ts.net` to `.env`.
2. **Tailscale Funnel — DONE.** The `funnel` node attribute was granted in the tailnet ACL; Funnel is enabled on 443 via `tailscale funnel --bg http://127.0.0.1:3000` and verified reachable from the public internet. Because Funnel is per-port, the whole board is now internet-reachable (auth-gated); `/preview` is the only unauthenticated route.
3. Install Puppeteer (pulls a ~150 MB Chromium — the heaviest new dependency, justified by the full-fidelity choice).

## Testing

- **`generatePreviewHtml`** (mock Anthropic client): returns the HTML on good output; enforces the size cap; retries once then returns `null` on malformed output (no throw).
- **`renderHtmlToPng`** (one Puppeteer smoke test): a known HTML string → a Buffer beginning with the PNG magic bytes (`89 50 4E 47`). Needs Chromium; may be slow.
- **`/preview/[id]` route**: a task with a stored PNG → `200` `image/png` + the exact bytes; missing/absent → `404`.
- **`createIssuesForTasks` wiring** (injected generate/render deps, PGlite): body contains `![preview](<base>/preview/<id>.png)` and preview fields are stored on success; a `null`/throwing generate or render → issue still created, body has no image, no preview stored.
- New test files appended to the `package.json` test list.

## Scope / phasing (for the plan)

1. Schema columns + migration.
2. `generatePreviewHtml` (+ tests).
3. `renderHtmlToPng` (+ smoke test).
4. `/preview/[id]` public route (+ test, + middleware allowance).
5. Wire into `createIssuesForTasks` (+ tests); env `PUBLIC_BASE_URL`.
6. Verify: suite + build; live Funnel enablement + an end-to-end check (generate an issue, confirm the image renders in GitHub).

## Out of scope

- Regenerating/refreshing a preview after the issue exists (generated once, at first issue creation).
- Showing the preview inside the Throughline board UI (the route exists; a board view can come later).
- A public previews repo / gist (rejected in favor of Throughline-hosted via Funnel).
- Per-image access control beyond the unguessable task-UUID URL.
