import { Fragment } from "react";
import { getDb } from "@/db/client";
import { listPipeline } from "@/pipeline/queries";

export async function PipelinePanel() {
  const stages = await listPipeline(getDb());
  const total = stages.reduce((n, s) => n + s.count, 0);

  return (
    <>
      {total === 0 ? (
        <p className="rounded-leaf border border-dashed border-hairline bg-paper-raised/50 px-6 py-14 text-center font-display text-lg text-ink">
          The pipeline is empty.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {stages.map((s, i) => (
            <Fragment key={s.key}>
              <section className="rounded-leaf border border-hairline bg-paper-raised p-4">
                <div className="flex items-baseline justify-between">
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-graphite">{s.label}</h2>
                  <span className={`font-display text-2xl font-bold ${s.count > 0 ? "text-spine-deep" : "text-hairline"}`}>
                    {s.count}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-graphite">{s.hint}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.items.map((it, j) => (
                    <a
                      key={`${it.label}-${j}`}
                      href={it.href}
                      title={it.label}
                      className="max-w-full truncate rounded bg-paper-sunk px-2 py-0.5 font-mono text-[11px] text-ink transition-colors hover:bg-spine-wash"
                    >
                      {it.label}
                    </a>
                  ))}
                </div>
              </section>
              {i < stages.length - 1 && (
                <div className="flex justify-center text-hairline" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}
