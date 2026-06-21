"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { generateDigest } from "@/digest/send";

export async function generate() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await generateDigest(getDb());
  revalidatePath("/digest");
  revalidatePath("/dashboard");
}
