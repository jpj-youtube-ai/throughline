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
        {reqs.map((r) => (
          <div
            key={r.key}
            title={`${r.key} — ${r.title} · ${STATUS_LABEL[r.status] ?? r.status}`}
            className={`relative flex aspect-square cursor-default items-end rounded-md border p-2 transition-colors ${cellClass(r.status)}`}
          >
            {(r.status === "shipped" || r.status === "building") && (
              <span
                className={`absolute right-1.5 top-1.5 size-1.5 rounded-full ${r.status === "shipped" ? "bg-spine" : "bg-planned"}`}
              />
            )}
            <span className="font-mono text-[11px]">{reqNum(r.key)}</span>
          </div>
        ))}
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
