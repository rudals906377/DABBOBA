import type { Actor } from "../lib/admin-types";
import { can } from "../lib/capabilities";
import { ADMIN_NAVIGATION } from "../lib/navigation";
import { AdminSessionKeepalive } from "./admin-session-keepalive";
import { BrandWordmark } from "./brand-wordmark";
import { SidebarNav } from "./sidebar-nav";

export function AdminShell({ actor, children }: { actor: Actor; children: React.ReactNode }) {
  const navigation = ADMIN_NAVIGATION.filter((item) => can(actor, item.capability));

  return (
    <div className="admin-frame">
      <AdminSessionKeepalive />
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand__wordmark-surface"><BrandWordmark /></span>
          <span>관리자 페이지</span>
        </div>
        <SidebarNav items={navigation} />
        <div className="admin-identity">
          <span>{actor.role}</span>
          <strong>{actor.nickname}</strong>
          <form action="/api/auth/logout" method="post">
            <button type="submit">로그아웃</button>
          </form>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-topbar">
          <span>다뽀바 운영</span>
          <p>필요한 메뉴를 왼쪽에서 선택하세요. 변경 내역은 안전하게 기록됩니다.</p>
        </header>
        <div className="admin-content">{children}</div>
      </div>
    </div>
  );
}
