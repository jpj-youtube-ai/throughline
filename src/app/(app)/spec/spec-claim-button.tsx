"use client";

import { useActionState } from "react";
import { claimFromSpec, type ClaimState } from "./[key]/actions";
import { buttonClass } from "@/components/ui";

export function SpecClaimButton({ taskId, reqKey }: { taskId: string; reqKey: string }) {
  const [state, action, pending] = useActionState<ClaimState, FormData>(claimFromSpec, null);

  if (state?.ok === true) {
    return (
      <span className="shrink-0 font-mono text-[11px] text-shipped">
        {state.branchCreated ? "claimed" : "claimed · branch retrying"}
      </span>
    );
  }

  return (
    <form action={action} className="shrink-0">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="key" value={reqKey} />
      <button type="submit" disabled={pending} className={buttonClass("quiet")}>
        {pending ? "Claiming…" : "Claim"}
      </button>
      {state?.ok === false && <span className="ml-2 text-[11px] text-risk">{state.error}</span>}
    </form>
  );
}
