"use client";
import Link from "next/link";
import { setActiveProject } from "@/app/(app)/active/actions";

export function ProjectSwitcher({
  projects,
  activeId,
}: {
  projects: { id: string; repoFullName: string }[];
  activeId: string;
}) {
  const active = projects.find((p) => p.id === activeId) ?? projects[0];
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1 font-mono text-xs hover:bg-paper-sunk">
        <span className="size-1.5 rounded-full bg-shipped" />
        <span className="text-ink">{active?.repoFullName ?? "Link a repository"}</span>
        <span className="text-graphite">▾</span>
      </summary>
      <div className="absolute left-0 z-20 mt-1 min-w-56 rounded-md border border-hairline bg-paper-raised p-1 shadow-sm">
        {projects.map((p) => (
          <form key={p.id} action={setActiveProject.bind(null, p.id)}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-xs hover:bg-paper-sunk"
            >
              <span className={p.id === activeId ? "text-spine-deep" : "text-graphite"}>
                {p.id === activeId ? "●" : "○"}
              </span>
              <span className="truncate text-ink">{p.repoFullName}</span>
            </button>
          </form>
        ))}
        <Link
          href="/connect"
          className="mt-1 block border-t border-hairline px-2 py-1 font-mono text-xs text-spine-deep hover:bg-paper-sunk"
        >
          + Link a repo…
        </Link>
      </div>
    </details>
  );
}
