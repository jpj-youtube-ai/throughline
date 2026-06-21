"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { materializeSpec } from "@/spec/materialize";

export async function rematerialize() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await materializeSpec(getDb());
  revalidatePath("/reconcile");
  revalidatePath("/dashboard");
}
