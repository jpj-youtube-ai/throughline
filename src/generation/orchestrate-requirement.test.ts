// src/generation/orchestrate-requirement.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb } from "../db/client";
import { requirements, tasks, project } from "../db/schema";
import { generateForRequirement, generateForRequirementKey } from "./orchestrate";
import type { GenerateTasksResult } from "./run";
import type { generateTasks as GenerateTasksFn } from "./run";
import type { BuildSliceOptions } from "../repoSlice";

const fakeGenerate = async (): Promise<GenerateTasksResult> => ({
  ok: true,
  model: "fake",
  usage: null,
  output: {
    new_requirements: [],
    tasks: [{ title: "Do it", requirement_key: "REQ-001", body: { pointers: ["src/x.ts"], acceptance_check: "ok" }, effort: 1, risk: "low", confidence: 90, prototypes: [] }],
  },
});

test("generateForRequirement guards: missing requirement", async () => {
  const { db, close } = await createTestDb();
  try {
    const r = await generateForRequirement(db, "00000000-0000-0000-0000-000000000000");
    assert.equal(r.ok, false);
    assert.match(r.failure ?? "", /requirement not found/i);
  } finally { await close(); }
});

test("generateForRequirement guards: no project with spec files (no local clone)", async () => {
  const { db, close } = await createTestDb();
  try {
    // A requirement needs a project FK, but the project can point to a path with no spec files.
    // The generator (fakeGenerate) will be called with empty context and should still succeed.
    const [p] = await db
      .insert(project)
      .values({ repoFullName: "o/r", installationId: 1, defaultBranch: "main", localClonePath: "/nonexistent", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md" })
      .returning({ id: project.id });
    const [req] = await db.insert(requirements).values({ key: "REQ-001", title: "t", description: "d", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });
    const r = await generateForRequirement(db, req.id, { generate: fakeGenerate });
    // fakeGenerate always returns ok: true; the guard we're testing is "no project bound"
    // which is now architecturally unreachable (requirements require a projectId FK).
    // Instead, verify the happy path runs through without crashing.
    assert.equal(r.ok, true);
    assert.deepEqual(r.taskKeys, ["TASK-001"]);
  } finally { await close(); }
});

test("generateForRequirement happy path with an injected generator persists tasks", async () => {
  const { db, close } = await createTestDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-"));
  fs.writeFileSync(path.join(dir, "SPEC.md"), "# Spec\n");
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Conventions\n");
  try {
    const [p] = await db.insert(project).values({
      repoFullName: "o/orbit", installationId: 1, defaultBranch: "main",
      localClonePath: dir, specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
    }).returning({ id: project.id });
    const [req] = await db.insert(requirements).values({ key: "REQ-001", title: "Search", description: "Full-text search", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });

    const r = await generateForRequirement(db, req.id, { generate: fakeGenerate });
    assert.equal(r.ok, true);
    assert.deepEqual(r.taskKeys, ["TASK-001"]);

    const rows = await db.select().from(tasks).where(eq(tasks.requirementId, req.id));
    assert.equal(rows.length, 1);

    // already-has-tasks guard on a second run
    const again = await generateForRequirement(db, req.id, { generate: fakeGenerate });
    assert.equal(again.ok, false);
    assert.match(again.failure ?? "", /already has tasks/i);
  } finally {
    await close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("generateForRequirement scopes requirement context to subject's project only", async () => {
  const { db, close } = await createTestDb();
  try {
    const [pA] = await db.insert(project).values({
      repoFullName: "acme/alpha", installationId: 10, defaultBranch: "main",
      localClonePath: "/nonexistent-alpha", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
    }).returning({ id: project.id });
    const [pB] = await db.insert(project).values({
      repoFullName: "acme/beta", installationId: 20, defaultBranch: "main",
      localClonePath: "/nonexistent-beta", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
    }).returning({ id: project.id });

    // Project A has two requirements
    await db.insert(requirements).values([
      { key: "REQ-001", title: "Alpha feature 1", description: "d", provenance: "imported", projectId: pA.id },
      { key: "REQ-002", title: "Alpha feature 2 — MUST NOT APPEAR IN B", description: "d", provenance: "imported", projectId: pA.id },
    ]);
    // Project B has one requirement that the generator will generate tasks for
    const [reqB] = await db.insert(requirements).values({
      key: "REQ-001", title: "Beta feature", description: "desc", provenance: "imported", projectId: pB.id,
    }).returning({ id: requirements.id });

    let capturedExistingList = "";
    const capturingGenerate: typeof import("./run").generateTasks = async (opts) => {
      // Extract existingList from the user message (it's embedded by buildUserMessage)
      capturedExistingList = opts.userMessage;
      return {
        ok: true, model: "fake", usage: null,
        output: { new_requirements: [], tasks: [{ title: "Beta task", requirement_key: "REQ-001", body: { pointers: [], acceptance_check: "ok" }, effort: 1, risk: "low", confidence: 80, prototypes: [] }] },
      };
    };

    const r = await generateForRequirement(db, reqB.id, { generate: capturingGenerate });
    assert.equal(r.ok, true, `generation should succeed: ${r.failure}`);
    assert.doesNotMatch(capturedExistingList, /Alpha feature 2 — MUST NOT APPEAR IN B/, "requirement context must not include project A requirements");
    assert.doesNotMatch(capturedExistingList, /Alpha feature 1/, "requirement context must not include project A requirements");
  } finally {
    await close();
  }
});

test("generateForRequirement loads the subject requirement's project (not another project)", async () => {
  const { db, close } = await createTestDb();
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "proj-a-"));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "proj-b-"));
  fs.writeFileSync(path.join(dirA, "SPEC.md"), "# Spec A\n");
  fs.writeFileSync(path.join(dirA, "CLAUDE.md"), "# Conventions A\n");
  fs.writeFileSync(path.join(dirB, "SPEC.md"), "# Spec B\n");
  fs.writeFileSync(path.join(dirB, "CLAUDE.md"), "# Conventions B\n");
  try {
    // Two projects with distinct clone paths
    const [pA] = await db.insert(project).values({
      repoFullName: "acme/alpha", installationId: 10, defaultBranch: "main",
      localClonePath: dirA, specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
    }).returning({ id: project.id });
    const [pB] = await db.insert(project).values({
      repoFullName: "acme/beta", installationId: 20, defaultBranch: "main",
      localClonePath: dirB, specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
    }).returning({ id: project.id });

    // Requirement belongs to project B
    const [reqB] = await db.insert(requirements).values({
      key: "REQ-001", title: "Beta search", description: "Search in beta", provenance: "imported", projectId: pB.id,
    }).returning({ id: requirements.id });

    // Injected generator captures which repoPath was used in the message
    let capturedRepoPath: string | undefined;
    const trackingGenerate: typeof GenerateTasksFn = async (opts) => {
      // The userMessage embeds the clone path via buildSlice / buildUserMessage.
      // Instead of parsing the message, we monkey-patch via a closure that
      // captures the localClonePath the orchestrator resolved.
      // Here we verify by checking which SPEC content reaches the generator.
      capturedRepoPath = opts.userMessage.includes("Spec B") ? dirB : dirA;
      return {
        ok: true,
        model: "fake",
        usage: null,
        output: {
          new_requirements: [],
          tasks: [{ title: "Beta task", requirement_key: "REQ-001", body: { pointers: [], acceptance_check: "ok" }, effort: 1, risk: "low", confidence: 80, prototypes: [] }],
        },
      };
    };

    const r = await generateForRequirement(db, reqB.id, { generate: trackingGenerate });
    assert.equal(r.ok, true, `generation should succeed: ${r.failure}`);
    assert.equal(capturedRepoPath, dirB, "orchestrator used project B's clone path, not A's");

    // Tasks created belong to project B
    const rows = await db.select({ projectId: tasks.projectId }).from(tasks).where(eq(tasks.requirementId, reqB.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].projectId, pB.id);
  } finally {
    await close();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test("generateForRequirementKey resolves the key WITHIN the given project, not another project's same key", async () => {
  const { db, close } = await createTestDb();
  try {
    // Project A (inserted first) has REQ-001 that ALREADY has a task.
    const [pA] = await db.insert(project).values({
      repoFullName: "acme/alpha", installationId: 10, defaultBranch: "main",
      localClonePath: "/nonexistent-alpha", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
    }).returning({ id: project.id });
    const [reqA] = await db.insert(requirements).values({
      key: "REQ-001", title: "Alpha feature", description: "d", provenance: "imported", projectId: pA.id,
    }).returning({ id: requirements.id });
    await db.insert(tasks).values({
      key: "TASK-001", title: "existing alpha task", body: "b", requirementId: reqA.id,
      effort: 1, risk: "low", confidence: 50, projectId: pA.id,
    });

    // Project B (newer, the "active" one) has REQ-001 with NO tasks yet.
    const [pB] = await db.insert(project).values({
      repoFullName: "acme/beta", installationId: 20, defaultBranch: "main",
      localClonePath: "/nonexistent-beta", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
    }).returning({ id: project.id });
    const [reqB] = await db.insert(requirements).values({
      key: "REQ-001", title: "Beta feature", description: "desc", provenance: "imported", projectId: pB.id,
    }).returning({ id: requirements.id });

    // Generating for project B's REQ-001 must target B (no tasks), NOT resolve to
    // project A's REQ-001 (which already has tasks) and bail with "already has tasks".
    const r = await generateForRequirementKey(db, pB.id, "REQ-001", { generate: fakeGenerate });
    assert.equal(r.ok, true, `should generate for project B, got failure: ${r.failure}`);

    const bRows = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.requirementId, reqB.id));
    assert.equal(bRows.length, 1, "the new task must be linked to project B's requirement");

    // A key absent from this project fails clearly — never a silent cross-project match.
    const miss = await generateForRequirementKey(db, pB.id, "REQ-404", { generate: fakeGenerate });
    assert.equal(miss.ok, false);
    assert.match(miss.failure ?? "", /unknown requirement|not found/i);
  } finally { await close(); }
});

test("generateForRequirement feeds the ALREADY IN THIS PROJECT completion context to the generator", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({ repoFullName: "a/b", defaultBranch: "main", installationId: 1, localClonePath: "/x" }).returning({ id: project.id });
    // Target requirement (no tasks → generation proceeds).
    const [target] = await db.insert(requirements).values({ key: "REQ-001", title: "Target", description: "d", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });
    // A DIFFERENT requirement that already has a completed task — should surface in the context.
    const [other] = await db.insert(requirements).values({ key: "REQ-002", title: "Other", description: "d", provenance: "imported", projectId: p.id }).returning({ id: requirements.id });
    await db.insert(tasks).values({ key: "TASK-009", title: "Already done", body: "b", requirementId: other.id, effort: 1, risk: "low", confidence: 50, projectId: p.id, githubStatus: "closed" });

    let captured = "";
    const capturing: typeof import("./run").generateTasks = async (args) => {
      captured = args.userMessage;
      return { ok: false, failure: "captured", usage: null }; // short-circuit before persist
    };

    const r = await generateForRequirement(db, target.id, { generate: capturing });
    assert.equal(r.ok, false);
    assert.ok(captured.includes("## ALREADY IN THIS PROJECT"), "completion section present");
    assert.ok(captured.includes("TASK-009 [closed] — Already done → REQ-002"), "existing closed task surfaced");
  } finally {
    await close();
  }
});

