import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { listProjects } from "@/project/list";
import { listConnectableRepos, bindAndClone, type ConnectableRepo } from "@/project/connect";
import { PageHeader, Card, Pill, buttonClass } from "@/components/ui";
import { SyncClaudeMdButton } from "@/components/sync-claude-md-button";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const WEBHOOK_PATH = "/api/github/webhook";

async function bind(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in.");
  const db = getDb();
  const bound = await bindAndClone(db, {
    repoFullName: String(formData.get("repo")),
    installationId: Number(formData.get("installation")),
    defaultBranch: String(formData.get("branch") || "main"),
    actorId: session.user.id,
  });
  await db.update(users).set({ activeProjectId: bound.id }).where(eq(users.id, session.user.id));
  revalidatePath("/", "layout");
  redirect("/pulse");
}

export default async function ConnectPage() {
  const db = getDb();
  const session = await auth();
  const actorId = session?.user?.id;

  // Fetch bound projects and active project
  const boundProjects = await listProjects(db);
  const boundRepoNames = new Set(boundProjects.map((p) => p.repoFullName));

  let activeProjectId: string | null = null;
  if (actorId) {
    const [userRow] = await db
      .select({ activeProjectId: users.activeProjectId })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);
    activeProjectId = userRow?.activeProjectId ?? null;
  }

  // Fetch connectable repos and filter out already-bound ones
  let availableRepos: ConnectableRepo[] | null = null;
  let problem: "unconfigured" | "error" | null = null;
  let detail = "";
  try {
    const all = await listConnectableRepos();
    availableRepos = all.filter((r) => !boundRepoNames.has(r.repoFullName));
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
        lede="Link repos this project plans against. Tasks, issues, the spec, and webhooks all run against the active one."
      />

      {/* Bound projects section */}
      {boundProjects.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">Bound repos</div>
          <ul className="grid gap-2">
            {boundProjects.map((p) => {
              const isActive = p.id === activeProjectId;
              return (
                <li key={p.id}>
                  <Card className={`flex items-center gap-3 p-4 ${isActive ? "border-l-2 border-l-shipped" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <a
                        href={`https://github.com/${p.repoFullName}`}
                        className="font-mono text-sm text-spine-deep underline decoration-hairline underline-offset-2"
                      >
                        {p.repoFullName}
                      </a>
                      <span className="ml-2 font-mono text-[11px] text-graphite">{p.defaultBranch}</span>
                    </div>
                    <SyncClaudeMdButton projectId={p.id} />
                    {isActive && <Pill tone="shipped">active</Pill>}
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Available repos to bind */}
      <section>
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-graphite">
          {boundProjects.length > 0 ? "Add another repo" : "Available repos"}
        </div>

        {problem === "unconfigured" ? (
          <Card className="p-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-planned">GitHub App not set up</div>
            <p className="mt-2 max-w-prose text-sm text-ink-soft">
              Binding needs the Throughline GitHub App (separate from sign-in). Create it, install it on your repo, then
              its <code className="font-mono">GITHUB_APP_ID</code> and{" "}
              <code className="font-mono">GITHUB_APP_PRIVATE_KEY</code> go in the environment. Point its webhook at{" "}
              <code className="font-mono">{WEBHOOK_PATH}</code> on this host.
            </p>
          </Card>
        ) : problem === "error" ? (
          <Card className="border-l-2 border-l-risk p-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-risk">couldn&apos;t reach GitHub</div>
            <p className="mt-2 text-sm text-ink-soft">{detail}</p>
          </Card>
        ) : availableRepos && availableRepos.length === 0 ? (
          <Card className="p-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-planned">
              {boundProjects.length > 0 ? "All accessible repos already bound" : "App installed on no repos"}
            </div>
            <p className="mt-2 max-w-prose text-sm text-ink-soft">
              {boundProjects.length > 0
                ? "Every repo the GitHub App can access is already linked."
                : "The GitHub App is configured but isn't installed on any repository yet. Install it on the repo you want to plan against, then refresh."}
            </p>
          </Card>
        ) : (
          <ul className="grid gap-2">
            {availableRepos!.map((r) => (
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
      </section>
    </>
  );
}
