#!/usr/bin/env node
// PostToolUse advisory for Throughline.
// Non-blocking: surfaces repo-specific invariant reminders to Claude after an
// edit, via PostToolUse additionalContext. Never blocks (always exits 0).
//
// Checks (all best-effort, text-based):
//   - `tasks.github_status` written outside src/github/webhook.ts (webhook-only)
//   - UPDATE/DELETE against the append-only `events` table
//   - Haiku model ids in LLM calls (Sonnet/Opus only)
//   - `any` in domain code (events/tasks/requirements/db/generation)
//   - a new drizzle/*.sql migration (must be hand-applied to the live :5434 DB)
//   - a new src/**/*.test.ts not registered in package.json's `test` script
import { readFileSync } from "node:fs";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

let payload = {};
try {
  payload = JSON.parse(readStdin() || "{}");
} catch {
  payload = {};
}

const input = payload.tool_input ?? {};
const toolName = String(payload.tool_name ?? "");
const filePath = String(input.file_path ?? input.path ?? "");
const norm = filePath.replace(/\\/g, "/");
if (!norm) process.exit(0);

const idx = norm.indexOf("src/");
const rel = idx >= 0 ? norm.slice(idx) : norm;

// Best-effort text of what was just written/edited.
const chunks = [];
if (typeof input.content === "string") chunks.push(input.content);
if (typeof input.new_string === "string") chunks.push(input.new_string);
if (Array.isArray(input.edits)) {
  for (const e of input.edits) if (e && typeof e.new_string === "string") chunks.push(e.new_string);
}
const text = chunks.join("\n");

const warnings = [];
const inSrc = /(^|\/)src\//.test(norm);
const isWebhook = /(^|\/)src\/github\/webhook\.ts$/.test(norm);

if (inSrc && text) {
  if (/github_status\s*[:=]/.test(text) && !isWebhook) {
    warnings.push(
      "[github_status] `tasks.github_status` is mirrored read-only — the ONLY legal writer is the webhook handler (src/github/webhook.ts), which must also emit `task.github_status_changed`. Remove this write unless you are in the webhook handler."
    );
  }
  if (/\.(update|delete)\s*\(\s*events\b/.test(text)) {
    warnings.push(
      "[append-only] `events` is append-only — no code path may UPDATE or DELETE events. Model the change as a NEW event via emitEvent(tx, ...) instead."
    );
  }
  if (/claude-3-haiku|claude-haiku|["'`]haiku/i.test(text)) {
    warnings.push(
      "[model] Haiku is disallowed for LLM calls — Throughline uses Sonnet or Opus only (CLAUDE.md)."
    );
  }
  if (
    /(^|\/)src\/(events|tasks|requirements|db|generation)\//.test(norm) &&
    /(:\s*any\b|as\s+any\b|<any>|\bany\[\])/.test(text)
  ) {
    warnings.push(
      "[no-any] No `any` in domain code (events/tasks/requirements). Give this a real type or a Zod-validated shape."
    );
  }
  if (/\bemitEvent\s*\(/.test(text) && !/\btx\b/.test(text)) {
    warnings.push(
      "[event-in-tx] emitEvent must run inside the SAME transaction as the state write — pass the `tx`, never a bare db handle."
    );
  }
}

// New migration file -> remind about the live-DB hand-apply (tests can't catch this).
if (/(^|\/)drizzle\/[^/]+\.sql$/.test(norm) && toolName === "Write") {
  warnings.push(
    "[migration] New Drizzle migration. `npm run db:migrate` is fresh-provision only — hand-apply this SQL to the live :5434 Postgres (or run /apply-migration). PGlite tests will NOT catch a missing apply."
  );
}

// New test file -> must be listed in package.json's `test` script (enumerated, not globbed).
if (/(^|\/)src\/.+\.test\.ts$/.test(norm) && toolName === "Write") {
  try {
    const pkg = readFileSync("package.json", "utf8");
    if (!pkg.includes(rel)) {
      warnings.push(
        `[test-registration] ${rel} is not in package.json's "test" script. That list is enumerated, not globbed, so this test will be SILENTLY SKIPPED. Add its path to the test script.`
      );
    }
  } catch {
    /* package.json unreadable from here — skip */
  }
}

if (warnings.length) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "Throughline invariant reminders:\n- " + warnings.join("\n- "),
      },
    })
  );
}

process.exit(0);
