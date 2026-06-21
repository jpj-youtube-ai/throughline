"use client";

import { useActionState } from "react";
import { generateTasksForRequirement, type GenState } from "./[key]/actions";
import { buttonClass } from "@/components/ui";

export function SpecGenerate({ reqKey }: { reqKey: string }) {
  const [state, action, pending] = useActionState<GenState, FormData>(generateTasksForRequirement, null);
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="key" value={reqKey} />
      <button type="submit" disabled={pending} className={buttonClass("primary")}>
        {pending ? "Generating…" : "Generate tasks"}
      </button>
      {state?.ok === true && <p className="mt-2 text-[13px] text-shipped">Generated {state.taskKeys.length} task(s) — refresh to see them.</p>}
      {state?.ok === false && <p className="mt-2 text-[13px] text-risk">{state.error}</p>}
      <p className="mt-1 text-[11px] text-graphite">Runs one generation pass against the bound repo and opens a GitHub issue per task.</p>
    </form>
  );
}
