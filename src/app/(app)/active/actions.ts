"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { users, project } from "@/db/schema";

export async function setActiveProject(projectId: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  // guard: the project must exist (don't let a user point at a deleted/foreign id)
  const [p] = await getDb()
    .select({ id: project.id })
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!p) throw new Error("Unknown project.");
  await getDb()
    .update(users)
    .set({ activeProjectId: projectId })
    .where(eq(users.id, session.user.id));
  revalidatePath("/", "layout");
}
