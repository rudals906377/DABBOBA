"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ko"><body><main className="loading-state"><div className="panel">
      <h1>관리자 화면을 불러오지 못했습니다.</h1>
      <p>잠시 후 다시 시도하고, 반복되면 API 연결 설정을 확인하세요.</p>
      <button onClick={reset}>다시 시도</button>
    </div></main></body></html>
  );
}
