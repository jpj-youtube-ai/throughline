import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { getLatestNarrative } from "@/narrative/queries";
import { materializeNarrative } from "@/narrative/materialize";
import { PageHeader, Empty, buttonClass } from "@/components/ui";

export const dynamic = "force-dynamic";

async function regenerate() {
  "use server";
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await materializeNarrative(getDb());
  revalidatePath("/narrative");
}

export default async function NarrativePage() {
  const n = await getLatestNarrative(getDb());

  return (
    <>
      <PageHeader
        eyebrow="History"
        title="Narrative"
        lede="The story so far, told from the log — grounded in real decisions, never invented. Regenerated on demand."
      >
        <form action={regenerate}>
          <button type="submit" className={buttonClass(n ? "quiet" : "primary")}>
            {n ? "Regenerate" : "Generate"}
          </button>
        </form>
      </PageHeader>

      {!n ? (
        <Empty title="No narrative yet.">Generate one and the project&apos;s history is written from the event log.</Empty>
      ) : (
        <article className="spine flex flex-col gap-8">
          {n.content.chapters.map((c, i) => (
            <section key={i} className="spine-node">
              <h2 className="font-display text-lg font-semibold text-ink">{c.heading}</h2>
              <p className="font-serif mt-2 max-w-prose text-[15px] leading-[1.7] text-ink-soft">{c.prose}</p>
              {c.refs.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
                  {c.refs.map((r) => (
                    <span key={r} className="font-mono text-[11px] text-spine-deep">
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </section>
          ))}
          <footer className="font-mono text-[11px] text-graphite">
            woven from {n.eventCount} events · {new Date(n.generatedAt).toLocaleString()}
          </footer>
        </article>
      )}
    </>
  );
}
