import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { events, project } from "@/db/schema";
import { scheduleToDays } from "@/digest/send";
import { Card, Pill, Empty, buttonClass } from "@/components/ui";
import { sendNow } from "./actions";

const DAY = 86_400_000;

export async function DigestPanel() {
  const db = getDb();
  const [proj] = await db.select().from(project).limit(1);
  const [last] = await db
    .select({ at: events.createdAt, payload: events.payload })
    .from(events)
    .where(eq(events.type, "digest.sent"))
    .orderBy(desc(events.createdAt))
    .limit(1);

  const days = scheduleToDays(proj?.digestSchedule);
  const configured = Boolean(proj?.digestWebhookUrl);
  const lastText = (last?.payload as { text?: string } | undefined)?.text ?? null;

  let nextDue = "—";
  if (days != null) {
    if (!last) nextDue = "due now";
    else nextDue = new Date(last.at.getTime() + days * DAY).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  return (
    <>
      {configured && (
        <form action={sendNow} className="mb-4">
          <button type="submit" className={buttonClass("primary")}>
            Send now
          </button>
        </form>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">webhook</div>
          <div className="mt-2">
            {configured ? <Pill tone="shipped">configured</Pill> : <Pill tone="planned">not set</Pill>}
          </div>
        </Card>
        <Card className="p-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">schedule</div>
          <div className="mt-2 font-mono text-sm text-ink">
            {days != null ? `every ${days}d` : "not scheduled"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">next due</div>
          <div className="mt-2 font-mono text-sm text-ink">{nextDue}</div>
        </Card>
      </div>

      {!configured && (
        <p className="mb-6 max-w-prose text-sm text-graphite">
          Set a webhook URL and schedule on the project to enable the digest. Until then it stays inert — nothing is
          sent.
        </p>
      )}

      <h2 className="font-mono mb-3 text-[11px] uppercase tracking-[0.18em] text-graphite">Last digest</h2>
      {last ? (
        <Card className="p-5">
          <div className="font-mono text-xs text-graphite">
            sent {new Date(last.at).toLocaleString()} · {(last.payload as { event_count?: number }).event_count ?? 0}{" "}
            decisions
          </div>
          <p className="font-serif mt-3 max-w-prose text-[15px] leading-[1.7] text-ink">{lastText}</p>
        </Card>
      ) : (
        <Empty title="No digest sent yet.">
          {configured ? "The next scheduled run will post the first one." : "Configure a webhook to start sending."}
        </Empty>
      )}
    </>
  );
}
