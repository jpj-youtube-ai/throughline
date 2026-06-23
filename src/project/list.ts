import { asc } from "drizzle-orm";
import type { Db } from "../db/client";
import { project } from "../db/schema";

export async function listProjects(
  db: Db,
): Promise<{ id: string; repoFullName: string; defaultBranch: string }[]> {
  return db
    .select({ id: project.id, repoFullName: project.repoFullName, defaultBranch: project.defaultBranch })
    .from(project)
    .orderBy(asc(project.createdAt));
}

export async function listProjectsWithPins(
  db: Db,
): Promise<{ id: string; repoFullName: string; defaultBranch: string; localClonePath: string; contextPins: string[] }[]> {
  return db
    .select({
      id: project.id,
      repoFullName: project.repoFullName,
      defaultBranch: project.defaultBranch,
      localClonePath: project.localClonePath,
      contextPins: project.contextPins,
    })
    .from(project)
    .orderBy(asc(project.createdAt));
}
