import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTitle, classifyForMerge } from "./merge";
import type { ParsedRequirement } from "../genesis/import";
import { createTestDb } from "../db/client";
import { requirements, events, project } from "../db/schema";
import { eq } from "drizzle-orm";
import { mergeBranchSpec } from "./merge";

const parsed = (title: string, key = "REQ-999", description = "desc"): ParsedRequirement => ({ key, title, description });

test("normalizeTitle trims and lowercases", () => {
  assert.equal(normalizeTitle("  Payments "), "payments");
  assert.equal(normalizeTitle("PAYMENTS"), "payments");
});

test("classifyForMerge skips titles already on the board (trimmed + case-insensitive), keeps order", () => {
  const existing = [
    { id: "id-1", key: "REQ-001", title: "Payments" },
    { id: "id-2", key: "REQ-002", title: "Sign-in" },
  ];
  const input = [parsed("Refunds", "REQ-031"), parsed(" payments ", "REQ-032"), parsed("Audit log", "REQ-033")];

  const { toAdd, toSkip } = classifyForMerge(existing, input);

  assert.deepEqual(toAdd.map((r) => r.title), ["Refunds", "Audit log"]);
  assert.equal(toSkip.length, 1);
  assert.equal(toSkip[0].req.title, " payments ");
  assert.deepEqual(toSkip[0].existing, { id: "id-1", key: "REQ-001" });
});

test("classifyForMerge with no existing requirements adds everything", () => {
  const input = [parsed("A", "REQ-031"), parsed("B", "REQ-032")];
  const { toAdd, toSkip } = classifyForMerge([], input);
  assert.equal(toAdd.length, 2);
  assert.equal(toSkip.length, 0);
});

test("classifyForMerge with empty parsed returns empty toAdd/toSkip", () => {
  const { toAdd, toSkip } = classifyForMerge([{ id: "id-1", key: "REQ-001", title: "Payments" }], []);
  assert.equal(toAdd.length, 0);
  assert.equal(toSkip.length, 0);
});

async function seedProject(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
  const [p] = await db
    .insert(project)
    .values({ repoFullName: "acme/repo", defaultBranch: "main", installationId: 1, localClonePath: "/x", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
    .returning({ id: project.id });
  return p.id;
}

async function seedReq(db: Awaited<ReturnType<typeof createTestDb>>["db"], projectId: string, key: string, title: string): Promise<void> {
  await db.insert(requirements).values({ key, title, description: "x", status: "planned", provenance: "imported", projectId });
}

const BRANCH = `**REQ-100 — Refunds.** Issue refunds. *Accept:* works.

**REQ-101 — Sign-in.** Already exists on the board. *Accept:* works.
`;

test("mergeBranchSpec adds new reqs on a non-empty board, minting keys that continue the sequence", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    await seedReq(db, projectId, "REQ-001", "Sign-in");
    await seedReq(db, projectId, "REQ-002", "Existing two");

    const res = await mergeBranchSpec(db, BRANCH, "branch.md", projectId);

    // One added ("Refunds"), one skipped ("Sign-in").
    assert.deepEqual(res.added.map((a) => a.title), ["Refunds"]);
    assert.equal(res.added[0].key, "REQ-003"); // continues the board's sequence, ignores REQ-100
    assert.deepEqual(res.skipped, [{ title: "Sign-in", existingKey: "REQ-001" }]);

    const reqs = await db.select().from(requirements).where(eq(requirements.projectId, projectId));
    assert.equal(reqs.length, 3); // 2 seeded + 1 added (Sign-in NOT duplicated)
    const added = reqs.find((r) => r.title === "Refunds")!;
    assert.equal(added.status, "planned");
    assert.equal(added.provenance, "imported");
  } finally {
    await close();
  }
});

test("mergeBranchSpec emits requirement.declared for adds and requirement.merge_skipped for skips, in-tx", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    await seedReq(db, projectId, "REQ-001", "Sign-in");

    await mergeBranchSpec(db, BRANCH, "branch.md", projectId);

    const declared = await db.select().from(events).where(eq(events.type, "requirement.declared"));
    assert.equal(declared.length, 1);
    const dp = declared[0].payload as { provenance: string; source: string; filename: string; origin_idea_id: unknown };
    assert.equal(dp.provenance, "imported");
    assert.equal(dp.source, "branch-merge");
    assert.equal(dp.filename, "branch.md");
    assert.equal(dp.origin_idea_id, null);

    const skipped = await db.select().from(events).where(eq(events.type, "requirement.merge_skipped"));
    assert.equal(skipped.length, 1);
    const existing = (await db.select().from(requirements).where(eq(requirements.key, "REQ-001")))[0];
    assert.equal(skipped[0].subjectId, existing.id); // points at the EXISTING requirement
    const sp = skipped[0].payload as { filename: string; skipped_title: string; existing_key: string };
    assert.deepEqual(sp, { filename: "branch.md", skipped_title: "Sign-in", existing_key: "REQ-001" });
    // Every event is project-scoped.
    for (const e of [...declared, ...skipped]) assert.equal(e.projectId, projectId);
  } finally {
    await close();
  }
});

test("mergeBranchSpec throws and writes nothing when no requirements parse", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    await assert.rejects(mergeBranchSpec(db, "no requirements here", "branch.md", projectId), /No requirements found/i);
    assert.equal((await db.select().from(requirements).where(eq(requirements.projectId, projectId))).length, 0);
    assert.equal((await db.select().from(events)).length, 0);
  } finally {
    await close();
  }
});

test("mergeBranchSpec is project-scoped: skip-matching and minting use only the target project", async () => {
  const { db, close } = await createTestDb();
  try {
    const a = await seedProject(db);
    const [pb] = await db
      .insert(project)
      .values({ repoFullName: "acme/repo-b", defaultBranch: "main", installationId: 2, localClonePath: "/y", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const b = pb.id;
    // "Refunds" exists in B only. Merging into A must still ADD Refunds (not skip).
    await seedReq(db, b, "REQ-050", "Refunds");

    const res = await mergeBranchSpec(db, `**REQ-100 — Refunds.** x.`, "branch.md", a);
    assert.deepEqual(res.added.map((x) => x.title), ["Refunds"]);
    assert.equal(res.added[0].key, "REQ-001"); // A's own sequence, independent of B
  } finally {
    await close();
  }
});
