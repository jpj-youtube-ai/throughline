// src/app/(app)/spec/spec-upload.tsx
"use client";

import { useActionState } from "react";
import { importSpec, type ImportState } from "./actions";
import { Card, Field, fieldClass, buttonClass } from "@/components/ui";

export function SpecUpload({ alreadyImported, count }: { alreadyImported: boolean; count: number }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importSpec, null);

  if (alreadyImported) {
    return (
      <Card className="mb-8 p-4">
        <p className="text-sm text-graphite">
          Genesis spec imported — <span className="text-ink">{count}</span> requirements. Import is a one-time bootstrap; further
          requirements come from approved ideas or resolved drift.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mb-8 p-4">
      <form action={action} className="grid gap-3">
        <p className="text-[13px] text-graphite">
          Import the genesis spec — upload a Markdown file or paste it. It parses into <span className="font-mono">REQ-NNN</span>{" "}
          requirements (a one-time bootstrap).
        </p>
        <Field label="Spec file (.md)">
          <input type="file" name="file" accept=".md,.markdown,text/markdown,text/plain" className={fieldClass} />
        </Field>
        <Field label="…or paste the spec">
          <textarea name="text" rows={8} className={fieldClass} placeholder="**REQ-001 — Title.** description…" />
        </Field>
        <button type="submit" disabled={pending} className={`${buttonClass("primary")} justify-self-start`}>
          {pending ? "Importing…" : "Import spec"}
        </button>
        {state?.ok === true && (
          <p className="text-[13px] text-shipped">
            Imported {state.count} requirements ({state.keys[0]}…{state.keys[state.keys.length - 1]}).
          </p>
        )}
        {state?.ok === false && <p className="text-[13px] text-risk">{state.error}</p>}
      </form>
    </Card>
  );
}
