// Format an error for worker logs, surfacing the underlying cause. Drizzle wraps
// DB failures as "Failed query: …" and attaches the real Postgres error (with its
// code, constraint, column, detail) on `.cause`. Logging only `e.message` hides
// the actual reason — e.g. a NOT NULL violation reads as a generic "Failed query".
export function formatError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as { cause?: unknown }).cause;
  if (cause == null) return e.message;

  const c = cause as Record<string, unknown>;
  const causeMsg =
    typeof c.message === "string" ? c.message : cause instanceof Error ? cause.message : String(cause);
  const fields = (["code", "constraint", "column", "detail"] as const)
    .map((k) => (typeof c[k] === "string" ? `${k}=${c[k] as string}` : null))
    .filter((x): x is string => x !== null);

  return `${e.message} | cause: ${causeMsg}${fields.length ? ` (${fields.join(" ")})` : ""}`;
}
