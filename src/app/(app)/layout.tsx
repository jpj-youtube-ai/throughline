import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getDb } from "@/db/client";
import { Mark } from "@/components/icons";
import { NavRail } from "@/components/nav-rail";
import { ProjectSwitcher } from "@/components/project-switcher";
import { listProjects } from "@/project/list";
import { getActiveProjectId } from "@/project/active";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
  drawer,
}: {
  children: ReactNode;
  drawer: ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const projects = await listProjects(getDb());
  const activeId = await getActiveProjectId(getDb(), session.user.id).catch(() => "");
  const who = session.user.login ?? session.user.name ?? "signed in";

  return (
    <div className="grid min-h-dvh grid-cols-[64px_1fr]">
      <aside className="sticky top-0 flex h-dvh flex-col items-center border-r border-hairline bg-paper-raised py-4">
        <Link href="/dashboard" aria-label="Throughline" className="mb-5 text-spine">
          <Mark width={24} height={24} />
        </Link>
        <NavRail />
        <div className="mt-auto flex flex-col items-center gap-2">
          <div className="truncate px-1 text-center font-mono text-[9px] text-graphite" title={who}>
            {who.slice(0, 8)}
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-graphite transition-colors hover:bg-paper-sunk hover:text-ink"
            >
              ⎋
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-hairline bg-paper/85 px-8 py-3 backdrop-blur">
          {projects.length > 0 ? (
            <ProjectSwitcher projects={projects} activeId={activeId} />
          ) : (
            <a href="/connect" className="font-mono text-xs text-spine-deep">
              Link a repository →
            </a>
          )}
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-8 py-8">{children}</main>
        {drawer}
      </div>
    </div>
  );
}
