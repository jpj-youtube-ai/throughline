"use client";
import { useActionState } from "react";
import { syncClaudeMd, type SyncState } from "@/app/(app)/connect/actions";
import { buttonClass } from "@/components/ui";

export function SyncClaudeMdButton({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<SyncState, FormData>(syncClaudeMd, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="projectId" value={projectId} />
      <button type="submit" disabled={pending} className={buttonClass("quiet")}>
        {pending ? "Syncing…" : "Sync CLAUDE.md"}
      </button>
      {state?.ok === true && (
        <span className="text-xs text-shipped">
          {state.status === "synced" ? "✓ synced + pushed" : "already synced"}
        </span>
      )}
      {state?.ok === false && <span className="text-xs text-risk">{state.error}</span>}
    </form>
  );
}
