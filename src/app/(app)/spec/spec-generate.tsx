"use client";

import { useActionState } from "react";
import { generateTasksForRequirement, type GenState } from "./[key]/actions";
import { SpecClaimButton } from "./spec-claim-button";
import { buttonClass, Pill } from "@/components/ui";

export function SpecGenerate({ reqKey }: { reqKey: string }) {
  const [state, action, pending] = useActionState<GenState, FormData>(generateTasksForRequirement, null);
  return (
    <div className="mt-3">
      <form action={action}>
        <input type="hidden" name="key" value={reqKey} />
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Generating…" : "Generate tasks"}
        </button>
        {state?.ok === false && <p className="mt-2 text-[13px] text-risk">{state.error}</p>}
        <p className="mt-1 text-[11px] text-graphite">Runs one generation pass against the bound repo and opens a GitHub issue per task.</p>
      </form>

      {state?.ok === true && (
        <div className="mt-3">
          <p className="text-[13px] text-ink-soft">Generated {state.tasks.length} task(s) — claim what you&apos;ll work on:</p>
          <ul className="mt-2 flex flex-col gap-2">
            {state.tasks.map((t) => (
              <li key={t.key} className="flex items-start gap-2 text-[13px]">
                <span className="shrink-0 font-mono text-spine-deep">{t.key}</span>
                <span className="min-w-0 flex-1 break-words text-ink">{t.title}</span>
                {t.claimState === "claimed" ? (
                  <span className="shrink-0"><Pill tone="spine" dot={false}>claimed</Pill></span>
                ) : (
                  <SpecClaimButton taskId={t.id} reqKey={reqKey} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
