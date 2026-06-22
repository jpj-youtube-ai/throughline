"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { materializeSpec } from "@/spec/materialize";
import { activeProjectId } from "@/project/current";

export async function rematerialize() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  const pid = await activeProjectId();
  await materializeSpec(getDb(), pid);
  revalidatePath("/reconcile");
  revalidatePath("/dashboard");
}
