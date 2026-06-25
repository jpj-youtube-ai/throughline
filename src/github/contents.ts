import { getInstallationOctokit } from "./app";

export interface ContentsClient {
  rest: {
    repos: {
      getContent: (p: { owner: string; repo: string; path: string; ref: string }) => Promise<{ data: { sha: string; content?: string } | unknown }>;
      createOrUpdateFileContents: (p: { owner: string; repo: string; path: string; message: string; content: string; branch: string; sha?: string }) => Promise<unknown>;
    };
  };
}

/** Create or update a single file on a branch via the GitHub Contents API
 *  (REQ-030). Idempotent: skips when the file already holds identical content;
 *  updates with the blob sha otherwise; creates when absent (404). */
export async function commitFileToBranch(
  installationId: number,
  repoFullName: string,
  branch: string,
  filePath: string,
  content: string,
  message: string,
  client?: ContentsClient,
): Promise<{ committed: boolean }> {
  const [owner, repo] = repoFullName.split("/");
  const kit = client ?? ((await getInstallationOctokit(installationId)) as unknown as ContentsClient);
  let sha: string | undefined;
  try {
    const existing = await kit.rest.repos.getContent({ owner, repo, path: filePath, ref: branch });
    const data = existing.data as { sha?: string; content?: string };
    if (data && typeof data.sha === "string") {
      if (data.content && Buffer.from(data.content, "base64").toString("utf8") === content) return { committed: false };
      sha = data.sha;
    }
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
  }
  await kit.rest.repos.createOrUpdateFileContents({ owner, repo, path: filePath, message, content: Buffer.from(content, "utf8").toString("base64"), branch, sha });
  return { committed: true };
}
