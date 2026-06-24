"use client";

import { useActionState } from "react";
import { generateRequirementDiagram, type DiagramState } from "./[key]/actions";
import { HtmlFrame } from "@/components/html-frame";
import { buttonClass } from "@/components/ui";

export function RequirementDiagram({ reqKey, html }: { reqKey: string; html: string | null }) {
  const [state, action, pending] = useActionState<DiagramState, FormData>(generateRequirementDiagram, null);
  // Prefer a freshly generated diagram (the action returns it) over the stored
  // prop — so it appears in place even in the drawer, which doesn't re-render on revalidate.
  const shown = (state?.ok === true ? state.html : null) ?? html;

  return (
    <div className="mt-5 border-t border-hairline pt-4">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-graphite">Diagram</h3>
      {shown && <HtmlFrame html={shown} title={`What ${reqKey} represents`} className="mt-3" />}
      <form action={action} className="mt-2">
        <input type="hidden" name="key" value={reqKey} />
        <button type="submit" disabled={pending} className={buttonClass(shown ? "quiet" : "primary")}>
          {pending ? (shown ? "Regenerating…" : "Generating…") : shown ? "Regenerate diagram" : "Generate diagram"}
        </button>
        {!shown && <p className="mt-1 text-[11px] text-graphite">A one-shot visual explainer of what this requirement represents.</p>}
      </form>
      {state?.ok === false && <p className="mt-2 text-[13px] text-risk">{state.error}</p>}
    </div>
  );
}
