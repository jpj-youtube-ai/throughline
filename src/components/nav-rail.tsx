"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SVGProps, ComponentType } from "react";
import { DashboardIcon, SpecIcon, ConnectIcon } from "./icons";

const ITEMS: { href: string; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { href: "/dashboard", label: "Dashboard", Icon: DashboardIcon },
  { href: "/spec", label: "Spec", Icon: SpecIcon },
  { href: "/connect", label: "Connect", Icon: ConnectIcon },
];

export function NavRail() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Sections" className="flex flex-col items-center gap-1.5">
      {ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            title={label}
            className={`group flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
              active ? "bg-spine-wash text-spine-deep" : "text-graphite hover:bg-paper-sunk hover:text-ink"
            }`}
          >
            <Icon className={active ? "text-spine" : ""} />
          </Link>
        );
      })}
    </nav>
  );
}
