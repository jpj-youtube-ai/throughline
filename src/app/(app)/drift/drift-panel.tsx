import { getDb } from "@/db/client";
import { listOpenDriftFlags } from "@/drift/queries";
import { Card, Pill, Empty, Field, fieldClass, buttonClass } from "@/components/ui";
import { resolve } from "./actions";

export async function DriftPanel() {
  const flags = await listOpenDriftFlags(getDb());

  return (
    <>
      {flags.length === 0 ? (
        <Empty title="No open drift.">Every PR so far stayed inside its requirement.</Empty>
      ) : (
        <ul className="grid gap-4">
          {flags.map((f) => (
            <li key={f.id}>
              <Card className="border-l-2 border-l-risk p-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-spine-deep">{f.taskKey}</span>
                  <Pill tone="risk">PR #{f.prNumber}</Pill>
                </div>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                  {f.unmappedItems.map((it, i) => (
                    <li key={i}>{it}</li>
                  ))}
                </ul>
                <form action={resolve} className="mt-4 grid gap-3 border-t border-hairline pt-4">
                  <input type="hidden" name="flagId" value={f.id} />
                  <Field label="Why — required">
                    <textarea name="rationale" required rows={2} className={fieldClass} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Resolution">
                      <select name="resolution" defaultValue="out_of_scope" className={fieldClass}>
                        <option value="out_of_scope">Out of scope</option>
                        <option value="new_req">Declare new req</option>
                        <option value="relink">Relink</option>
                      </select>
                    </Field>
                    <Field label="New req title">
                      <input name="newReqTitle" placeholder="for new_req" className={fieldClass} />
                    </Field>
                    <Field label="Relink to">
                      <input name="relinkReqKey" placeholder="REQ-NNN" className={fieldClass} />
                    </Field>
                  </div>
                  <button type="submit" className={`${buttonClass("primary")} justify-self-start`}>
                    Resolve drift
                  </button>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
