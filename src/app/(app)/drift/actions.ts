"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { resolveDrift, type DriftResolution } from "@/drift/flag";

export async function resolve(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await resolveDrift(getDb(), {
    flagId: String(formData.get("flagId")),
    resolution: String(formData.get("resolution")) as DriftResolution,
    resolvedBy: session.user.id,
    rationale: String(formData.get("rationale") ?? ""),
    newReqTitle: String(formData.get("newReqTitle") ?? "") || undefined,
    relinkReqKey: String(formData.get("relinkReqKey") ?? "") || undefined,
  });
  revalidatePath("/drift");
  revalidatePath("/dashboard");
}
