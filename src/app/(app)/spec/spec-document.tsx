import { getDb } from "@/db/client";
import { buildSpecContent } from "@/spec/content";
import { activeProjectId } from "@/project/current";
import { Empty } from "@/components/ui";
import ReactMarkdown, { type Components } from "react-markdown";

// Map the materialized SPEC.md markdown onto the Surface design tokens. The doc
// is a generated projection (headings, paragraphs, task lists, emphasis); the
// leading HTML comment is skipped by react-markdown.
const components: Components = {
  h1: ({ children }) => <h1 className="font-display text-2xl text-ink mt-1 mb-4">{children}</h1>,
  h2: ({ children }) => (
    <h2 className="font-display mt-8 mb-3 border-b border-hairline pb-1 text-lg text-ink">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="font-display mt-6 mb-2 text-base text-ink">{children}</h3>,
  p: ({ children }) => <p className="font-serif my-3 max-w-prose text-[15px] leading-[1.7] text-ink">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
  li: ({ children }) => <li className="text-[14px] leading-[1.6] text-graphite">{children}</li>,
  code: ({ children }) => <code className="font-mono text-[0.9em] text-ink">{children}</code>,
  em: ({ children }) => <em className="italic text-graphite">{children}</em>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  a: ({ href, children }) => (
    <a href={href} className="text-ink underline underline-offset-2">
      {children}
    </a>
  ),
};

// Renders the bound project's materialized SPEC.md as formatted markdown.
// Read-only; the empty state covers an unbound project or a pre-materialize repo.
export async function SpecDocument() {
  const pid = await activeProjectId();
  const { content, requirementCount } = await buildSpecContent(getDb(), pid);
  if (requirementCount === 0) {
    return <Empty title="No requirements yet.">SPEC.md is generated from the requirements — import or vote some in first.</Empty>;
  }
  return (
    <div className="max-w-prose">
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  );
}
