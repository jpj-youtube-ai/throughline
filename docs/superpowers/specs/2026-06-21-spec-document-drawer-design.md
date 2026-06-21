# Spec map — "View SPEC.md" drawer

**Date:** 2026-06-21
**Status:** Design, approved
**Maps to:** REQ-017 (the spec map / view) — an enhancement to the existing spec surface, not a new requirement.

## Motivation

The `/spec` page renders the requirements grid (`listSpecMap`) from the board DB, but the
materialized `SPEC.md` document itself — the projection committed to the bound project's repo —
isn't viewable from the app. Add a button on the spec map that opens the raw `SPEC.md` in a
drawer, so the source-of-record projection is one click away from its structured view.

The materialized `SPEC.md` lives in the bound project's local clone at
`project.localClonePath / project.specPath` (currently `.clones/jpj-youtube-ai__orbit/SPEC.md`).

## Decisions

- **Drawer, app pattern.** Mirror the existing `/spec/[key]` requirement-detail drawer: a full
  page route plus an intercepting `@drawer` route that wraps the same content in `DrawerShell`
  (slide-in, Esc/scrim/✕ close, focus trap). Reuse `DrawerShell` unchanged.
- **Raw text, no markdown dependency.** Render `SPEC.md` verbatim in a monospace
  `<pre className="whitespace-pre-wrap">`. The project has no markdown renderer and we won't add
  one; raw is faithful to "the materialized doc, never hand-edited."
- **Read off disk, read-only.** A small `readSpec(db)` helper reads the clone file. No mutation,
  no event — this only surfaces an existing artifact.

## Components & files

- **Create `src/spec/read.ts`** — `readSpec(db: Db): Promise<{ content: string | null; path: string | null }>`.
  Selects the `project` singleton; returns `{ content: null, path: null }` if no project is
  bound; otherwise reads `path.join(localClonePath, specPath)` and returns its text, or
  `{ content: null, path: specPath }` if the file does not exist (e.g. before first materialize).
  Never throws on a missing file.
- **Create `src/spec/read.test.ts`** — unit tests over PGlite + a temp dir:
  (1) a project whose clone has a `SPEC.md` → returns its content and path;
  (2) a project whose clone has no `SPEC.md` → returns `{ content: null, path }`;
  (3) no project bound → returns `{ content: null, path: null }`.
- **Create `src/app/(app)/spec/spec-document.tsx`** — `SpecDocument` server component: calls
  `readSpec(getDb())`; renders the content in a monospace `<pre>`; renders an `Empty` state
  ("No SPEC.md yet — it's written when requirements are first materialized.") when content is null.
- **Create `src/app/(app)/spec/document/page.tsx`** — full page route: `PageHeader`
  (eyebrow "Specification", title "SPEC.md") + `<SpecDocument />`. `export const dynamic = "force-dynamic"`.
- **Create `src/app/(app)/@drawer/(.)spec/document/page.tsx`** — intercepting drawer:
  `<DrawerShell title="SPEC.md"><SpecDocument /></DrawerShell>`. `export const dynamic = "force-dynamic"`.
- **Modify `src/app/(app)/spec/page.tsx`** — add a "View SPEC.md" link-button in the `PageHeader`
  children, beside the shipped count: `<Link href="/spec/document" className={buttonClass("quiet")}>View SPEC.md</Link>`.
  (`buttonClass` is `"primary" | "quiet"`; "quiet" is the secondary affordance, right for this.)

## Routing note

`/spec/document` sits beside the dynamic `/spec/[key]`. Next.js App Router resolves a static
segment (`document`) ahead of a dynamic one (`[key]`), and requirement keys are `REQ-NNN`, so
there is no collision. The intercept `@drawer/(.)spec/document` likewise takes precedence over
`@drawer/(.)spec/[key]`.

## Truth model

Read-only surfacing of an existing artifact. No state change, no event, no new writer of any
mirrored field. Nothing in the truth model is touched.

## Out of scope

- Markdown rendering / syntax highlighting (raw monospace only).
- Editing `SPEC.md` (it is a generated projection — never hand-edited).
- Triggering materialize from this view (separate concern, REQ-012).

## Verification

- Unit test `readSpec` (the three cases above).
- Typecheck + build + runtime for the UI (the gate used by the prior drawer phases — these
  components are presentational and route-wired, like the other 12 drawers).
- Runtime check: from `/spec`, the button opens the drawer with the raw `SPEC.md`; a direct visit
  to `/spec/document` shows the full page; `/spec/REQ-NNN` still routes to the requirement drawer
  (no regression from the static/dynamic sibling).

## Acceptance

The spec map has a "View SPEC.md" button that opens a drawer showing the bound project's raw
`SPEC.md`; an unbound project or pre-materialize state shows a clean empty state instead of an
error; requirement-detail drawers are unaffected.
