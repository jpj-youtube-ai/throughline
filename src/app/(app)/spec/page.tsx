import { getDb } from "@/db/client";
import { listSpecMap, type SpecMapRequirement } from "@/spec/map";
import { PageHeader, Card, Pill, Empty, type Tone } from "@/components/ui";
import { SpecUpload } from "./spec-upload";

export const dynamic = "force-dynamic";

const STATUS_ORDER = ["shipped", "building", "planned"] as const;
const STATUS_LABEL: Record<string, string> = { shipped: "Shipped", building: "Building", planned: "Planned" };
const PROV_LABEL: Record<string, string> = { imported: "genesis", voted: "voted", drift: "drift" };
const PROV_TONE: Record<string, Tone> = { imported: "neutral", voted: "spine", drift: "risk" };

export default async function SpecPage() {
  const reqs = await listSpecMap(getDb());
  const shipped = reqs.filter((r) => r.status === "shipped").length;
  const groups = STATUS_ORDER.map((status) => ({ status, items: reqs.filter((r) => r.status === status) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <>
      <PageHeader
        eyebrow="Specification"
        title="Spec map"
        lede="Every requirement, its provenance, and the tasks that implement it — materialized from the log, never hand-edited."
      >
        {reqs.length > 0 && (
          <span className="font-mono text-xs text-graphite">
            <span className="text-shipped">{shipped}</span> / {reqs.length} shipped
          </span>
        )}
      </PageHeader>

      <SpecUpload alreadyImported={reqs.length > 0} count={reqs.length} />

      {reqs.length === 0 ? (
        <Empty title="No requirements yet.">Import the genesis spec, or approve an idea to declare the first one.</Empty>
      ) : (
        <div className="flex flex-col gap-10">
          {groups.map((g) => (
            <section key={g.status}>
              <div className="mb-4 flex items-center gap-2.5">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">
                  {STATUS_LABEL[g.status]}
                </h2>
                <span className="font-mono text-[11px] text-graphite">{g.items.length}</span>
                <div className="h-px flex-1 bg-hairline" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {g.items.map((r) => (
                  <ReqCard key={r.key} r={r} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function ReqCard({ r }: { r: SpecMapRequirement }) {
  const done = r.tasks.filter((t) => t.githubStatus === "closed").length;
  const shipped = r.status === "shipped";
  return (
    <Card id={r.key} className={`scroll-mt-24 p-4 ${shipped ? "border-l-2 border-l-shipped" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm text-spine-deep">{r.key}</span>
        <Pill tone={PROV_TONE[r.provenance] ?? "neutral"} dot={false}>
          {PROV_LABEL[r.provenance]}
        </Pill>
      </div>
      <h3 className="font-display mt-1 text-[15px] font-semibold text-ink">{r.title}</h3>
      {r.description && <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-graphite">{r.description}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-hairline pt-3">
        {r.tasks.length === 0 ? (
          <span className="font-mono text-[11px] text-graphite">no tasks yet</span>
        ) : (
          <>
            {r.tasks.map((t) => (
              <a
                key={t.key}
                href="/tasks"
                title={`${t.key} · ${t.githubStatus}${t.claimState === "claimed" ? " · claimed" : ""}`}
                className="inline-flex items-center gap-1.5 rounded bg-paper-sunk px-2 py-0.5 font-mono text-[11px] text-ink transition-colors hover:bg-spine-wash"
              >
                <span className={`size-1.5 rounded-full ${t.githubStatus === "closed" ? "bg-shipped" : "bg-graphite"}`} />
                {t.key}
              </a>
            ))}
            <span className="ml-auto font-mono text-[11px] text-graphite">
              {done}/{r.tasks.length}
            </span>
          </>
        )}
      </div>
    </Card>
  );
}
