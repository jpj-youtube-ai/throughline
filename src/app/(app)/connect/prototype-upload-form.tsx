"use client";

import { useActionState, useState, type FormEvent } from "react";
import { addPrototypeAction, type ProtoState } from "./actions";
import { Field, fieldClass, buttonClass } from "@/components/ui";

// User-facing cap on a prototype HTML upload. The Next.js server-action body limit
// (next.config.ts) is set above this; this guard gives a clear message before the
// request is sent, rather than the framework's cryptic body-size rejection (REQ-030).
const MAX_UPLOAD_MB = 25;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export function PrototypeUploadForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<ProtoState, FormData>(addPrototypeAction, null);
  const [sizeError, setSizeError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (file && file.size > MAX_UPLOAD_BYTES) {
      e.preventDefault(); // keep the over-limit file from hitting the server action
      setSizeError(`Prototype too large (${(file.size / 1024 / 1024).toFixed(1)} MB) — max ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    setSizeError(null);
  }

  return (
    <form action={action} onSubmit={handleSubmit} className="grid gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <Field label="Label">
        <input
          type="text"
          name="label"
          required
          placeholder="e.g. Idea board v2"
          className={fieldClass}
        />
      </Field>
      <Field label="HTML file">
        <input
          type="file"
          name="file"
          accept=".html,text/html"
          required
          className={fieldClass}
        />
      </Field>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={`${buttonClass("primary")} justify-self-start`}>
          {pending ? "Uploading…" : "Upload prototype"}
        </button>
        {!pending && !sizeError && state?.ok === true && (
          <span className="font-mono text-[12px] text-shipped">Uploaded — rendering in background.</span>
        )}
        {sizeError ? (
          <span className="font-mono text-[12px] text-risk">{sizeError}</span>
        ) : state?.ok === false ? (
          <span className="font-mono text-[12px] text-risk">{state.error}</span>
        ) : null}
      </div>
    </form>
  );
}
