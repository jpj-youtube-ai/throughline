import path from "node:path";
import type { App } from "octokit";
import type { Db } from "../db/client";
import { bindProject, type BoundProject } from "./bind";
import { createApp, getInstallationToken } from "../github/app";
import { ensureClone } from "../github/clone";

export interface ConnectableRepo {
  installationId: number;
  repoFullName: string;
  defaultBranch: string;
  isPrivate: boolean;
}

/**
 * Every repo the GitHub App can act on, across its installations (REQ-002 UI).
 * Lets the Connect page offer a pick-list instead of hand-entered ids. Live —
 * needs the GitHub App configured (throws via loadAppConfig if not).
 */
export async function listConnectableRepos(app: App = createApp()): Promise<ConnectableRepo[]> {
  const installations = await app.octokit.paginate(app.octokit.rest.apps.listInstallations);
  const out: ConnectableRepo[] = [];
  for (const inst of installations) {
    const octokit = await app.getInstallationOctokit(inst.id);
    const repos = await octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation);
    for (const r of repos) {
      out.push({
        installationId: inst.id,
        repoFullName: r.full_name,
        defaultBranch: r.default_branch,
        isPrivate: r.private,
      });
    }
  }
  return out.sort((a, b) => a.repoFullName.localeCompare(b.repoFullName));
}

// Where the local clone of a repo lives (REPO_CLONE_ROOT, owner__name).
export function clonePathFor(repoFullName: string): string {
  const root = process.env.REPO_CLONE_ROOT ?? "./.clones";
  return path.resolve(root, repoFullName.replace("/", "__"));
}

export type TokenFn = (installationId: number) => Promise<string>;
export type CloneFn = (opts: {
  repoFullName: string;
  dir: string;
  token: string;
  defaultBranch: string;
}) => Promise<void>;

/**
 * Link the project to a repo (REQ-002): clone it, then record the binding. Clone
 * FIRST — single-project means a recorded bind can't be redone, so we only commit
 * the binding once the clone has actually succeeded. Token/clone are injectable
 * for tests. Reused by the Connect page and the bind CLI.
 */
export async function bindAndClone(
  db: Db,
  input: { repoFullName: string; installationId: number; defaultBranch: string; actorId?: string | null },
  deps: { getToken?: TokenFn; clone?: CloneFn } = {},
): Promise<BoundProject> {
  const getToken = deps.getToken ?? getInstallationToken;
  const clone = deps.clone ?? ensureClone;
  const dir = clonePathFor(input.repoFullName);

  const token = await getToken(input.installationId);
  await clone({ repoFullName: input.repoFullName, dir, token, defaultBranch: input.defaultBranch });

  return bindProject(db, {
    repoFullName: input.repoFullName,
    installationId: input.installationId,
    defaultBranch: input.defaultBranch,
    localClonePath: dir,
    actorId: input.actorId ?? null,
  });
}
