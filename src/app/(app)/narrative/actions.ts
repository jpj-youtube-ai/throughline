"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { activeProjectId } from "@/project/current";
import { requestNarrative } from "@/narrative/regen";

export async function regenerate() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await requestNarrative(getDb(), { projectId: await activeProjectId(), actorId: session.user.id });
  revalidatePath("/narrative");
  revalidatePath("/dashboard");
}
