import { getDb } from "@/db/client";
import { getLatestNarrative } from "@/narrative/queries";
import { Empty, buttonClass } from "@/components/ui";
import { regenerate } from "./actions";
import { activeProjectId } from "@/project/current";
import { RoadmapFrame } from "./roadmap-frame";

export async function NarrativePanel() {
  const pid = await activeProjectId();
  const n = await getLatestNarrative(getDb(), pid);

  return (
    <>
      {!n ? (
        <Empty title="No narrative yet.">Generate one and the project&apos;s history is written from the event log.</Empty>
      ) : (
        <>
          {n.roadmapHtml && <RoadmapFrame html={n.roadmapHtml} />}
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
        </>
      )}
      <form action={regenerate} className="mt-4">
        <button type="submit" className={buttonClass(n ? "quiet" : "primary")}>
          {n ? "Regenerate" : "Generate"}
        </button>
      </form>
    </>
  );
}
