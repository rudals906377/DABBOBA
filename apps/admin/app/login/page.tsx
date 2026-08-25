import { redirect } from "next/navigation";
import { getAdminSession } from "../../lib/auth";
import type { SearchParams } from "../../lib/admin-types";
import { first } from "../../components/operations";
import { safeInternalPath } from "../../lib/request-security";

const ERROR_MESSAGES: Record<string, string> = {
  "invalid-credentials": "이메일과 12자 이상의 비밀번호를 확인하세요.",
  "login-failed": "로그인에 실패했습니다. 계정 상태와 입력값을 확인하세요.",
  "not-authorized": "활성 관리자 계정만 접근할 수 있습니다.",
  "invalid-session": "유효한 관리자 세션을 만들지 못했습니다.",
  "login-context-unavailable": "로그인 보안 정보를 확인하지 못했습니다. 잠시 후 다시 시도하세요.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;
  const session = await getAdminSession();
  const next = safeInternalPath(first(query.next));
  if (session) redirect(next);
  const error = first(query.error);
  const reason = first(query.reason);

  return (
    <main className="login-shell">
      <section className="login-brand">
        <div><strong>DABBOBA</strong><br /><span>PRIVILEGED OPERATIONS</span></div>
        <div>
          <h1>운영 판단을<br />안전하게 기록합니다.</h1>
          <p>회원, 커뮤니티, 고객 문의와 카탈로그를 한곳에서 관리합니다. 실제 권한과 모든 상태 변경은 API 서버가 최종 판단합니다.</p>
        </div>
        <span>NO PUBLIC SIGN-UP · NO FIXTURE FALLBACK</span>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="status-badge">ADMIN ACCESS</span>
          <h2>관리자 로그인</h2>
          <p>발급받은 운영 계정으로만 로그인할 수 있습니다.</p>
          {error ? <p className="feedback" data-kind="error" role="alert">{ERROR_MESSAGES[error] || "로그인을 완료하지 못했습니다."}</p> : null}
          {reason === "signed-out" ? <p className="feedback" data-kind="success" role="status">안전하게 로그아웃했습니다.</p> : null}
          {reason === "session-required" ? <p className="feedback" data-kind="error" role="status">로그인이 필요하거나 세션이 만료되었습니다.</p> : null}
          <form action="/api/auth/login" method="post">
            <input type="hidden" name="next" value={next} />
            <label>이메일<input name="email" type="email" autoComplete="username" inputMode="email" maxLength={254} required autoFocus /></label>
            <label>비밀번호<input name="password" type="password" autoComplete="current-password" minLength={12} maxLength={256} required /></label>
            <button type="submit">로그인</button>
          </form>
          <div className="login-security">세션 토큰은 Secure · HttpOnly · SameSite=Strict 쿠키에만 저장되며 브라우저 스크립트와 저장소에 노출되지 않습니다.</div>
        </div>
      </section>
    </main>
  );
}
