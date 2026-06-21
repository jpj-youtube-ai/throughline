import { getDb } from "@/db/client";
import { readSpec } from "@/spec/read";
import { Empty } from "@/components/ui";

// Renders the bound project's materialized SPEC.md verbatim (raw monospace).
// Read-only; the empty state covers an unbound project or a pre-materialize repo.
export async function SpecDocument() {
  const { content } = await readSpec(getDb());
  if (!content) {
    return <Empty title="No SPEC.md yet.">It is written when requirements are first materialized.</Empty>;
  }
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] text-ink">{content}</pre>
  );
}
