"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { logWorkRetroactively } from "@/work/retroactive";

export async function logWork(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await logWorkRetroactively(getDb(), {
    summary: String(formData.get("summary") ?? ""),
    rationale: String(formData.get("rationale") ?? ""),
    taskKey: String(formData.get("taskKey") ?? "") || null,
    actorId: session.user.id,
  });
  revalidatePath("/pulse");
  revalidatePath("/dashboard");
}
