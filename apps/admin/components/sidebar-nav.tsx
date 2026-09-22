"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AdminNavigationItem } from "../lib/navigation";

export function SidebarNav({ items }: { items: readonly AdminNavigationItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="sidebar-nav" aria-label="관리 메뉴">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
            <span>{item.eyebrow}</span>
            <strong>{item.label}</strong>
          </Link>
        );
      })}
    </nav>
  );
}
