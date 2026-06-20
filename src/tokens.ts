// Cheap, dependency-free token estimate for size-bounding the repo slice.
// ~4 chars/token is a fine heuristic for budgeting; we never bill against it.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
