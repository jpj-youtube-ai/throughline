import Link from "next/link";
import type { SpecMapRequirement } from "@/spec/map";

// REQ-017 spec map as a status grid: one cell per requirement, color-coded by
// status, with a legend. Shipped = verdigris, building = amber, planned = dim.
const STATUS_LABEL: Record<string, string> = { shipped: "shipped", building: "in progress", planned: "not started" };

function cellClass(status: string): string {
  if (status === "shipped") return "border-spine bg-spine-wash text-spine-deep hover:bg-spine-wash/70";
  if (status === "building") return "border-planned bg-planned-wash text-planned hover:bg-planned-wash/70";
  return "border-dashed border-hairline text-graphite hover:border-spine/40"; // planned / not started
}

function reqNum(key: string): string {
  return key.replace(/^REQ-/, "");
}

export function SpecGrid({ reqs }: { reqs: SpecMapRequirement[] }) {
  const shipped = reqs.filter((r) => r.status === "shipped").length;
  const building = reqs.filter((r) => r.status === "building").length;
  const planned = reqs.filter((r) => r.status === "planned").length;
  const first = reqs[0]?.key;
  const last = reqs[reqs.length - 1]?.key;

  return (
    <section className="rounded-leaf border border-hairline bg-paper-raised p-5">
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-hairline pb-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">
          Spec map · {reqs.length} requirements
        </span>
        {first && (
          <span className="font-mono text-[11px] text-graphite">
            {first} … {last}
          </span>
        )}
      </div>

      <div className="grid grid-cols-6 gap-2.5 sm:grid-cols-8">
        {reqs.map((r) => {
          const merged = r.tasks.filter((t) => t.githubStatus === "closed").length;
          return (
            <Link
              key={r.key}
              href={`/spec/${r.key}`}
              aria-label={`${r.key} ${r.title} · ${STATUS_LABEL[r.status] ?? r.status}`}
              className={`group relative flex aspect-square items-end rounded-md border p-2 transition-colors ${cellClass(r.status)}`}
            >
              {(r.status === "shipped" || r.status === "building") && (
                <span
                  className={`absolute right-1.5 top-1.5 size-1.5 rounded-full ${r.status === "shipped" ? "bg-spine" : "bg-planned"}`}
                />
              )}
              <span className="font-mono text-[11px]">{reqNum(r.key)}</span>

              {/* Hover card — appears instantly with the requirement's details */}
              <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-60 max-w-[70vw] -translate-x-1/2 text-left group-hover:block">
                <div className="rounded-leaf border border-hairline bg-paper-raised p-3 shadow-xl">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-spine-deep">{r.key}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-graphite">
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </div>
                  <div className="font-display mt-1 text-[13px] font-semibold text-ink">{r.title}</div>
                  {r.description && (
                    <p className="mt-1 line-clamp-4 text-[11px] leading-relaxed text-graphite">{r.description}</p>
                  )}
                  <div className="mt-2 border-t border-hairline pt-2 font-mono text-[10px] text-graphite">
                    {r.tasks.length === 0 ? "no tasks yet" : `${merged}/${r.tasks.length} tasks merged`}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 font-mono text-[11px] text-graphite">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border border-spine bg-spine-wash" /> shipped ({shipped})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border border-planned bg-planned-wash" /> in progress ({building})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border border-dashed border-hairline" /> not started ({planned})
        </span>
      </div>
    </section>
  );
}
