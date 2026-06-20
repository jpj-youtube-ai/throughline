import { parseArgs } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";
import { createDb } from "../db/client";
import { bindProject } from "../project/bind";
import { getInstallationToken } from "../github/app";
import { ensureClone } from "../github/clone";

// Records the binding and provisions the local clone. The installation id is
// obtained when the operator installs the GitHub App on the repo.
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
  const repoFullName = values.repo;
  const installationId = Number(values.installation);
  const defaultBranch = values.branch as string;
  const cloneRoot = process.env.REPO_CLONE_ROOT ?? "./.clones";
  const localClonePath = path.resolve(cloneRoot, repoFullName.replace("/", "__"));

  const { db, close } = createDb();
  try {
    const bound = await bindProject(db, { repoFullName, installationId, defaultBranch, localClonePath });
    console.error(`[bind] project bound to ${bound.repoFullName} (${bound.id})`);

    const token = await getInstallationToken(installationId);
    await ensureClone({ repoFullName, dir: localClonePath, token, defaultBranch });
    console.error(`[bind] local clone ready at ${localClonePath}`);
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
