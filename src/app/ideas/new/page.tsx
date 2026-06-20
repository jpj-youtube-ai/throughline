import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { submitIdea } from "@/ideas/submit";

export const dynamic = "force-dynamic";

export default async function NewIdeaPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main style={{ padding: 32 }}>
        <p>
          Please <a href="/">sign in</a> to submit an idea.
        </p>
      </main>
    );
  }

  async function submit(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user?.id) throw new Error("Not signed in.");
    const feasibilityRaw = formData.get("feasibility");
    const viabilityRaw = formData.get("viability");
    await submitIdea(getDb(), {
      title: String(formData.get("title") ?? ""),
      why: String(formData.get("why") ?? ""),
      feasibility: feasibilityRaw ? Number(feasibilityRaw) : null,
      viability: viabilityRaw ? Number(viabilityRaw) : null,
      authorId: s.user.id,
    });
    redirect("/ideas");
  }

  return (
    <main style={{ padding: 32, maxWidth: 640 }}>
      <h1>Submit an idea</h1>
      <form action={submit} style={{ display: "grid", gap: 12 }}>
        <label>
          Title
          <br />
          <input name="title" required style={{ width: "100%" }} />
        </label>
        <label>
          Why — the pitch (required)
          <br />
          <textarea name="why" required rows={4} style={{ width: "100%" }} />
        </label>
        <label>
          Feasibility (1–10)
          <br />
          <input name="feasibility" type="number" min={1} max={10} />
        </label>
        <label>
          Viability (1–10)
          <br />
          <input name="viability" type="number" min={1} max={10} />
        </label>
        <button type="submit" style={{ justifySelf: "start" }}>
          Submit
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        <a href="/ideas">← Ideas in voting</a>
      </p>
    </main>
  );
}
