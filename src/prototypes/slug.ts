/** A filesystem-safe slug for a prototype label (REQ-030). Falls back to
 *  "prototype" when the label has no alphanumerics. */
export function slugify(label: string): string {
  const s = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "prototype";
}
