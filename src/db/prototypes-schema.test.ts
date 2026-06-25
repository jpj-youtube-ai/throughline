import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createTestDb } from "./client";
import { project, prototypes } from "./schema";

test("prototypes row round-trips label + html, scoped to a project", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", installationId: 1, defaultBranch: "main", localClonePath: "/x" }).returning({ id: project.id });
    const [row] = await db.insert(prototypes).values({ projectId: p.id, label: "Search page", html: "<html><body>hi</body></html>" }).returning({ id: prototypes.id });

    const [fresh] = await db.select({ label: prototypes.label, html: prototypes.html }).from(prototypes).where(eq(prototypes.id, row.id));
    assert.equal(fresh.label, "Search page");
    assert.match(fresh.html, /hi/);
  } finally { await close(); }
});
