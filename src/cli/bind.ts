import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";
import { createDb } from "../db/client";
import { bindAndClone } from "../project/connect";

// Records the binding and provisions the local clone. The installation id is
// obtained when the operator installs the GitHub App on the repo. The Connect
// page (REQ-002 UI) does the same via bindAndClone.
//   npm run bind -- --repo owner/name --installation <id> [--branch main]
async function main(): Promise<void> {
  loadDotenv();
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      installation: { type: "string" },
      branch: { type: "string", default: "main" },
    },
  });
  if (!values.repo || !values.installation) {
    throw new Error("Usage: npm run bind -- --repo owner/name --installation <id> [--branch main]");
  }

  const { db, close } = createDb();
  try {
    const bound = await bindAndClone(db, {
      repoFullName: values.repo,
      installationId: Number(values.installation),
      defaultBranch: values.branch as string,
    });
    console.error(`[bind] bound to ${bound.repoFullName} (${bound.id}) + local clone ready`);
  } finally {
    await close();
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[bind] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
