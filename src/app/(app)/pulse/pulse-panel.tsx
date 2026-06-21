import { getDb } from "@/db/client";
import { listActivity, type ActivityItem } from "@/events/feed";
import { Empty, Field, fieldClass, buttonClass } from "@/components/ui";
import { logWork } from "./actions";

function relTime(d: Date): string {
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayLabel(d: Date): string {
  const diff = (startOfDay(new Date()) - startOfDay(d)) / 86_400_000;
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

export async function PulsePanel() {
  const items = await listActivity(getDb());

  const groups: { label: string; items: ActivityItem[] }[] = [];
  for (const it of items) {
    const label = dayLabel(it.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(it);
    else groups.push({ label, items: [it] });
  }

  return (
    <>
      <details className="group mb-8 rounded-leaf border border-hairline bg-paper-raised">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm text-graphite hover:text-ink">
          <span className="font-mono text-spine transition-transform group-open:rotate-45">+</span>
          Log work done off-platform
        </summary>
        <form action={logWork} className="grid gap-3 border-t border-hairline p-4">
          <p className="text-[13px] text-graphite">
            Something happen outside the flow? Record it so the history stays whole. The why is kept with it.
          </p>
          <Field label="What was done">
            <input name="summary" required className={fieldClass} placeholder="e.g. Hotfixed the prod migration by hand" />
          </Field>
          <Field label="Why — required">
            <textarea name="rationale" required rows={2} className={fieldClass} />
          </Field>
          <Field label="Related task (optional)">
            <input name="taskKey" className={fieldClass} placeholder="TASK-NNN" />
          </Field>
          <button type="submit" className={`${buttonClass("primary")} justify-self-start`}>
            Log it
          </button>
        </form>
      </details>

      {items.length === 0 ? (
        <Empty title="Nothing has happened yet.">
          Bind a repo and submit an idea — the log fills in here as decisions are made.
        </Empty>
      ) : (
        <div className="flex flex-col gap-10">
          {groups.map((g) => (
            <section key={`${g.label}-${g.items[0].seq}`}>
              <h2 className="font-mono mb-4 text-[11px] uppercase tracking-[0.18em] text-graphite">{g.label}</h2>
              <ol className="spine flex flex-col gap-5">
                {g.items.map((it) => (
                  <li key={it.seq} className="spine-node" data-kind={it.kind}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm text-ink">
                        <span className="font-medium">{it.actor ?? "system"}</span>{" "}
                        <span className="text-graphite">{it.verb}</span>{" "}
                        {it.subject && <span className="font-mono text-spine-deep">{it.subject}</span>}
                      </span>
                      <span className="font-mono ml-auto text-xs text-graphite">{relTime(it.createdAt)}</span>
                    </div>
                    {it.why && (
                      <p className="font-serif mt-1 max-w-prose text-[13px] italic text-ink-soft">{it.why}</p>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
