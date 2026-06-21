"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { materializeNarrative } from "@/narrative/materialize";

export async function regenerate() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await materializeNarrative(getDb());
  revalidatePath("/narrative");
  revalidatePath("/dashboard");
}
