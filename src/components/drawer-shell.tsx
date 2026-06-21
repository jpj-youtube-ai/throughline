"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

// A right-side drawer over the dashboard. Closing returns to the underlying
// page via router.back() (the drawer is an intercepted route).
export function DrawerShell({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <div className="fixed inset-0 z-30">
      <button
        aria-label="Close"
        onClick={() => router.back()}
        className="absolute inset-0 cursor-default bg-ink/15"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-hairline bg-paper shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h2 className="font-display text-lg text-ink">{title}</h2>
          <button
            onClick={() => router.back()}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-md text-graphite transition-colors hover:bg-paper-sunk hover:text-ink"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </aside>
    </div>
  );
}
