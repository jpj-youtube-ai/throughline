// src/app/(app)/connect/prototypes.tsx
// Server component (listing) + inline client upload form (REQ-030)
import { getDb } from "@/db/client";
import { loadProjectPrototypes } from "@/prototypes/store";
import { Card, Empty, buttonClass } from "@/components/ui";
import { PrototypeUploadForm } from "./prototype-upload-form";
import { removePrototypeAction } from "./actions";

export async function DesignPrototypes({ projectId, repoFullName }: { projectId: string; repoFullName: string }) {
  const db = getDb();
  const protos = await loadProjectPrototypes(db, projectId);

  return (
    <div className="mb-4">
      <div className="mb-2 font-mono text-[12px] text-ink">{repoFullName}</div>
      <Card className="p-4">
        <p className="mb-4 text-[13px] text-graphite">
          Upload HTML prototypes to give the generation model a design reference.
        </p>

        <PrototypeUploadForm projectId={projectId} />

        {protos.length > 0 && (
          <ul className="mt-4 grid gap-2 border-t border-hairline pt-4">
            {protos.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.label}</span>

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
