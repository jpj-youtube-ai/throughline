import { getDb } from "@/db/client";
import { getRequirementDetail } from "@/spec/detail";
import { activeProjectId } from "@/project/current";
import { Pill, Empty, type Tone } from "@/components/ui";
import { SpecGenerate } from "./spec-generate";

const STATUS_LABEL: Record<string, string> = { shipped: "shipped", building: "in progress", planned: "not started" };
const PROV_LABEL: Record<string, string> = { imported: "genesis", voted: "voted", drift: "drift" };
const PROV_TONE: Record<string, Tone> = { imported: "neutral", voted: "spine", drift: "risk" };

export async function RequirementDetail({ reqKey }: { reqKey: string }) {
  const pid = await activeProjectId();
  const r = await getRequirementDetail(getDb(), pid, reqKey);
  if (!r) return <Empty title="Unknown requirement.">No requirement with key {reqKey}.</Empty>;

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-spine-deep">{r.key}</span>
        <Pill tone={PROV_TONE[r.provenance] ?? "neutral"} dot={false}>{PROV_LABEL[r.provenance]}</Pill>
        <span className="ml-auto font-mono text-[11px] uppercase tracking-wide text-graphite">{STATUS_LABEL[r.status] ?? r.status}</span>
      </div>
      <h2 className="font-display mt-2 text-lg font-semibold text-ink">{r.title}</h2>
      {r.description && <p className="font-serif mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-soft">{r.description}</p>}

      <div className="mt-5 border-t border-hairline pt-4">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">Tasks</h3>
        {r.tasks.length === 0 ? (
          <SpecGenerate reqKey={r.key} />
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {r.tasks.map((t) => (
              <li key={t.key} className="flex items-center gap-2 text-[13px]">
                <span className={`size-1.5 rounded-full ${t.githubStatus === "closed" ? "bg-shipped" : "bg-graphite"}`} />
                <span className="font-mono text-spine-deep">{t.key}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{t.title}</span>
                {t.claimState === "claimed" && <Pill tone="spine" dot={false}>claimed</Pill>}
                {t.githubIssueUrl && (
                  <a href={t.githubIssueUrl} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-spine-deep hover:underline">issue ↗</a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