test("generateForRequirement passes the project's context pins as the slice includes", async () => {
  const { db, close } = await createTestDb();
  try {
    const [p] = await db.insert(project).values({
      repoFullName: "o/r", installationId: 1, defaultBranch: "main",
      localClonePath: "/nonexistent", specPath: "SPEC.md", claudeMdPath: "CLAUDE.md",
      contextPins: ["src/db/events.ts", "src/db/schema.ts"],
    }).returning({ id: project.id });
    const [req] = await db.insert(requirements).values({
      key: "REQ-001", title: "Add a leaderboard", description: "top scorers", provenance: "imported", projectId: p.id,
    }).returning({ id: requirements.id });

    let capturedIncludes: string[] | undefined;
    const recordingSlice = (o: BuildSliceOptions) => {
      capturedIncludes = o.includes;
      return { repoLabel: "r", fileCount: 0, nearEmpty: true, tree: "", treeTruncated: false, files: [], omitted: [] };
    };

    const r = await generateForRequirement(db, req.id, { generate: fakeGenerate, buildSlice: recordingSlice });
    assert.equal(r.ok, true, `generation should succeed: ${r.failure}`);
    assert.deepEqual(capturedIncludes, ["src/db/events.ts", "src/db/schema.ts"]);
  } finally {
    await close();
  }
});
