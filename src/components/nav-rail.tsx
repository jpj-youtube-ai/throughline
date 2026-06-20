"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PulseIcon, IdeaIcon, TaskIcon, SpecIcon, DriftIcon, ReconcileIcon } from "./icons";

const ITEMS = [
  { href: "/pulse", label: "Pulse", Icon: PulseIcon },
  { href: "/ideas", label: "Ideas", Icon: IdeaIcon },
  { href: "/tasks", label: "Tasks", Icon: TaskIcon },
  { href: "/spec", label: "Spec", Icon: SpecIcon },
  { href: "/drift", label: "Drift", Icon: DriftIcon },
  { href: "/reconcile", label: "Reconcile", Icon: ReconcileIcon },
];

export function NavRail() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Sections" className="flex flex-col gap-0.5">
      {ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150 ${
              active
                ? "bg-spine-wash font-medium text-spine-deep"
                : "text-graphite hover:bg-paper-sunk hover:text-ink"
            }`}
          >
            <Icon className={active ? "text-spine" : "text-graphite group-hover:text-ink"} />
            <span>{label}</span>
            {active && <span className="ml-auto h-4 w-0.5 rounded-full bg-spine" />}
          </Link>
        );
      })}
    </nav>
  );
}
