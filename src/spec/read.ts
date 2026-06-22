import fs from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { project } from "../db/schema";

export interface SpecDoc {
  content: string | null;
  path: string | null;
}

/**
 * Read the materialized spec document from the bound project's local clone
 * (REQ-017 surface). Read-only — surfaces an existing artifact, no state change,
 * no event. Returns null content when no project is bound or the file does not
 * exist yet (e.g. before the first materialize); never throws on a missing file.
 * When projectId is given, the lookup is scoped to that project's clone; otherwise
 * defaults to the oldest project.
 */
export async function readSpec(db: Db, projectId?: string): Promise<SpecDoc> {
  let proj: { localClonePath: string; specPath: string } | undefined;
  if (projectId) {
    const [p] = await db.select({ localClonePath: project.localClonePath, specPath: project.specPath }).from(project).where(eq(project.id, projectId)).limit(1);
    proj = p;
  } else {
    const [p] = await db.select({ localClonePath: project.localClonePath, specPath: project.specPath }).from(project).orderBy(asc(project.createdAt)).limit(1);
    proj = p;
  }
  if (!proj) return { content: null, path: null };
  const file = path.join(proj.localClonePath, proj.specPath);
  try {
    return { content: fs.readFileSync(file, "utf8"), path: proj.specPath };
  } catch {
    return { content: null, path: proj.specPath };
  }
}
