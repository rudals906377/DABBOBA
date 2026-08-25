"use client";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="panel">
      <span className="status-badge" data-status="hidden">ERROR</span>
      <h1>데이터를 불러오지 못했습니다.</h1>
      <p className="muted">API 연결 또는 권한 상태를 확인한 뒤 다시 시도하세요. 민감한 오류 내용은 화면에 표시하지 않습니다.</p>
      <button onClick={reset}>다시 시도</button>
    </div>
  );
}
