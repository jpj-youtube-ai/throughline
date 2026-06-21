"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export function DrawerShell({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Move focus into the drawer on open.
    panel?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        router.back();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus(); // restore focus to the triggering card on close
    };
  }, [router]);

  return (
    <div className="fixed inset-0 z-30">
      <button aria-label="Dismiss" onClick={() => router.back()} className="absolute inset-0 cursor-default bg-ink/15" tabIndex={-1} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-hairline bg-paper shadow-2xl outline-none"
      >
        <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h2 className="font-display text-lg text-ink">{title}</h2>
          <button onClick={() => router.back()} aria-label="Close" className="flex size-8 items-center justify-center rounded-md text-graphite transition-colors hover:bg-paper-sunk hover:text-ink">
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </aside>
    </div>
  );
}
