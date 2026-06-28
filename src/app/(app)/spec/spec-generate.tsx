"use client";

import { useActionState, useEffect, useState } from "react";
import { generateTasksForRequirement, pollRequirementTasks, type GenState, type GenTask } from "./[key]/actions";
import { SpecClaimButton } from "./spec-claim-button";
import { buttonClass, Pill } from "@/components/ui";

export function SpecGenerate({ reqKey }: { reqKey: string }) {
  const [state, action, pending] = useActionState<GenState, FormData>(generateTasksForRequirement, null);
  const [visible, setVisible] = useState<GenTask[]>([]);

  // After a successful generate, poll for the requirement's visible tasks (those
  // whose GitHub issue the worker has created) and reveal them as they land.
  useEffect(() => {
    if (!state?.ok) return;
    setVisible(state.tasks);
    const expected = state.generatedKeys;
    let stopped = false;
    let polls = 0;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const MAX_POLLS = 60; // ~3 min at 3s — then leave it to a refresh (trust the worker).

    async function tick() {
      if (stopped) return;
      const tasks = await pollRequirementTasks(reqKey);
      if (stopped) return;
      setVisible(tasks);
      polls += 1;
      const allVisible = expected.every((k) => tasks.some((t) => t.key === k));
      if (allVisible || polls >= MAX_POLLS) return;
      timerId = setTimeout(tick, 3000);
    }
    timerId = setTimeout(tick, 3000);
    return () => {
      stopped = true;
      clearTimeout(timerId);
    };
  }, [state, reqKey]);

  const allVisible = state?.ok && state.generatedKeys.length > 0 ? state.generatedKeys.every((k) => visible.some((t) => t.key === k)) : false;

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
          <p className="text-[13px] text-ink-soft">
            {allVisible
              ? `Generated ${state.generatedKeys.length} task(s) — claim what you'll work on:`
              : `Generated ${state.generatedKeys.length} task(s) — creating their GitHub issues… they'll appear as each is ready.`}
          </p>
          {visible.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2">
              {visible.map((t) => (
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
          )}
        </div>
      )}
    </div>
  );
}
