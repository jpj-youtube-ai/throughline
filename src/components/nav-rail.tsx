"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DashboardIcon,
  PulseIcon,
  HeartbeatIcon,
  NarrativeIcon,
  DigestIcon,
  IdeaIcon,
  TaskIcon,
  QuickWinIcon,
  PipelineIcon,
  SpecIcon,
  ProgressIcon,
  DriftIcon,
  ReconcileIcon,
  WhyQualityIcon,
} from "./icons";

const GROUPS = [
  {
    label: "Story",
    items: [
      { href: "/pulse", label: "Pulse", Icon: PulseIcon },
      { href: "/heartbeat", label: "Heartbeat", Icon: HeartbeatIcon },
      { href: "/narrative", label: "Narrative", Icon: NarrativeIcon },
      { href: "/digest", label: "Digest", Icon: DigestIcon },
    ],
  },
  {
    label: "Work",
    items: [
      { href: "/ideas", label: "Ideas", Icon: IdeaIcon },
      { href: "/tasks", label: "Tasks", Icon: TaskIcon },
      { href: "/quick-wins", label: "Quick wins", Icon: QuickWinIcon },
      { href: "/pipeline", label: "Pipeline", Icon: PipelineIcon },
    ],
  },
  {
    label: "Spec",
    items: [
      { href: "/spec", label: "Spec", Icon: SpecIcon },
      { href: "/burnup", label: "Progress", Icon: ProgressIcon },
    ],
  },
  {
    label: "Integrity",
    items: [
      { href: "/drift", label: "Drift", Icon: DriftIcon },
      { href: "/reconcile", label: "Reconcile", Icon: ReconcileIcon },
      { href: "/why-quality", label: "Why-quality", Icon: WhyQualityIcon },
    ],
  },
];

export function NavRail() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Sections" className="flex flex-col gap-5">
      <Link
        href="/dashboard"
        aria-current={pathname === "/dashboard" ? "page" : undefined}
        className={`group flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors duration-150 ${
          pathname === "/dashboard"
            ? "bg-spine-wash font-medium text-spine-deep"
            : "text-graphite hover:bg-paper-sunk hover:text-ink"
        }`}
      >
        <DashboardIcon className={pathname === "/dashboard" ? "text-spine" : "text-graphite group-hover:text-ink"} />
        <span>Dashboard</span>
        {pathname === "/dashboard" && <span className="ml-auto h-4 w-0.5 rounded-full bg-spine" />}
      </Link>
      {GROUPS.map((group) => (
        <div key={group.label}>
          <div className="mb-1 px-3 font-mono text-[10px] uppercase tracking-[0.18em] text-graphite/70">
            {group.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map(({ href, label, Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`group flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors duration-150 ${
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
          </div>
        </div>
      ))}
    </nav>
  );
}
