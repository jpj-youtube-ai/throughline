"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { generateDigest } from "@/digest/send";
import { activeProjectId } from "@/project/current";

export async function generate() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  const pid = await activeProjectId();
  await generateDigest(getDb(), { projectId: pid });
  revalidatePath("/digest");
  revalidatePath("/dashboard");
}
