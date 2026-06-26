# Idea photos → issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user attach photos when submitting an idea, and embed those photos inline on every GitHub issue generated from that idea.

**Architecture:** Store photo bytes per idea (`idea_photos`), written in the `submitIdea` transaction. A public route serves each photo; `createIssuesForTasks` appends an "## Attached photos" markdown section linking those photos for any task whose `origin_idea_id` has them.

**Tech Stack:** TypeScript, Postgres + Drizzle (PGlite tests, `node:test`), Next.js (App Router route handler + server action), GitHub issue markdown (Camo image proxy).

**Design doc:** `docs/superpowers/specs/2026-06-26-idea-photos-on-issues-design.md`

## Global Constraints

- **Requirement:** **REQ-031 "Idea photos on issues"** (new — dev/commit-convention key; not declared in a live project, same caveat as REQ-030). Branch `task-072-idea-photos-on-issues`; PR/squash start `[TASK-072]`.
- **Truth model:** `idea_photos` rows are written **in the same transaction** as the idea insert and the existing `idea.submitted` event — **no new event type** (photos are submission content; the `idea.submitted` payload gains `photo_count`). No `github_status` write. The serve route is read-only. LLM not involved.
- **Limits:** max **8** photos per idea; accepted MIME types **`image/png`, `image/jpeg`, `image/webp`, `image/gif`**.
- **Public route:** `/idea-photo/[id]` must be reachable unauthenticated (GitHub's Camo proxy fetches it). Auth here is **per-page** (handlers without an `auth()` call are public — like `/preview`); there is no middleware allowlist to edit. Confirm no `middleware.ts` gates routes.
- **No `any`** in domain code. New `*.test.ts` registered in the enumerated `package.json` `test` script.
- **Migration not auto-applied to live DB** — generate it; controller hand-applies `CREATE TABLE idea_photos` at deploy.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Setup

```bash
git switch -c task-072-idea-photos-on-issues   # already created — confirm you're on it
```

---

## File Structure

- `src/db/schema.ts` — `idea_photos` table (modify).
- `src/ideas/submit.ts` — `submitIdea` writes photos + `photo_count` (modify).
- `src/ideas/photos.ts` — `loadIdeaPhotos`, `getIdeaPhoto` (create).
- `src/app/idea-photo/[id]/route.ts` — public serve (create).
- `src/github/issues.ts` — "## Attached photos" section (modify).
- `src/app/(app)/ideas/new/page.tsx` — file input + action validation (modify).

---

## Task 1: `idea_photos` table + migration

**Files:**
- Modify: `src/db/schema.ts`
- Create (generated): `drizzle/00NN_*.sql`
- Create: `src/db/idea-photos-schema.test.ts`; Modify: `package.json`

**Interfaces:**
- Produces: `ideaPhotos` table — `{ id: uuid, ideaId: uuid → ideas.id ON DELETE CASCADE, image: bytea NOT NULL, mediaType: text NOT NULL, createdAt }`.

- [ ] **Step 1: Write the failing round-trip test**

Create `src/db/idea-photos-schema.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "./client";
import { project, users, ideas, ideaPhotos } from "./schema";

test("idea_photos stores image bytes + media type, cascades on idea delete", async () => {
  const { db, close } = await createTestDb();
  try {
    const [u] = await db.insert(users).values({ name: "u", email: "u@x.io" }).returning({ id: users.id });
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const [idea] = await db.insert(ideas).values({ title: "t", why: "w", authorId: u.id, state: "voting", projectId: p.id }).returning({ id: ideas.id });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2]);
    const [row] = await db.insert(ideaPhotos).values({ ideaId: idea.id, image: png, mediaType: "image/png" }).returning({ id: ideaPhotos.id });

    const [got] = await db.select({ image: ideaPhotos.image, mediaType: ideaPhotos.mediaType }).from(ideaPhotos).where(eq(ideaPhotos.id, row.id));
    assert.deepEqual(Buffer.from(got.image as Uint8Array), png);
    assert.equal(got.mediaType, "image/png");

    await db.delete(ideas).where(eq(ideas.id, idea.id));
    assert.equal((await db.select().from(ideaPhotos).where(eq(ideaPhotos.ideaId, idea.id))).length, 0);
  } finally { await close(); }
});
```

Append ` src/db/idea-photos-schema.test.ts` to the `package.json` `test` script. (Confirm the `users` insert columns match the real `users` schema — adjust `name`/`email` to whatever it requires.)

- [ ] **Step 2: Run it — fails (no `ideaPhotos` export)**

Run: `npx tsx --test src/db/idea-photos-schema.test.ts` → FAIL.

- [ ] **Step 3: Add the table**

In `src/db/schema.ts`, after the `ideas` table (the `bytea` customType already exists near the top — reuse it):

```ts
export const ideaPhotos = pgTable("idea_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  ideaId: uuid("idea_id").notNull().references(() => ideas.id, { onDelete: "cascade" }),
  image: bytea("image").notNull(),
  mediaType: text("media_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Generate the migration + pass**

Run: `npm run db:generate` → new `drizzle/00NN_*.sql` with `CREATE TABLE "idea_photos"` + the FK (ON DELETE cascade).
Run: `npx tsx --test src/db/idea-photos-schema.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/idea-photos-schema.test.ts package.json drizzle/
git commit -m "$(cat <<'EOF'
[TASK-072] idea_photos table (REQ-031)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `submitIdea` writes photos in the submission tx

**Files:**
- Modify: `src/ideas/submit.ts`, `src/ideas/submit.test.ts`

**Interfaces:**
- Consumes: `ideaPhotos` (Task 1).
- Produces: `SubmitIdeaInput.photos?: { mediaType: string; data: Buffer }[]`; rows written in-tx; `idea.submitted` payload gains `photo_count`.

- [ ] **Step 1: Write the failing test**

Add to `src/ideas/submit.test.ts` (it already seeds a user + project for `submitIdea`; add `ideaPhotos`, `events` to the schema import):

```ts
test("submitIdea stores photos and records photo_count on idea.submitted, in one tx", async () => {
  const { db, close } = await createTestDb();
  try {
    const authorId = await seedUser(db); // existing helper
    await seedActiveProject(db, authorId); // existing helper / however the test sets the active project
    const png = Buffer.from([1, 2, 3]);
    const { id } = await submitIdea(db, { title: "Bug", why: "see shots", authorId, photos: [{ mediaType: "image/png", data: png }] });

    const photos = await db.select().from(ideaPhotos).where(eq(ideaPhotos.ideaId, id));
    assert.equal(photos.length, 1);
    assert.deepEqual(Buffer.from(photos[0].image as Uint8Array), png);
    assert.equal(photos[0].mediaType, "image/png");

    const [ev] = await db.select().from(events).where(eq(events.type, "idea.submitted"));
    assert.equal((ev.payload as { photo_count: number }).photo_count, 1);
  } finally { await close(); }
});
```

(Match the file's existing seed helpers/return shapes.)

- [ ] **Step 2: Run — fails**

Run: `npx tsx --test src/ideas/submit.test.ts` → FAIL.

- [ ] **Step 3: Extend `submitIdea` (`src/ideas/submit.ts`)**

Add `photos` to the input and write the rows in the existing tx. Import `ideaPhotos` from `../db/schema`. Add to `SubmitIdeaInput`:

```ts
  photos?: { mediaType: string; data: Buffer }[]; // attached at submission (REQ-031)
```

Inside the `db.transaction`, after the idea `row` is returned and before/with the `emitEvent`:

```ts
    const photos = input.photos ?? [];
    if (photos.length) {
      await tx.insert(ideaPhotos).values(photos.map((p) => ({ ideaId: row.id, image: p.data, mediaType: p.mediaType })));
    }
```

and add `photo_count: photos.length` to the `idea.submitted` payload object.

- [ ] **Step 4: Run — passes + typecheck**

Run: `npx tsx --test src/ideas/submit.test.ts` → PASS. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/ideas/submit.ts src/ideas/submit.test.ts
git commit -m "$(cat <<'EOF'
[TASK-072] submitIdea stores attached photos in the submission tx (REQ-031)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Photo readers + public serve route

**Files:**
- Create: `src/ideas/photos.ts`, `src/ideas/photos.test.ts`, `src/app/idea-photo/[id]/route.ts`; Modify: `package.json`

**Interfaces:**
- Produces: `loadIdeaPhotos(db, ideaId): Promise<{ id: string }[]>` (idea-scoped, newest-first); `getIdeaPhoto(db, id): Promise<{ image: Buffer; mediaType: string } | null>` (uuid-guarded); a public `GET /idea-photo/<id>`.

- [ ] **Step 1: Write the failing reader tests**

Create `src/ideas/photos.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type Db } from "../db/client";
import { project, users, ideas, ideaPhotos } from "../db/schema";
import { loadIdeaPhotos, getIdeaPhoto } from "./photos";

async function seedIdea(db: Db): Promise<string> {
  const [u] = await db.insert(users).values({ name: "u", email: "u@x.io" }).returning({ id: users.id });
  const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
  const [i] = await db.insert(ideas).values({ title: "t", why: "w", authorId: u.id, state: "voting", projectId: p.id }).returning({ id: ideas.id });
  return i.id;
}

test("loadIdeaPhotos returns the idea's photo ids, scoped", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seedIdea(db);
    const b = await seedIdea(db);
    await db.insert(ideaPhotos).values({ ideaId: a, image: Buffer.from([1]), mediaType: "image/png" });
    await db.insert(ideaPhotos).values({ ideaId: b, image: Buffer.from([2]), mediaType: "image/png" });
    const got = await loadIdeaPhotos(db, a);
    assert.equal(got.length, 1);
    assert.ok(typeof got[0].id === "string");
  } finally { await close(); }
});

test("getIdeaPhoto returns bytes + media type, null for a bad/absent id", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seedIdea(db);
    const jpg = Buffer.from([9, 9]);
    const [row] = await db.insert(ideaPhotos).values({ ideaId: a, image: jpg, mediaType: "image/jpeg" }).returning({ id: ideaPhotos.id });
    const got = await getIdeaPhoto(db, row.id);
    assert.deepEqual(got?.image, jpg);
    assert.equal(got?.mediaType, "image/jpeg");
    assert.equal(await getIdeaPhoto(db, "not-a-uuid"), null);
  } finally { await close(); }
});
```

Register `src/ideas/photos.test.ts` in `package.json`.

- [ ] **Step 2: Run — fails**

Run: `npx tsx --test src/ideas/photos.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/ideas/photos.ts`**

```ts
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { ideaPhotos } from "../db/schema";

/** The photo ids attached to an idea (REQ-031), newest-first — for building issue
 *  image links. */
export async function loadIdeaPhotos(db: Db, ideaId: string): Promise<{ id: string }[]> {
  return db.select({ id: ideaPhotos.id }).from(ideaPhotos).where(eq(ideaPhotos.ideaId, ideaId)).orderBy(desc(ideaPhotos.createdAt));
}

/** Fetch a single idea photo's bytes + media type by id, or null (REQ-031). */
export async function getIdeaPhoto(db: Db, id: string): Promise<{ image: Buffer; mediaType: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.select({ image: ideaPhotos.image, mediaType: ideaPhotos.mediaType }).from(ideaPhotos).where(eq(ideaPhotos.id, id)).limit(1);
  return row?.image ? { image: Buffer.from(row.image as Uint8Array), mediaType: row.mediaType } : null;
}
```

- [ ] **Step 4: Create the public serve route**

Create `src/app/idea-photo/[id]/route.ts` (mirrors `src/app/preview/[id]/route.ts` — NO `auth()` call → public; Content-Type from the stored media type):

```ts
import { getDb } from "@/db/client";
import { getIdeaPhoto } from "@/ideas/photos";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const photo = await getIdeaPhoto(getDb(), id);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.image), {
    headers: { "Content-Type": photo.mediaType, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
```

Confirm there is **no** `middleware.ts` at the repo root or `src/` that would gate this path (the project gates per-page; run a quick glob/grep). If one exists and gates all routes, add `/idea-photo` to its public allowlist alongside `/preview`.

- [ ] **Step 5: Run + build**

Run: `npx tsx --test src/ideas/photos.test.ts` → PASS. `npm run typecheck` → clean. `npm run build` → success (`/idea-photo/[id]` compiles).

- [ ] **Step 6: Commit**

```bash
git add src/ideas/photos.ts src/ideas/photos.test.ts "src/app/idea-photo/[id]/route.ts" package.json
git commit -m "$(cat <<'EOF'
[TASK-072] serve idea photos from a public route (REQ-031)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Issue transfer — "## Attached photos" section

**Files:**
- Modify: `src/github/issues.ts`, `src/github/issues.test.ts`

**Interfaces:**
- Consumes: `loadIdeaPhotos` (Task 3); `tasks.originIdeaId`; the existing `baseUrl` dep.
- Produces: issue bodies gain an "## Attached photos" section for tasks whose origin idea has photos.

- [ ] **Step 1: Write the failing test**

In `src/github/issues.test.ts` add (import `ideas`, `ideaPhotos`, and a user seed if needed):

```ts
test("createIssuesForTasks embeds the origin idea's photos on the issue", async () => {
  const { db, close } = await createTestDb();
  try {
    const { projId, reqId } = await seedProject(db, "acme/repo", 11);
    const [u] = await db.insert(users).values({ name: "u", email: "u2@x.io" }).returning({ id: users.id });
    const [idea] = await db.insert(ideas).values({ title: "Bug", why: "w", authorId: u.id, state: "approved", projectId: projId }).returning({ id: ideas.id });
    const [photo] = await db.insert(ideaPhotos).values({ ideaId: idea.id, image: Buffer.from([1]), mediaType: "image/png" }).returning({ id: ideaPhotos.id });
    await db.insert(tasks).values({ key: "TASK-001", title: "Fix", body: "b", requirementId: reqId, originIdeaId: idea.id, effort: 1, risk: "low", confidence: 50, projectId: projId });
    await db.insert(tasks).values({ key: "TASK-002", title: "NoIdea", body: "b", requirementId: reqId, effort: 1, risk: "low", confidence: 50, projectId: projId });

    const bodies: Record<string, string> = {};
    await createIssuesForTasks(db, projId, async (_i, _r, title, body) => { bodies[title.split(" ")[0]] = body; return { number: 1, url: "u" }; }, { baseUrl: "https://b.test" });

    assert.match(bodies["[TASK-001]"], /## Attached photos/);
    assert.match(bodies["[TASK-001]"], new RegExp(`!\\[photo\\]\\(https://b\\.test/idea-photo/${photo.id}\\)`));
    assert.doesNotMatch(bodies["[TASK-002]"], /Attached photos/);
  } finally { await close(); }
});
```

- [ ] **Step 2: Run — fails**

Run: `npx tsx --test src/github/issues.test.ts` → FAIL.

- [ ] **Step 3: Implement the section (`src/github/issues.ts`)**

Import `loadIdeaPhotos` from `@/ideas/photos`. Ensure the `pending` tasks select includes `originIdeaId: tasks.originIdeaId`. Before the `for (const t of pending)` loop, add a per-idea memo:

```ts
  const photoSectionByIdea = new Map<string, string>();
  async function ideaPhotoSection(ideaId: string): Promise<string> {
    if (!baseUrl) return "";
    const cached = photoSectionByIdea.get(ideaId);
    if (cached !== undefined) return cached;
    const photos = await loadIdeaPhotos(db, ideaId);
    const section = photos.length
      ? "\n\n## Attached photos\n" + photos.map((p) => `![photo](${baseUrl}/idea-photo/${p.id})`).join("\n")
      : "";
    photoSectionByIdea.set(ideaId, section);
    return section;
  }
```

Inside the loop, compute the section and append it to the body:

```ts
    const photoSection = t.originIdeaId ? await ideaPhotoSection(t.originIdeaId) : "";
    // …existing body assembly…
```

and add `photoSection` to the `openIssue(...)` body argument (e.g. `bodyPrefix + t.body + photoSection`, keeping any other appended sections in their existing order).

- [ ] **Step 4: Run + typecheck**

Run: `npx tsx --test src/github/issues.test.ts` → PASS (new + existing). `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/github/issues.ts src/github/issues.test.ts
git commit -m "$(cat <<'EOF'
[TASK-072] embed the origin idea's photos on its issues (REQ-031, REQ-009)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: New-idea form — photo upload

**Files:**
- Modify: `src/app/(app)/ideas/new/page.tsx`

> No unit test (React server component + inline server action — not unit-tested in this repo, like the other forms). Verify via typecheck/build/runtime.

- [ ] **Step 1: Add the file input + read/validate in the action**

In `src/app/(app)/ideas/new/page.tsx`:

In the `submit` server action, before calling `submitIdea`, read and validate the photos:

```ts
    const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
    const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > 8) throw new Error("Attach at most 8 photos.");
    for (const f of files) if (!ALLOWED.has(f.type)) throw new Error(`Unsupported image type: ${f.type || "unknown"}.`);
    const photos = await Promise.all(files.map(async (f) => ({ mediaType: f.type, data: Buffer.from(await f.arrayBuffer()) })));
```

and pass `photos` in the `submitIdea({ … })` call.

Add the input to the form (after the Feasibility/Viability grid, before the submit buttons):

```tsx
        <Field label="Photos (optional — up to 8; png/jpeg/webp/gif)">
          <input
            type="file"
            name="photos"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className={fieldClass}
          />
        </Field>
```

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck` then `npm run build` → both clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/ideas/new/page.tsx"
git commit -m "$(cat <<'EOF'
[TASK-072] attach photos when submitting an idea (REQ-031)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Declare REQ-031, verify, review, PR

**Files:** none (declare + verification + review + integration).

- [ ] **Step 1: Full verify**

Run: `npm test` (all pass incl. the new idea-photo tests; re-run once if the first run hits a transient V8/JIT crash on Windows/Node24). `npm run typecheck`. `npm run build`.

- [ ] **Step 2: Declare REQ-031 (operator step — note)**

REQ-031 is the dev/commit-convention key. Declaring it in a live project has the same ambiguity as REQ-030 (the tool's own requirements aren't tracked in a client project) — so do NOT auto-run `declare-req`. Flag to the controller/user as a deferred decision; the commits link REQ-031 as the convention regardless.

- [ ] **Step 3: Event-integrity review**

Dispatch `event-integrity-reviewer` on the branch diff. Confirm: `idea_photos` rows written in the same tx as `idea.submitted` (no new event type; `photo_count` in payload); no `github_status` write (the issue section only appends to the body); the serve route is read-only and public-by-omission-of-auth (raster images, no XSS); no `any`; maps to REQ-031 (+ REQ-009 for the issue embed).

- [ ] **Step 4: Live DB migration (deploy-time, controller)**

Hand-apply `CREATE TABLE idea_photos` (+ the FK) to live Postgres, then `npm run db:check` (expect no drift; this is an additive migration so `db:check` WILL catch it if missed).

- [ ] **Step 5: Runtime walkthrough**

On the deploy: submit a new idea with 1–2 photos → approve it → generate tasks → confirm each issue body has the "## Attached photos" section and the `![photo](…/idea-photo/<id>)` images render on GitHub (Camo proxies the public route). Confirm `/idea-photo/<id>` serves the image directly.

- [ ] **Step 6: PR**

```bash
git push -u origin task-072-idea-photos-on-issues
gh pr create --title "[TASK-072] attach photos to ideas, embed them on the generated issues (REQ-031)" --body "…"
```

Body: summarize upload → store-in-submit-tx → public serve route → issue embed; note the migration (hand-applied), the new REQ-031, worker+web deploy. Squash-merge.

---

## Self-Review

**Spec coverage** (against `2026-06-26-idea-photos-on-issues-design.md`):
- §1 `idea_photos` table → Task 1. ✔
- §2 `submitIdea` photos + `photo_count` in-tx → Task 2; form input + action validation → Task 5. ✔
- §3 public serve route + readers → Task 3. ✔
- §4 issue "## Attached photos" memoized per idea → Task 4. ✔
- §5 truth model (in-tx, no new event, no github_status, read-only route) → Global Constraints + Tasks 2/3/4 + Task 6 review. ✔
- §6 testing → each task's tests + Task 6. ✔
- Edge: no photos → no rows, no section (Task 2 guard `if (photos.length)`, Task 4 `photos.length` check). >8 / bad type → action rejects (Task 5). cascade on idea delete → Task 1 FK + test. baseUrl unset → section omitted (Task 4 `if (!baseUrl) return ""`). ✔
- New REQ-031 → Task 6 (deferred declare). Migration hand-applied → Task 1 + Task 6 Step 4. ✔

**Placeholder scan:** the only `…` is the `gh pr create` body. No TBD/TODO. Task 5 (UI) has no unit test by design; the action code is concrete.

**Type consistency:** `idea_photos` columns (Task 1) match the inserts in Task 2 (`{ ideaId, image, mediaType }`) and reads in Task 3 (`{ image, mediaType }`); `submitIdea`'s `photos: { mediaType, data: Buffer }[]` (Task 2) matches the action's `{ mediaType: f.type, data: Buffer }` (Task 5); `loadIdeaPhotos → {id}[]` (Task 3) consumed in Task 4 (`p.id` in the URL); `getIdeaPhoto → {image, mediaType}` (Task 3) consumed by the route (Content-Type from `mediaType`). The issue URL `/idea-photo/<id>` (Task 4) matches the route path (Task 3). Consistent.
