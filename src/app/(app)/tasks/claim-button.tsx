"use client";

import { useActionState } from "react";
import { claim, type ClaimState } from "./actions";
import { buttonClass } from "@/components/ui";

export function ClaimButton({ taskId }: { taskId: string }) {
  const [state, action, pending] = useActionState<ClaimState, FormData>(claim, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      <button type="submit" disabled={pending} className={buttonClass("primary")}>
        {pending ? "Claiming…" : "Claim"}
      </button>
      {state?.ok === true && !state.branchCreated && (
        <span className="text-xs text-risk">claimed · branch not created — it&apos;ll retry</span>
      )}
      {state?.ok === false && <span className="text-xs text-risk">{state.error}</span>}
    </form>
  );
}
