import Link from "next/link";
import { PageHeader, formatDate } from "../../components/operations";
import { adminApi } from "../../lib/api";
import { requireCapability } from "../../lib/auth";
import type { AdminDashboard } from "../../lib/admin-types";

export default async function DashboardPage() {
  const session = await requireCapability("dashboard.read");
  const dashboard = await adminApi<AdminDashboard>("/v1/admin/dashboard", { token: session.token });
  const metrics = [
    ["전체 회원", dashboard.totalUsers, "/users", `오늘 +${dashboard.usersJoinedToday}`],
    ["오늘 게시물", dashboard.postsToday, "/posts", `스냅 ${dashboard.snapsToday}`],
    ["미답변 문의", dashboard.unansweredInquiries, "/inquiries?status=PENDING", "답변 대기"],
    ["처리 대기 신고", dashboard.pendingReports, "/reports?status=PENDING", "검토 필요"],
    ["상품 등록 신청", dashboard.pendingProductRequests, "/catalog/requests?status=PENDING", "승인 대기"],
    ["IP 등록 신청", dashboard.pendingIpRequests, "/catalog/requests?status=PENDING", "승인 대기"],
  ] as const;

  return (
    <>
      <PageHeader eyebrow="OPERATIONS OVERVIEW" title="대시보드" description={`API 집계 기준 ${formatDate(dashboard.generatedAt)} · 수치는 서버 원장을 기준으로 표시됩니다.`} />
      <section className="metric-grid">
        {metrics.map(([label, value, href, note]) => <Link className="metric-card" href={href} key={label}><span>{label}</span><strong>{value.toLocaleString("ko-KR")}</strong><em>{note}</em></Link>)}
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>우선 처리 큐</h2><p>고객 응답과 안전 조치가 필요한 항목부터 확인하세요.</p></div></div>
        <div className="quick-links">
          <Link className="button-link primary" href="/inquiries?status=PENDING">미답변 문의 {dashboard.unansweredInquiries}</Link>
          <Link className="button-link" href="/reports?status=PENDING">대기 신고 {dashboard.pendingReports}</Link>
          <Link className="button-link" href="/catalog/requests?status=PENDING">카탈로그 신청 {dashboard.pendingProductRequests + dashboard.pendingIpRequests}</Link>
        </div>
      </section>
    </>
  );
}
