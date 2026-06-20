import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { project } from "@/db/schema";
import { listConnectableRepos, bindAndClone, type ConnectableRepo } from "@/project/connect";
import { PageHeader, Card, Pill, buttonClass } from "@/components/ui";

export const dynamic = "force-dynamic";

const WEBHOOK_PATH = "/api/github/webhook";

async function bind(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  await bindAndClone(getDb(), {
    repoFullName: String(formData.get("repo")),
    installationId: Number(formData.get("installation")),
    defaultBranch: String(formData.get("branch") || "main"),
    actorId: session.user.id,
  });
  redirect("/pulse");
}

export default async function ConnectPage() {
  const db = getDb();
  const [bound] = await db.select().from(project).limit(1);

  if (bound) {
    return (
      <>
        <PageHeader eyebrow="Project" title="Repository" lede="This project is linked to one repo — the single source of truth." />
        <Card className="border-l-2 border-l-shipped p-5">
          <div className="flex items-center gap-2.5">
            <Pill tone="shipped">linked</Pill>
            <a
              href={`https://github.com/${bound.repoFullName}`}
              className="font-mono text-sm text-spine-deep underline decoration-hairline underline-offset-2"
            >
              {bound.repoFullName}
            </a>
          </div>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">default branch</dt>
              <dd className="font-mono text-ink">{bound.defaultBranch}</dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">local clone</dt>
              <dd className="truncate font-mono text-ink">{bound.localClonePath}</dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-hairline pt-3 text-[13px] text-graphite">
            Single project / single repo — rebinding isn&apos;t supported by design.
          </p>
        </Card>
      </>
    );
  }

  let repos: ConnectableRepo[] | null = null;
  let problem: "unconfigured" | "error" | null = null;
  let detail = "";
  try {
    repos = await listConnectableRepos();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    problem = /GITHUB_APP_ID|GITHUB_APP_PRIVATE_KEY/.test(msg) ? "unconfigured" : "error";
    detail = msg;
  }

  return (
    <>
      <PageHeader
        eyebrow="Project"
        title="Connect a repository"
        lede="Link the repo this project plans against. Tasks, issues, the spec, and webhooks all run against it."
      />

      {problem === "unconfigured" ? (
        <Card className="p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-planned">GitHub App not set up</div>
          <p className="mt-2 max-w-prose text-sm text-ink-soft">
            Binding needs the Throughline GitHub App (separate from sign-in). Create it, install it on your repo, then
            its <code className="font-mono">GITHUB_APP_ID</code> and <code className="font-mono">GITHUB_APP_PRIVATE_KEY</code> go
            in the environment. Point its webhook at <code className="font-mono">{WEBHOOK_PATH}</code> on this host.
          </p>
        </Card>
      ) : problem === "error" ? (
        <Card className="border-l-2 border-l-risk p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-risk">couldn&apos;t reach GitHub</div>
          <p className="mt-2 text-sm text-ink-soft">{detail}</p>
        </Card>
      ) : repos && repos.length === 0 ? (
        <Card className="p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-planned">App installed on no repos</div>
          <p className="mt-2 max-w-prose text-sm text-ink-soft">
            The GitHub App is configured but isn&apos;t installed on any repository yet. Install it on the repo you want
            to plan against, then refresh.
          </p>
        </Card>
      ) : (
        <ul className="grid gap-2">
          {repos!.map((r) => (
            <li key={`${r.installationId}-${r.repoFullName}`}>
              <Card className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-sm text-ink">{r.repoFullName}</span>
                  <span className="ml-2 font-mono text-[11px] text-graphite">
                    {r.defaultBranch} · {r.isPrivate ? "private" : "public"}
                  </span>
                </div>
                <form action={bind} className="shrink-0">
                  <input type="hidden" name="repo" value={r.repoFullName} />
                  <input type="hidden" name="installation" value={r.installationId} />
                  <input type="hidden" name="branch" value={r.defaultBranch} />
                  <button type="submit" className={buttonClass("primary")}>
                    Bind
                  </button>
                </form>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
