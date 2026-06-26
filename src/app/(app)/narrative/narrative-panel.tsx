import { getDb } from "@/db/client";
import { getLatestNarrative } from "@/narrative/queries";
import { narrativeRegenPending } from "@/narrative/regen";
import { Empty, buttonClass } from "@/components/ui";
import { regenerate } from "./actions";
import { activeProjectId } from "@/project/current";
import { RoadmapFrame } from "./roadmap-frame";

export async function NarrativePanel() {
  const pid = await activeProjectId();
  const n = await getLatestNarrative(getDb(), pid);
  const pending = await narrativeRegenPending(getDb(), pid);

  return (
    <>
      {!n ? (
        <Empty title="No narrative yet.">Generate one and the project&apos;s history is written from the event log.</Empty>
      ) : (
        <>
          {n.roadmapHtml ? (
            <RoadmapFrame html={n.roadmapHtml} />
          ) : (
            <Empty title="Roadmap unavailable.">The last generation didn&apos;t produce a roadmap — regenerate to try again.</Empty>
          )}
          <footer className="mt-3 font-mono text-[11px] text-graphite">
            updated from {n.eventCount} events · {new Date(n.generatedAt).toLocaleString()}
          </footer>
        </>
      )}
      {pending && (
        <p className="mt-3 font-mono text-[11px] text-planned">Regenerating… queued for the next worker pass (~a minute); refresh to see it.</p>
      )}
      <form action={regenerate} className="mt-4">
        <button type="submit" disabled={pending} className={buttonClass(n ? "quiet" : "primary")}>
          {pending ? "Regenerating…" : n ? "Regenerate" : "Generate"}
        </button>
      </form>
    </>
  );
}
