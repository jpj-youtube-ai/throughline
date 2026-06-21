export const pad3 = (n: number): string => String(n).padStart(3, "0");

export function maxNumber(keys: string[]): number {
  let max = 0;
  for (const k of keys) {
    const m = /-(\d+)$/.exec(k);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

export function renderBody(body: { pointers: string[]; acceptance_check: string }): string {
  const pointers = body.pointers.map((p) => `- ${p}`).join("\n");
  return `**Pointers**\n${pointers}\n\n**Acceptance check:** ${body.acceptance_check}`;
}
