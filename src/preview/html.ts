/** Join the text blocks of an Anthropic message. */
export function extractText(message: { content: Array<{ type: string; text?: string }> }): string {
  return message.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}

/** Pull a usable HTML document out of model text: strip a ``` fence if present,
 *  then take from the first tag to the last closing tag. */
export function extractHtml(text: string): string | null {
  let s = text.trim();
  const fence = s.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/<(!doctype|html|body|div|section|main)\b/i);
  const end = s.lastIndexOf(">");
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1).trim();
}

export function isValidHtml(html: string): boolean {
  return /<[a-z!][\s\S]*>/i.test(html) && html.includes("</");
}
