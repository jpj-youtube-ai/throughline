// src/components/dashboard-card.tsx
import type { ReactNode, SVGProps, ComponentType } from "react";
import Link from "next/link";
import { ArrowIcon } from "./icons";

export function DashboardCard({
  href,
  Icon,
  title,
  stat,
  children,
}: {
  href: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: ReactNode;
  stat: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-leaf border border-hairline bg-paper-raised p-4 transition-colors duration-150 hover:bg-paper-sunk hover:border-spine/40"
    >
      <div className="flex items-center gap-2 text-graphite">
        <Icon className="text-spine" />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em]">{title}</span>
        <ArrowIcon className="ml-auto size-4 text-graphite opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="font-display mt-2 text-lg text-ink tabular-nums">{stat}</div>
      {children && <div className="mt-2 text-[13px] text-graphite">{children}</div>}
    </Link>
  );
}
