import { HtmlFrame } from "@/components/html-frame";

/** Narrative roadmap — an auto-height sandboxed frame for the LLM-generated HTML (REQ-016). */
export function RoadmapFrame({ html }: { html: string }) {
  return <HtmlFrame html={html} title="Project roadmap — journey and what's next" className="mb-8" />;
}
