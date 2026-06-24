"use server";

import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { activeProjectId } from "@/project/current";
import { reviewWhyQuality, type WhyReview } from "@/quality/review";

export type ReviewState = WhyReview | null;

/**
 * Run the why-quality LLM grading pass on demand (REQ-027), scoped to the
 * signed-in user's active project. Used via useActionState so the (≈10s) pass
 * shows a pending state and renders its result in place — including in the drawer.
 */
export async function runWhyReview(_prev: ReviewState, _formData: FormData): Promise<ReviewState> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, failure: "Not signed in." };
  const projectId = await activeProjectId();
  return reviewWhyQuality(getDb(), projectId);
}
