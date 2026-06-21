"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { castVote } from "@/ideas/vote";
import { promoteIdea } from "@/ideas/scratch";

async function revalidate() {
  revalidatePath("/ideas");
  revalidatePath("/dashboard"); // keep the dashboard's Ideas card in sync
}

export async function approve(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await castVote(getDb(), String(formData.get("ideaId")), session.user.id);
  await revalidate();
}

export async function promote(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await promoteIdea(getDb(), String(formData.get("ideaId")), session.user.id);
  await revalidate();
}
