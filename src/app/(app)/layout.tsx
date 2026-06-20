import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getDb } from "@/db/client";
import { project } from "@/db/schema";
import { Mark } from "@/components/icons";
import { NavRail } from "@/components/nav-rail";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/");

  let repo: string | null = null;
  try {
    const [proj] = await getDb().select({ repoFullName: project.repoFullName }).from(project).limit(1);
    repo = proj?.repoFullName ?? null;
  } catch {
    repo = null;
  }
  const who = session.user.login ?? session.user.name ?? "signed in";

  return (
    <div className="grid min-h-dvh grid-cols-[212px_1fr]">
      <aside className="sticky top-0 flex h-dvh flex-col border-r border-hairline bg-paper-raised px-3 py-5">
        <div className="flex items-center gap-2 px-2">
          <span className="text-spine">
            <Mark width={22} height={22} />
          </span>
          <span className="font-display text-[17px] font-bold tracking-tight">Throughline</span>
        </div>
        <div className="mt-6 flex-1 overflow-y-auto">
          <NavRail />
        </div>
        <div className="border-t border-hairline pt-3">
          <div className="truncate px-2 font-mono text-xs text-graphite">{who}</div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="mt-1 w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-sm text-graphite transition-colors hover:bg-paper-sunk hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-hairline bg-paper/85 px-8 py-3 backdrop-blur">
          <a
            href="/connect"
            className="flex items-center gap-2 rounded-md px-2 py-1 font-mono text-xs transition-colors hover:bg-paper-sunk"
            title="Connect or view the linked repository"
          >
            {repo ? (
              <>
                <span className="size-1.5 rounded-full bg-shipped" />
                <span className="text-ink">{repo}</span>
              </>
            ) : (
              <span className="text-spine-deep">Link a repository →</span>
            )}
          </a>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-9">{children}</main>
      </div>
    </div>
  );
}
