"use client";

import { useActionState } from "react";
import { addPrototypeAction, type ProtoState } from "./actions";
import { Field, fieldClass, buttonClass } from "@/components/ui";

export function PrototypeUploadForm() {
  const [state, action, pending] = useActionState<ProtoState, FormData>(addPrototypeAction, null);

  return (
    <form action={action} className="grid gap-3">
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
        {state?.ok === true && (
          <span className="font-mono text-[12px] text-shipped">Uploaded — rendering in background.</span>
        )}
        {state?.ok === false && (
          <span className="font-mono text-[12px] text-risk">{state.error}</span>
        )}
      </div>
    </form>
  );
}
