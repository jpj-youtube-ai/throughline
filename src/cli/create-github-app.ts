import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { loadDotenv } from "../env";

/**
 * Create the Throughline GitHub App via GitHub's App-Manifest flow (REQ-002 setup).
 * GitHub does not allow fully headless App creation — one browser click is
 * required — so this pre-fills every setting via a manifest, then captures the
 * App ID, private key, and webhook secret straight into .env after that click.
 *   npm run app:create   →  open the printed localhost URL, click "Create".
 */
function buildManifest(base: string, redirectUrl: string, name: string) {
  return {
    name,
    url: base,
    hook_attributes: { url: `${base}/api/github/webhook`, active: true },
    redirect_url: redirectUrl,
    public: false,
    default_permissions: { contents: "write", issues: "write", pull_requests: "write", metadata: "read" },
    default_events: ["issues", "pull_request"],
  };
}

function upsertEnv(updates: Record<string, string>): void {
  const file = path.resolve(".env");
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  for (const [k, v] of Object.entries(updates)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, "")}\n${line}\n`;
  }
  fs.writeFileSync(file, text, "utf8");
}

function page(body: string): string {
  return `<!doctype html><meta charset=utf-8><meta name=color-scheme content="light dark">
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1.25rem;line-height:1.5">${body}</body>`;
}

async function main(): Promise<void> {
  loadDotenv();
  const { values } = parseArgs({
    options: { name: { type: "string" }, port: { type: "string", default: "7799" }, base: { type: "string" } },
  });
  const base = (values.base ?? process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const port = Number(values.port);
  const name = values.name ?? "Throughline";
  const redirectUrl = `http://localhost:${port}/callback`;
  const manifest = JSON.stringify(buildManifest(base, redirectUrl, name));

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (u.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        page(`<h1>Create the ${name} GitHub App</h1>
        <p>Make sure your browser is logged into GitHub as the account that should own the app, then click below.
        GitHub shows a confirmation with all settings (permissions, webhook, events) pre-filled.</p>
        <form method="post" action="https://github.com/settings/apps/new">
          <input type="hidden" name="manifest" value='${manifest.replace(/'/g, "&#39;")}'>
          <button type="submit" style="font-size:1.05rem;padding:.6rem 1rem;cursor:pointer">Create GitHub App →</button>
        </form>`),
      );
      return;
    }

    if (u.pathname === "/callback") {
      const code = u.searchParams.get("code");
      if (!code) {
        res.writeHead(400);
        res.end(page("<h1>Missing code</h1><p>Start again from the home page.</p>"));
        return;
      }
      try {
        const r = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
          method: "POST",
          headers: { Accept: "application/vnd.github+json", "User-Agent": "throughline-setup" },
        });
        if (!r.ok) {
          const t = await r.text();
          res.writeHead(500, { "content-type": "text/html" });
          res.end(page(`<h1>Conversion failed (${r.status})</h1><pre>${t.replace(/</g, "&lt;")}</pre>`));
          return;
        }
        const app = (await r.json()) as {
          id: number;
          slug: string;
          name: string;
          pem: string;
          webhook_secret?: string;
          client_id?: string;
          client_secret?: string;
        };
        upsertEnv({
          GITHUB_APP_ID: String(app.id),
          GITHUB_APP_PRIVATE_KEY: app.pem.replace(/\r?\n/g, "\\n"),
          GITHUB_WEBHOOK_SECRET: app.webhook_secret ?? "",
          GITHUB_APP_CLIENT_ID: app.client_id ?? "",
          GITHUB_APP_CLIENT_SECRET: app.client_secret ?? "",
        });
        const installUrl = `https://github.com/apps/${app.slug}/installations/new`;
        console.error(`[app:create] created "${app.name}" (id ${app.id}); wrote App ID + private key + webhook secret to .env`);
        console.error(`[app:create] install it on your repo: ${installUrl}`);
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          page(`<h1>✓ GitHub App created</h1>
          <p><b>${app.name}</b> (id ${app.id}) was created, and its App ID, private key, and webhook secret are now in <code>.env</code>.</p>
          <h2>One more step — install it on the repo</h2>
          <p><a href="${installUrl}" style="font-size:1.05rem">Install ${app.name} →</a> &nbsp; (choose <code>jpj-youtube-ai/throughline</code>)</p>
          <p>Then tell Claude it's installed — the server will restart and <code>/connect</code> will list the repo.</p>`),
        );
        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 800);
      } catch (e) {
        res.writeHead(500);
        res.end(page(`<h1>Error</h1><pre>${String(e)}</pre>`));
      }
      return;
    }

    res.writeHead(404);
    res.end(page("<h1>Not found</h1>"));
  });

  server.listen(port, () => {
    console.error(`[app:create] manifest ready. Open  http://localhost:${port}  in your browser, then click "Create GitHub App".`);
    console.error(`[app:create] (homepage ${base}, webhook ${base}/api/github/webhook)`);
  });
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((e) => {
    console.error("[app:create] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
