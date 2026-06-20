import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";
import { createDb, type Db } from "../db/client";
import { requirements } from "../db/schema";
import { emitEvent } from "../db/events";

export interface ParsedRequirement {
  key: string; // REQ-NNN
  title: string;
  description: string;
}

// Requirement declarations look like:  **REQ-001 — GitHub sign-in.** <description…>
// The description runs until the next requirement heading, a markdown section
// header, a horizontal rule, or end of text.
const REQUIREMENT_RE =
  /\*\*REQ-(\d{3})\s*[—–-]\s*([^*]+?)\.?\*\*([\s\S]*?)(?=\*\*REQ-\d{3}|\n#{2,3}\s|\n---|\s*$)/g;

export function parseSpecRequirements(specText: string): ParsedRequirement[] {
  const out: ParsedRequirement[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = REQUIREMENT_RE.exec(specText))) {
    const key = `REQ-${m[1]}`;
    if (seen.has(key)) continue; // first (declaration) wins over inline references
    seen.add(key);
    out.push({ key, title: m[2].trim(), description: m[3].trim() });
  }
  return out;
}

export interface GenesisResult {
  filename: string;
  count: number;
  keys: string[];
}

/**
 * Genesis import (REQ-004): parse a Markdown spec into the requirements table,
 * each provenance=imported / status=planned, and emit project.genesis_imported
 * plus one requirement.declared per requirement — all in one transaction.
 * One-time bootstrap: refuses if any requirements already exist.
 */
export async function importGenesisSpec(
  db: Db,
  specText: string,
  filename: string,
): Promise<GenesisResult> {
  const parsed = parseSpecRequirements(specText);
  if (parsed.length === 0) {
    throw new Error("No requirements found in the spec (expected **REQ-NNN — Title.** headings).");
  }

  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: requirements.id }).from(requirements).limit(1);
    if (existing.length > 0) {
      throw new Error("Genesis import refused: the requirements table is not empty.");
    }

    await emitEvent(tx, {
      type: "project.genesis_imported",
      subjectType: "project",
      payload: { filename, count: parsed.length },
    });

    for (const r of parsed) {
      const [row] = await tx
        .insert(requirements)
        .values({
          key: r.key,
          title: r.title,
          description: r.description,
          status: "planned",
          provenance: "imported",
        })
        .returning({ id: requirements.id });
      await emitEvent(tx, {
        type: "requirement.declared",
        subjectType: "requirement",
        subjectId: row.id,
        payload: { provenance: "imported", key: r.key, origin_idea_id: null },
      });
    }

    return { filename, count: parsed.length, keys: parsed.map((r) => r.key) };
  });
}

async function main(): Promise<void> {
  loadDotenv();
  const i = process.argv.indexOf("--spec");
  const specPath = i !== -1 ? process.argv[i + 1] : "./SPEC.md";
  const text = fs.readFileSync(path.resolve(specPath), "utf8");
  const { db, close } = createDb();
  try {
    const res = await importGenesisSpec(db, text, path.basename(specPath));
    console.error(`[genesis] imported ${res.count} requirements from ${res.filename}: ${res.keys[0]}…${res.keys[res.keys.length - 1]}`);
  } finally {
    await close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[genesis] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
