import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
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
 * When projectId is given, the lookup is scoped to that project.
 */
export async function readSpec(db: Db, projectId?: string): Promise<SpecDoc> {
  const [proj] = await db
    .select()
    .from(project)
    .where(projectId ? eq(project.id, projectId) : undefined)
    .limit(1);
  if (!proj) return { content: null, path: null };
  const file = path.join(proj.localClonePath, proj.specPath);
  try {
    return { content: fs.readFileSync(file, "utf8"), path: proj.specPath };
  } catch {
    return { content: null, path: proj.specPath };
  }
}
