import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { requirements, events, project } from "../db/schema";
import { parseSpecRequirements, importGenesisSpec } from "./import";

const FIXTURE = `## 5. Requirements

### Foundation \`[1]\`

**REQ-001 — First thing.** Does the first thing. *Accept:* first works.

**REQ-002 — Second thing.** Does the second thing, references REQ-001. *Accept:* second works.

### Integrity layer \`[2]\`

**REQ-003 — Third thing.** Does the third thing. *Accept:* third works.

---

## 6. Glossary
`;

async function seedProject(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
  const [p] = await db
    .insert(project)
    .values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
    .returning({ id: project.id });
  return p.id;
}

test("parseSpecRequirements extracts key, title, and description; stops at section/req boundaries", () => {
  const parsed = parseSpecRequirements(FIXTURE);
  assert.equal(parsed.length, 3);
  assert.deepEqual(
    parsed.map((r) => r.key),
    ["REQ-001", "REQ-002", "REQ-003"],
  );
  assert.equal(parsed[0].title, "First thing");
  assert.match(parsed[0].description, /Does the first thing\. \*Accept:\* first works\./);
  // Inline "REQ-001" reference inside REQ-002's body must not split it.
  assert.match(parsed[1].description, /references REQ-001/);
  // Description must not bleed past the next section header.
  assert.doesNotMatch(parsed[1].description, /Integrity layer/);
});

test("importGenesisSpec writes planned/imported requirements + genesis events in one transaction", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    const res = await importGenesisSpec(db, FIXTURE, "SPEC.md", projectId);
    assert.equal(res.count, 3);

    const reqs = await db.select().from(requirements);
    assert.equal(reqs.length, 3);
    for (const r of reqs) {
      assert.equal(r.status, "planned");
      assert.equal(r.provenance, "imported");
    }

    // One project.genesis_imported + one requirement.declared per requirement.
    const allEvents = await db.select().from(events);
    assert.equal(allEvents.length, 4);
    const genesis = allEvents.filter((e) => e.type === "project.genesis_imported");
    assert.equal(genesis.length, 1);
    assert.deepEqual(genesis[0].payload, { filename: "SPEC.md", count: 3 });
    const declared = allEvents.filter((e) => e.type === "requirement.declared");
    assert.equal(declared.length, 3);
    for (const e of declared) {
      assert.equal((e.payload as { provenance: string }).provenance, "imported");
    }

    // Each requirement.declared references a real requirement row.
    const req1 = reqs.find((r) => r.key === "REQ-001")!;
    const declaredForReq1 = await db
      .select()
      .from(events)
      .where(eq(events.subjectId, req1.id));
    assert.equal(declaredForReq1.length, 1);
    assert.equal(declaredForReq1[0].type, "requirement.declared");
  } finally {
    await close();
  }
});

test("genesis import is one-time: a second import is refused and writes nothing", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    await importGenesisSpec(db, FIXTURE, "SPEC.md", projectId);
    await assert.rejects(importGenesisSpec(db, FIXTURE, "SPEC.md", projectId), /refused/i);
    // Unchanged: still 3 requirements and 4 events, no partial second import.
    assert.equal((await db.select().from(requirements)).length, 3);
    assert.equal((await db.select().from(events)).length, 4);
  } finally {
    await close();
  }
});

test("parses the real SPEC.md genesis spec (REQ-001..REQ-027)", () => {
  const specText = fs.readFileSync(path.resolve("SPEC.md"), "utf8");
  const parsed = parseSpecRequirements(specText);
  assert.equal(parsed.length, 27);
  assert.equal(parsed[0].key, "REQ-001");
  assert.equal(parsed[0].title, "GitHub sign-in");
  assert.equal(parsed[parsed.length - 1].key, "REQ-027");
  for (const r of parsed) {
    assert.match(r.key, /^REQ-\d{3}$/);
    assert.ok(r.title.length > 0, `${r.key} has a title`);
    assert.ok(r.description.length > 0, `${r.key} has a description`);
  }
});

test("genesis guard is per-project: importing into a project with reqs is refused, but a fresh second project can still import", async () => {
  const { db, close } = await createTestDb();
  try {
    // Project A: import succeeds, then second import is refused.
    const projectAId = await seedProject(db);
    await importGenesisSpec(db, FIXTURE, "SPEC.md", projectAId);
    await assert.rejects(importGenesisSpec(db, FIXTURE, "SPEC.md", projectAId), /refused/i);

    // Project B: fresh project — import must succeed even though project A has requirements.
    const [pb] = await db
      .insert(project)
      .values({ repoFullName: "acme/repo-b", defaultBranch: "main", installationId: 2, localClonePath: "/y", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const projectBId = pb.id;
    const resB = await importGenesisSpec(db, FIXTURE, "SPEC.md", projectBId);
    assert.equal(resB.count, 3);

    // Each project has its own 3 requirements (6 total), no cross-contamination.
    const { eq } = await import("drizzle-orm");
    const { requirements: reqs } = await import("../db/schema");
    const aReqs = await db.select().from(reqs).where(eq(reqs.projectId, projectAId));
    const bReqs = await db.select().from(reqs).where(eq(reqs.projectId, projectBId));
    assert.equal(aReqs.length, 3);
    assert.equal(bReqs.length, 3);
  } finally {
    await close();
  }
});

test("importGenesisSpec sets requirements.projectId and emits project-scoped events when projectId provided", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db
      .insert(project)
      .values({
        repoFullName: "acme/throughline",
        defaultBranch: "main",
        installationId: 42,
        localClonePath: "/tmp/repo",
        specPath: "SPEC.md",
        claudeMdPath: "CLAUDE.md",
      })
      .returning({ id: project.id });
    const projectId = p.id;

    const res = await importGenesisSpec(db, FIXTURE, "SPEC.md", projectId);
    assert.equal(res.count, 3);

    const reqs = await db.select().from(requirements);
    for (const r of reqs) {
      assert.equal(r.projectId, projectId, `requirement ${r.key} should carry projectId`);
    }

    // Events should carry projectId
    const allEvents = await db.select().from(events);
    for (const e of allEvents) {
      assert.equal(e.projectId, projectId, `event ${e.type} should carry projectId`);
    }
  } finally {
    await close();
  }
});
