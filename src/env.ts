import fs from "node:fs";
import path from "node:path";

// Minimal .env loader (no dependency). Never overrides an already-set var.
export function loadDotenv(file = ".env"): void {
  let text: string;
  try {
    text = fs.readFileSync(path.resolve(file), "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice(7) : line;
    const eq = body.indexOf("=");
    if (eq === -1) continue;
    const key = body.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let val = body.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
