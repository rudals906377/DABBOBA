# Supabase Edge 실행 환경 준비 — 2026-10-01

## 범위

기준 소스는 `b1482ee`와 이번 관리자 진입 파일 수정이다. Deno 2.9.6을 전용 임시 경로에 설치하고 고객·관리자·worker 번들을 최신 소스로 다시 만들었다. 운영 환경 파일·클라우드 토큰을 가져오지 않았다. 원격 배포나 운영 함수 호출은 하지 않았다.

전용 PostgreSQL 17/pgmq 컨테이너 `dabboba-launch-edge-20261001-b1482ee`만 사용했다. `disposable-launch-edge-qa` label, CI 이미지 digest, `127.0.0.1:55441`, 전용 DB `dabboba_edge_test`를 확인하고 82개 마이그레이션과 제한된 API 역할을 준비했다. 접속 값은 운영과 관계없는 CI fixture다. Deno 실행 환경을 비우고 테스트 네트워크 권한은 `127.0.0.1`로 제한했다. 다른 앱의 계정·컨테이너·기기를 사용하지 않았다.

## 발견한 결함과 수정

관리자 진입 파일이 `Response | undefined`를 그대로 `Deno.serve`에 반환해 실제 Deno 타입 검사에서 TS2769로 실패했다. 고객 진입 파일과 동일하게 정상 응답은 그대로 전달하고, 응답이 없을 때 캐시하지 않는 `API_UNAVAILABLE` 503을 반환하도록 수정했다. 관리자 surface, 인증·서명 검증 및 환경 접근 규칙은 변경하지 않았다.

실제 두 진입 파일의 등록 코드를 실행하는 회귀 검사 4개를 추가했다. 생성된 앱 경계만 대체하며 서버·클라우드·이미지 처리는 실행하지 않는다. 수정 전에는 관리자 무응답 검사만 실패했고 수정 후 4개 모두 통과했다. 별도로 고객·관리자·worker의 실제 Deno 진입 파일 검사도 모두 통과했다.

## 실행 결과

- 고객 번들 기본 smoke 1개 통과.
- 실제 Fastify 고객 표면과 제한된 로컬 DB 통합 검사 1개 통과: health/readiness/catalog, 인증 401, 관리자 표면 404, CORS 204, HEAD 빈 body, 원본 JSON 바이트 HMAC, 동시 요청 8개.
- 실제 ImageMagick WASM 이미지 검사 2개 통과: decode/metadata 제거/WebP 출력과 잘못된 형식 거부.
- worker 기본 smoke 1개 통과: 인증·환경 미설정 실패 경계.
- 고객·관리자·worker 진입 파일 타입 검사 3곳 통과. 타입 검사를 생략하지 않았다.
- 모바일 보호 파일 28개 무결성 및 변경 공백 검사 통과.
- 수정 후 전체 루트 단위 검사 1,032개와 TypeScript 검사 8개 통과. 실패·건너뛴 검사는 0개다.

첫 이미지 검사는 macOS `/tmp`가 `/private/tmp`로 해석되어 제한된 읽기 권한과 일치하지 않아 실패했다. 소스를 바꾸거나 전체 파일 읽기 권한을 주지 않고 이 전용 경로의 canonical 주소만 허용해 재실행했다. 최초 실패 로그를 보존했다. Fastify의 기존 deprecation 경고는 남아 있으며 경고가 없다고 주장하지 않는다.

## 증거와 한계

실행 로그와 생성 번들은 `/tmp/dabboba-deno-release-qa.Dbd0on`에 있다. `admin-entry-check.log`는 수정 전 실패, `admin-entry-check-final.log`는 수정 후 통과다. `api-runtime-final.log`의 4개와 `worker-runtime-final.log`의 1개가 최종 실행 결과다. 임시 로그 폴더는 정기 보관소가 아니다. 검증 후 전용 컨테이너를 중지하고 DB는 재검사할 수 있게 남긴다.

통합 검사는 Deno에서 실제 핸들러를 호출했지만 Supabase 호스팅·실제 HTTP ingress·운영 DB·PG·Apple 토큰 폐기·실기기 증거는 아니다. 운영 함수 배포, 소유 계정 확인, 비밀 설정, 원격 read-only 점검은 로그인 가능한 시점에 별도로 진행한다. PRELAUNCH 차단은 유지한다.
