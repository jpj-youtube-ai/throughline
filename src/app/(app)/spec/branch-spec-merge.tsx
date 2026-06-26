// src/app/(app)/spec/branch-spec-merge.tsx
"use client";

import { useActionState } from "react";
import { previewBranchSpec, commitBranchSpec, type BranchPreviewState, type BranchMergeState } from "./actions";
import { Card, Field, fieldClass, buttonClass } from "@/components/ui";

export function BranchSpecMerge() {
  const [preview, previewAction, previewing] = useActionState<BranchPreviewState, FormData>(previewBranchSpec, null);
  const [merged, mergeAction, merging] = useActionState<BranchMergeState, FormData>(commitBranchSpec, null);

  if (merged?.ok) {
    return (
      <Card className="mt-4 p-4">
        <p className="text-[13px] text-shipped">
          Added {merged.addedCount} requirement{merged.addedCount === 1 ? "" : "s"}
          {merged.addedKeys.length > 0 ? ` (${merged.addedKeys.join(", ")})` : ""}
          {merged.skippedCount > 0 ? ` · skipped ${merged.skippedCount} already on board` : ""}. SPEC.md rematerialises on the next worker tick.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mt-4 p-4">
      <form action={previewAction} className="grid gap-3">
        <p className="text-[13px] text-graphite">
          Merge a <span className="font-medium text-ink">branch spec</span> — upload or paste a Markdown file of <em>new</em>{" "}
          <span className="font-mono">REQ-NNN</span> requirements to fold into this board. You preview before anything is added.
        </p>
        <Field label="Branch spec (.md)">
          <input type="file" name="file" accept=".md,.markdown,text/markdown,text/plain" className={fieldClass} />
        </Field>
        <Field label="…or paste it">
          <textarea name="text" rows={6} className={fieldClass} placeholder="**REQ-031 — New thing.** description…" />
        </Field>
        <button type="submit" disabled={previewing} className={`${buttonClass("quiet")} justify-self-start`}>
          {previewing ? "Reading…" : "Preview"}
        </button>
        {preview?.ok === false && <p className="text-[13px] text-risk">{preview.error}</p>}
      </form>

      {preview?.ok && (
        <div className="mt-4 grid gap-3 border-t border-hairline pt-4">
          <p className="text-[13px] text-graphite">
            <span className="font-medium text-ink">{preview.toAdd.length}</span> to add
            {preview.toSkip.length > 0 && (
              <>
                {" "}· <span className="font-medium text-ink">{preview.toSkip.length}</span> already on board (will be skipped)
              </>
            )}
            .
          </p>
          {preview.toAdd.length > 0 && (
            <ul className="grid gap-1 text-[13px] text-ink">
              {preview.toAdd.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-shipped">+</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
          {preview.toSkip.length > 0 && (
            <ul className="grid gap-1 text-[13px] text-graphite">
              {preview.toSkip.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span>·</span>
                  <span>
                    {s.title} <span className="font-mono text-xs">(already {s.existingKey})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {preview.toAdd.length > 0 ? (
            <form action={mergeAction} className="justify-self-start">
              <input type="hidden" name="rawText" value={preview.rawText} />
              <input type="hidden" name="filename" value={preview.filename} />
              <button type="submit" disabled={merging} className={buttonClass("primary")}>
                {merging ? "Adding…" : `Confirm and add ${preview.toAdd.length}`}
              </button>
            </form>
          ) : (
            <p className="text-[13px] text-graphite">Nothing new to add — every requirement in this file already exists on the board.</p>
          )}
          {merged?.ok === false && <p className="text-[13px] text-risk">{merged.error}</p>}
        </div>
      )}
    </Card>
  );
}
