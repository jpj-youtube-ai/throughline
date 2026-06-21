import { getDb } from "@/db/client";
import { listSpecMap } from "@/spec/map";
import { PageHeader, Empty } from "@/components/ui";
import { SpecUpload } from "./spec-upload";
import { SpecGrid } from "./spec-grid";

export const dynamic = "force-dynamic";

export default async function SpecPage() {
  const reqs = await listSpecMap(getDb());
  const shipped = reqs.filter((r) => r.status === "shipped").length;

  return (
    <>
      <PageHeader
        eyebrow="Specification"
        title="Spec map"
        lede="Every requirement and its status — materialized from the log, never hand-edited."
      >
        {reqs.length > 0 && (
          <span className="font-mono text-xs text-graphite">
            <span className="text-shipped">{shipped}</span> / {reqs.length} shipped
          </span>
        )}
      </PageHeader>

      <SpecUpload alreadyImported={reqs.length > 0} count={reqs.length} />

      {reqs.length === 0 ? (
        <Empty title="No requirements yet.">Import the genesis spec above, or approve an idea to declare the first one.</Empty>
      ) : (
        <SpecGrid reqs={reqs} />
      )}
    </>
  );
}
