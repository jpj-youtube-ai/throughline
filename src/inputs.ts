import fs from "node:fs";
import { z } from "zod";

export const IdeaSchema = z.object({
  title: z.string().min(1, "idea.title is required"),
  why: z.string().min(1, "idea.why is required (the mandatory pitch)"),
  feasibility: z.number().int().min(1).max(10).nullish(),
  viability: z.number().int().min(1).max(10).nullish(),
  relevantPaths: z.array(z.string()).optional(),
});
export type Idea = z.infer<typeof IdeaSchema>;

export function loadIdea(pathOrDash: string): Idea {
  const raw =
    pathOrDash === "-"
      ? fs.readFileSync(0, "utf8")
      : fs.readFileSync(pathOrDash, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Idea file is not valid JSON: ${(e as Error).message}`);
  }
  const result = IdeaSchema.safeParse(parsed);
  if (!result.success) {
    const msg = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Idea file failed validation: ${msg}`);
  }
  return result.data;
}

export interface SpecInfo {
  text: string;
  existingKeys: Set<string>;
  existingList: string; // "- REQ-001 — Title\n..."
  maxNumber: number;
  nextNumber: number;
  nextKey: string; // e.g. "REQ-028"
}

export function loadSpec(specPath: string): SpecInfo {
  let text: string;
  try {
    text = fs.readFileSync(specPath, "utf8");
  } catch {
    throw new Error(`Could not read spec at ${specPath}.`);
  }

  // Requirement declarations look like: **REQ-001 — GitHub sign-in.** ...
  const headingRe = /\*\*REQ-(\d{3})\s*[—–-]\s*([^*]+?)\*\*/g;
  const keyTitle = new Map<string, string>();
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(text))) {
    const key = `REQ-${m[1]}`;
    const title = m[2].trim().replace(/\.\s*$/, "");
    if (!keyTitle.has(key)) keyTitle.set(key, title);
  }

  // All REQ-NNN that appear anywhere = the linkable set; also gives us the max number.
  const existingKeys = new Set<string>();
  let maxNumber = 0;
  const anyRe = /REQ-(\d{3})/g;
  while ((m = anyRe.exec(text))) {
    existingKeys.add(`REQ-${m[1]}`);
    const n = Number(m[1]);
    if (n > maxNumber) maxNumber = n;
  }

  const sortedHeadings = [...keyTitle.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  const existingList = sortedHeadings.length
    ? sortedHeadings.map(([k, t]) => `- ${k} — ${t}`).join("\n")
    : [...existingKeys].sort().map((k) => `- ${k}`).join("\n");

  const nextNumber = maxNumber + 1;
  const nextKey = `REQ-${String(nextNumber).padStart(3, "0")}`;

  return { text, existingKeys, existingList, maxNumber, nextNumber, nextKey };
}

export function loadConventions(claudePath: string): string | null {
  try {
    return fs.readFileSync(claudePath, "utf8");
  } catch {
    return null;
  }
}
