import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { project, events } from "../db/schema";
import { upsertManagedBlock, syncClaudeMd } from "./claude-md";

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
