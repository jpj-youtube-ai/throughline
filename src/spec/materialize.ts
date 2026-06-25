import fs from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { project } from "../db/schema";
import { emitEvent } from "../db/events";
import { buildSpecContent } from "./content";
import { commitFileInClone, pushClone, syncCloneToRemote } from "../github/commit";

export interface MaterializeDeps {
  syncRemote?: typeof syncCloneToRemote;
  readFile?: (absPath: string) => string;
  commit?: typeof commitFileInClone;
  push?: typeof pushClone;
}

export interface MaterializeResult {
  status: "materialized" | "already-materialized";
  requirementCount: number;
  sha?: string;
}

/**
 * Materialize the spec (REQ-012): render the requirements projection, and — only
 * when it differs from the committed SPEC.md — reconcile the clone with the remote,
 * commit, push to the default branch, and emit spec.materialized (in-tx). Idempotent:
 * a no-op (no fetch/commit/push/event) when the projection already matches the clone.
 * Mirrors syncClaudeMdForProject. fs/commit/push/sync injectable for tests. When
 * projectId is omitted, defaults to the oldest project.
 */
export async function materializeSpec(
  db: Db,
  projectId?: string,
  deps: MaterializeDeps = {},
): Promise<MaterializeResult> {
  const cols = {
    id: project.id,
    localClonePath: project.localClonePath,
    specPath: project.specPath,
    repoFullName: project.repoFullName,
    installationId: project.installationId,
    defaultBranch: project.defaultBranch,
  };
  const [proj] = projectId
    ? await db.select(cols).from(project).where(eq(project.id, projectId)).limit(1)
    : await db.select(cols).from(project).orderBy(asc(project.createdAt)).limit(1);
  if (!proj) throw new Error("No project bound (REQ-002).");

  const syncRemote = deps.syncRemote ?? syncCloneToRemote;
  const readFile = deps.readFile ?? ((p: string) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } });
  const commit = deps.commit ?? commitFileInClone;
  const push = deps.push ?? pushClone;

  const { content, requirementCount } = await buildSpecContent(db, proj.id);
  const specFile = path.join(proj.localClonePath, proj.specPath);

  // Fast no-op: we are the sole writer of SPEC.md, so the local file reflects the
  // last pushed projection. If it already matches, skip the fetch entirely.
  if (content === readFile(specFile)) {
    return { status: "already-materialized", requirementCount };
  }

  // Differs — reconcile with the remote tip (kills divergence/clobber), then
  // re-check before committing (the remote may already carry the same content).
  await syncRemote(proj.localClonePath, proj.repoFullName, proj.installationId, proj.defaultBranch);
  if (content === readFile(specFile)) {
    return { status: "already-materialized", requirementCount };
  }

  const { sha } = commit(proj.localClonePath, proj.specPath, content, "[spec] materialize requirements");
  await push(proj.localClonePath, proj.repoFullName, proj.installationId, proj.defaultBranch);

  await db.transaction(async (tx) => {
    await emitEvent(tx, {
      type: "spec.materialized",
      subjectType: "project",
      payload: { count: requirementCount, commit_sha: sha },
      projectId: proj.id,
    });
  });
  return { status: "materialized", requirementCount, sha };
}
