import { App } from "octokit";
import { createAppAuth } from "@octokit/auth-app";

// The dedicated GitHub App (repo issues/contents/PRs + webhooks) — distinct from
// the Auth.js GitHub OAuth used for sign-in (REQ-001). Credentials come from env.
export interface GithubAppConfig {
  appId: string;
  privateKey: string;
}

export function loadAppConfig(): GithubAppConfig {
  const appId = process.env.GITHUB_APP_ID;
  // Allow the PEM to be stored \n-escaped on a single line in .env.
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set.");
  }
  return { appId, privateKey };
}

export function createApp(config: GithubAppConfig = loadAppConfig()): App {
  return new App({ appId: config.appId, privateKey: config.privateKey });
}

// An installation-scoped REST client — for opening issues / PRs on the bound repo.
export function getInstallationOctokit(installationId: number, app: App = createApp()) {
  return app.getInstallationOctokit(installationId);
}

// A short-lived installation access token — for authenticating git over HTTPS.
export async function getInstallationToken(
  installationId: number,
  config: GithubAppConfig = loadAppConfig(),
): Promise<string> {
  const auth = createAppAuth({ appId: config.appId, privateKey: config.privateKey, installationId });
  const { token } = await auth({ type: "installation" });
  return token;
}

// Open an issue on the bound repo (REQ-002 acceptance: "can open issues/PRs via
// the App"; REQ-009 will drive this per task).
export async function openIssue(
  installationId: number,
  repoFullName: string,
  title: string,
  body: string,
): Promise<{ number: number; url: string }> {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getInstallationOctokit(installationId);
  const res = await octokit.rest.issues.create({ owner, repo, title, body });
  return { number: res.data.number, url: res.data.html_url };
}
