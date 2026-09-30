"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { AdminNavigationItem } from "../lib/navigation";

export function SidebarNav({ items }: { items: readonly AdminNavigationItem[] }) {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const visibleItems = items.filter((item) => item.label.includes(search.trim()));

  return (
    <nav className="sidebar-nav" aria-label="관리 메뉴">
      <label className="sidebar-nav__search">
        <span>메뉴 찾기</span>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="예: 상품, 배송" autoComplete="off" />
      </label>
      {visibleItems.length === 0 ? <p className="sidebar-nav__empty">일치하는 메뉴가 없어요.</p> : null}
      {visibleItems.map((item) => {
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
