import type { Actor } from "../lib/admin-types";
import { can } from "../lib/capabilities";
import { ADMIN_NAVIGATION } from "../lib/navigation";
import { SidebarNav } from "./sidebar-nav";

export function AdminShell({ actor, children }: { actor: Actor; children: React.ReactNode }) {
  const navigation = ADMIN_NAVIGATION.filter((item) => can(actor, item.capability));

  return (
    <div className="admin-frame">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <strong>DABBOBA</strong>
          <span>OPERATIONS</span>
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
          <span>PRIVILEGED CONSOLE</span>
          <p>모든 변경은 서버 권한 검사와 감사 로그를 거칩니다.</p>
        </header>
        <div className="admin-content">{children}</div>
      </div>
    </div>
  );
}
