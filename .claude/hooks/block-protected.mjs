#!/usr/bin/env node
// PreToolUse guard for Throughline.
// Blocks edits to generated artifacts and secret material:
//   - SPEC.md         -> a generated projection; never hand-edited (regenerate via `npm run materialize`)
//   - .env / .env.*   -> secrets (ANTHROPIC_API_KEY, GitHub App key); .env.example is allowed
//   - *.key / *.pem   -> private key material
//   - *.crt           -> TLS certificate material
// Exit 2 = block the tool call and feed the reason back to Claude.
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
const filePath = String(input.file_path ?? input.path ?? input.notebook_path ?? "");
const norm = filePath.replace(/\\/g, "/");

if (!norm) {
  process.exit(0);
}

const rules = [
  {
    test: /(^|\/)SPEC\.md$/i,
    why: "SPEC.md is a generated projection of the requirement events — never hand-edited (CLAUDE.md anti-goal). Change the requirements and run `npm run materialize` to regenerate it.",
  },
  {
    test: /(^|\/)\.env\.example$/i,
    allow: true,
  },
  {
    test: /(^|\/)\.env(\.[^/]+)?$/i,
    why: "`.env` / `.env.*` hold secrets (ANTHROPIC_API_KEY, GitHub App private key, webhook secret). Edit them yourself outside Claude; only `.env.example` is safe to change here.",
  },
  {
    test: /\.(key|pem)$/i,
    why: "Private key material must never be edited or committed.",
  },
  {
    test: /\.crt$/i,
    why: "TLS certificate material — leave it untouched.",
  },
];

for (const r of rules) {
  if (r.test.test(norm)) {
    if (r.allow) break; // explicitly allowed (e.g. .env.example) — stop matching
    process.stderr.write(`Blocked edit to ${filePath}\n${r.why}\n`);
    process.exit(2);
  }
}

process.exit(0);
