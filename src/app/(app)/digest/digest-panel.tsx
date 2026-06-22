import { getDb } from "@/db/client";
import { recentDigests } from "@/digest/queries";
import { Card, Empty, buttonClass } from "@/components/ui";
import { generate } from "./actions";
import { activeProjectId } from "@/project/current";

export async function DigestPanel() {
  const pid = await activeProjectId();
  const db = getDb();
  const digests = await recentDigests(db, pid, 10);
  const [latest, ...older] = digests;

  return (
    <>
      <form action={generate} className="mb-6">
        <button type="submit" className={buttonClass("primary")}>
          Generate digest
        </button>
      </form>

      <h2 className="font-mono mb-3 text-[11px] uppercase tracking-[0.18em] text-graphite">Latest digest</h2>
      {latest ? (
        <Card className="p-5">
          <div className="font-mono text-xs text-graphite">
            generated {new Date(latest.at).toLocaleString()} · {latest.eventCount} decisions
          </div>
          <p className="font-serif mt-3 max-w-prose text-[15px] leading-[1.7] text-ink">{latest.text}</p>
        </Card>
      ) : (
        <Empty title="No digest yet.">Generate one to summarise what has moved since the project began.</Empty>
      )}

      {older.length > 0 && (
        <>
          <h2 className="font-mono mb-3 mt-8 text-[11px] uppercase tracking-[0.18em] text-graphite">Earlier digests</h2>
          <div className="grid gap-3">
            {older.map((d) => (
              <Card key={d.at.toISOString()} className="p-4">
                <div className="font-mono text-xs text-graphite">
                  {new Date(d.at).toLocaleString()} · {d.eventCount} decisions
                </div>
                <p className="font-serif mt-2 max-w-prose text-[14px] leading-[1.7] text-ink">{d.text}</p>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
