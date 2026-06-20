import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { submitIdea } from "@/ideas/submit";
import { PageHeader, Field, fieldClass, buttonClass } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewIdeaPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <PageHeader eyebrow="Intake" title="Submit an idea" lede="Please sign in to submit an idea." />
    );
  }

  async function submit(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user?.id) throw new Error("Not signed in.");
    const feasibilityRaw = formData.get("feasibility");
    const viabilityRaw = formData.get("viability");
    const state = formData.get("intent") === "scratch" ? "scratch" : "voting";
    await submitIdea(getDb(), {
      title: String(formData.get("title") ?? ""),
      why: String(formData.get("why") ?? ""),
      feasibility: feasibilityRaw ? Number(feasibilityRaw) : null,
      viability: viabilityRaw ? Number(viabilityRaw) : null,
      authorId: s.user.id,
      state,
    });
    redirect("/ideas");
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        eyebrow="Intake"
        title="New idea"
        lede="Lead with the why — the pitch is what the team votes on, and it is logged with the idea forever. Save it to scratch to keep refining, or open it for voting now."
      />
      <form action={submit} className="grid gap-5">
        <Field label="Title">
          <input name="title" required className={fieldClass} />
        </Field>
        <Field label="Why — the pitch (required)">
          <textarea name="why" required rows={5} className={fieldClass} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Feasibility (1–10)">
            <input name="feasibility" type="number" min={1} max={10} className={fieldClass} />
          </Field>
          <Field label="Viability (1–10)">
            <input name="viability" type="number" min={1} max={10} className={fieldClass} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" name="intent" value="voting" className={buttonClass("primary")}>
            Open for voting
          </button>
          <button type="submit" name="intent" value="scratch" className={buttonClass("quiet")}>
            Save as scratch
          </button>
          <a href="/ideas" className="ml-1 text-sm text-graphite hover:text-ink">
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
