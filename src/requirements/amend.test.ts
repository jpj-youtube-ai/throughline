import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { requirements, events, project } from "../db/schema";
import { amendRequirement } from "./amend";

async function seedProject(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
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
  return p.id;
}

test("amendRequirement updates the description and records requirement.amended with the why", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    const [r] = await db
      .insert(requirements)
      .values({ key: "REQ-026", title: "Digest to team chat", description: "outbound webhook", provenance: "imported", projectId })
      .returning({ id: requirements.id });

    const res = await amendRequirement(db, {
      key: "REQ-026",
      description: "An on-demand, in-app digest.",
      why: "the outbound config surface never existed; in-app is enough",
    });
    assert.equal(res.id, r.id);

    const [row] = await db.select().from(requirements).where(eq(requirements.id, r.id));
    assert.equal(row.description, "An on-demand, in-app digest.");
    assert.equal(row.title, "Digest to team chat"); // unchanged when title omitted

    const evs = await db.select().from(events).where(eq(events.type, "requirement.amended"));
    assert.equal(evs.length, 1);
    assert.equal(evs[0].subjectId, r.id);
    assert.match(evs[0].rationale ?? "", /never existed/);
  } finally {
    await close();
  }
});

test("amendRequirement carries projectId from the requirement onto the event", async () => {
  const { db, close } = await createTestDb();
  try {
    const projectId = await seedProject(db);
    await db.insert(requirements).values({
      key: "REQ-010",
      title: "Old title",
      description: "old desc",
      provenance: "imported",
      projectId,
    });

    await amendRequirement(db, { key: "REQ-010", description: "new desc", why: "better approach" });

    const [ev] = await db.select().from(events).where(eq(events.type, "requirement.amended"));
    assert.equal(ev.projectId, projectId, "requirement.amended event should carry projectId");
  } finally {
    await close();
  }
});

test("amendRequirement throws on an unknown key", async () => {
  const { db, close } = await createTestDb();
  try {
    await assert.rejects(amendRequirement(db, { key: "REQ-999", description: "x", why: "y" }), /no such requirement/);
  } finally {
    await close();
  }
});
