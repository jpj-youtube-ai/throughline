// src/app/(app)/connect/prototypes.tsx
// Server component (listing) + inline client upload form (REQ-030)
import { getDb } from "@/db/client";
import { listProjectPrototypes } from "@/prototypes/store";
import { Card, Empty, Field, buttonClass, fieldClass } from "@/components/ui";
import { PrototypeUploadForm } from "./prototype-upload-form";
import { removePrototypeAction } from "./actions";

export async function DesignPrototypes({ projectId, repoFullName }: { projectId: string; repoFullName: string }) {
  const db = getDb();
  const protos = await listProjectPrototypes(db, projectId);

  return (
    <div className="mb-4">
      <div className="mb-2 font-mono text-[12px] text-ink">{repoFullName}</div>
      <Card className="p-4">
        <p className="mb-4 text-[13px] text-graphite">
          Upload HTML prototypes to give the generation model a visual reference. Each is rendered to a PNG by the
          background worker and included in this repo&apos;s generation context.
        </p>

        <PrototypeUploadForm projectId={projectId} />

        {protos.length > 0 && (
          <ul className="mt-4 grid gap-2 border-t border-hairline pt-4">
            {protos.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                {/* Thumbnail or placeholder */}
                <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-hairline bg-paper-sunk">
                  {p.rendered ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/prototype/${p.id}.png`}
                      alt={p.label}
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="font-mono text-[9px] text-graphite leading-tight text-center px-1">rendering…</span>
                  )}
                </div>

                {/* Label + status */}
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{p.label}</span>
                  {!p.rendered && (
                    <span className="font-mono text-[10px] text-graphite">PNG pending worker</span>
                  )}
                </div>

                {/* Remove */}
                <form action={removePrototypeAction} className="shrink-0">
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className={buttonClass("quiet")}>
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {protos.length === 0 && (
          <div className="mt-4 border-t border-hairline pt-4">
            <Empty title="No prototypes yet">
              Upload an HTML file above to get started.
            </Empty>
          </div>
        )}
      </Card>
    </div>
  );
}
