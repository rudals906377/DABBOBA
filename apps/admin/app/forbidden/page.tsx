import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <main className="loading-state">
      <div className="panel" style={{ maxWidth: 520, textAlign: "center" }}>
        <span className="status-badge" data-status="banned">403</span>
        <h1>이 화면에 접근할 권한이 없습니다.</h1>
        <p className="muted">서버가 현재 관리자 역할에 이 기능을 허용하지 않았습니다.</p>
        <div className="form-actions">
          <Link className="button-link" href="/">대시보드로</Link>
          <form action="/api/auth/logout" method="post"><button type="submit">로그아웃</button></form>
        </div>
      </div>
    </main>
  );
}
