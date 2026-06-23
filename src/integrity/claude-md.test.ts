import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { project, events } from "../db/schema";
import { upsertManagedBlock, syncClaudeMd, syncClaudeMdForProject, managedBlockBody } from "./claude-md";

const START = "<!-- THROUGHLINE:START -->";
const END = "<!-- THROUGHLINE:END -->";

test("upsertManagedBlock appends when no markers, leaving existing content as a prefix", () => {
  const existing = "# My CLAUDE.md\n\nSome project rules.\n";
  const out = upsertManagedBlock(existing, "BLOCK BODY");
  assert.ok(out.startsWith(existing), "existing content preserved");
  assert.ok(out.includes(START) && out.includes(END));
  assert.match(out, /BLOCK BODY/);
});

test("upsertManagedBlock replaces only the marked region; surroundings byte-identical", () => {
  const existing = `# Top\n\nbefore text\n${START}\nOLD BODY\n${END}\nafter text\n`;
  const out = upsertManagedBlock(existing, "NEW BODY");
  assert.equal(out, `# Top\n\nbefore text\n${START}\nNEW BODY\n${END}\nafter text\n`);
  assert.doesNotMatch(out, /OLD BODY/);
  assert.ok(out.startsWith("# Top\n\nbefore text\n"));
  assert.ok(out.endsWith("\nafter text\n"));
});

test("upsertManagedBlock is idempotent for the same body", () => {
  const once = upsertManagedBlock("# x\n", "BODY");
  const twice = upsertManagedBlock(once, "BODY");
  assert.equal(once, twice);
});

test("syncClaudeMd writes the block, bumps convention_version, emits claude_md.synced", async () => {
  const { db, close } = await createTestDb();
  try {
    await db.insert(project).values({
      repoFullName: "acme/repo",
      defaultBranch: "main",
      installationId: 1,
      localClonePath: "/x",
      conventionVersion: 1,
    });

    let captured = "";
    const fakeCommit = (content: string): { sha: string } => {
      captured = content;
      return { sha: "deadbee" };
    };

    const r = await syncClaudeMd(db, "# Existing CLAUDE.md\n", fakeCommit);
    assert.equal(r.conventionVersion, 2);
    assert.equal(r.sha, "deadbee");
    assert.match(captured, /THROUGHLINE:START/);
    assert.match(captured, /task-<key>-<slug>/);
    assert.match(captured, /never hand-edit/i);
    assert.ok(captured.startsWith("# Existing CLAUDE.md\n"), "existing content preserved");

    const projRow = (await db.select().from(project))[0];
    assert.equal(projRow.conventionVersion, 2);
    const evs = await db.select().from(events).where(eq(events.type, "claude_md.synced"));
    assert.equal(evs.length, 1);
    assert.deepEqual(evs[0].payload, { convention_version: 2 });
    assert.equal(evs[0].projectId, projRow.id, "claude_md.synced event carries projectId");
  } finally {
    await close();
  }
});

async function seedProj(db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
  const [p] = await db.insert(project).values({
    repoFullName: "acme/repo", installationId: 7, defaultBranch: "main",
    localClonePath: "/clones/acme__repo", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
  }).returning({ id: project.id, conventionVersion: project.conventionVersion });
  return p;
}

test("syncClaudeMdForProject: already-synced when the block is present + identical (no commit/push/event)", async () => {
  const { db, close } = await createTestDb();
  try {
    const p = await seedProj(db);
    const existing = upsertManagedBlock("# CLAUDE.md\n", managedBlockBody()); // already up to date
    let committed = false, pushed = false;
    const r = await syncClaudeMdForProject(db, p.id, {
      syncRemote: async () => {},
      readFile: () => existing,
      commit: () => { committed = true; return { sha: "x" }; },
      push: async () => { pushed = true; },
    });
    assert.equal(r.status, "already-synced");
    assert.equal(committed, false);
    assert.equal(pushed, false);
    const evs = await db.select().from(events).where(eq(events.type, "claude_md.synced"));
    assert.equal(evs.length, 0);
  } finally { await close(); }
});

test("syncClaudeMdForProject: creates + commits + pushes + bumps + emits when missing", async () => {
  const { db, close } = await createTestDb();
  try {
    const p = await seedProj(db);
    let committedContent = "", pushedArgs: unknown[] = [], syncedArgs: unknown[] = [];
    const r = await syncClaudeMdForProject(db, p.id, {
      syncRemote: async (clone, repo, inst, branch) => { syncedArgs = [clone, repo, inst, branch]; },
      readFile: () => "", // no CLAUDE.md
      commit: (_clone, _rel, content) => { committedContent = content; return { sha: "sha1" }; },
      push: async (clone, repo, inst, branch) => { pushedArgs = [clone, repo, inst, branch]; },
    });
    assert.equal(r.status, "synced");
    assert.equal(r.sha, "sha1");
    assert.match(committedContent, /THROUGHLINE:START/);
    assert.deepEqual(syncedArgs, ["/clones/acme__repo", "acme/repo", 7, "main"]); // reconciled with remote first
    assert.deepEqual(pushedArgs, ["/clones/acme__repo", "acme/repo", 7, "main"]);
    const [ev] = await db.select().from(events).where(eq(events.type, "claude_md.synced"));
    assert.ok(ev);
    assert.equal(ev.projectId, p.id);
    const [proj] = await db.select({ v: project.conventionVersion }).from(project).where(eq(project.id, p.id));
    assert.equal(proj.v, p.conventionVersion + 1);
  } finally { await close(); }
});

test("syncClaudeMdForProject: upserts the block into an existing CLAUDE.md (synced)", async () => {
  const { db, close } = await createTestDb();
  try {
    const p = await seedProj(db);
    let committedContent = "";
    const r = await syncClaudeMdForProject(db, p.id, {
      syncRemote: async () => {},
      readFile: () => "# CLAUDE.md\n\nSome notes.\n", // present, no block
      commit: (_c, _r, content) => { committedContent = content; return { sha: "s" }; },
      push: async () => {},
    });
    assert.equal(r.status, "synced");
    assert.match(committedContent, /Some notes\./); // surrounding content preserved
    assert.match(committedContent, /THROUGHLINE:START/);
  } finally { await close(); }
});
