"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { sendDigest } from "@/digest/send";

export async function sendNow() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await sendDigest(getDb());
  revalidatePath("/digest");
  revalidatePath("/dashboard");
}
