# 출시 준비 의존성 수정 — 2026-10-01

작업 위치: `/Users/kyoungmin/Desktop/DBB/.dabboba-launch-step1`.
운영 배포·원격 푸시·외부 계정 변경은 하지 않았다.

## 수정 범위

- API의 `@fastify/rate-limit@11.2.0`이 실제 사용하는 전이 의존성 `ip-address`를 `10.5.0` → `10.7.2`로 갱신했다.
- 기존 `^10.2.0` 허용 범위 안의 갱신이다. package.json, 직접 의존성 버전, 강제 override, 요청 제한 설정·허용량·인증 로직은 변경하지 않았다.
- pnpm 잠금 파일의 해당 package/integrity/snapshot 연결만 바뀌었다. 모바일·관리자 프레임워크와 다른 라이브러리를 함께 업데이트하지 않았다.

## 원인과 회귀 증거

수정 전 production audit에는 moderate 4건이 있었다. 알려진 문제는 주소 범위 판정 및 과도한 IPv6 입력 진단 처리다. 업스트림 근거: [교차 주소 계열의 subnet 판정](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-j6r3-76f7-8jcv), [입력 길이에 비례하는 진단 처리](https://github.com/beaugunderson/ip-address/security/advisories/GHSA-h3mg-xc3c-68pw).

API가 직접 이 문제의 subnet 판정을 사용한다고 주장하지 않는다. 실제 limiter는 Node IP 검증 후 주소를 정규화하며, 신뢰 헤더도 길이를 제한한다. 취약 라이브러리를 그대로 남기지 않으면서 이 기존 경계를 보존하는 수정이다.

- 실제 API limiter가 해석하는 의존성 복사본으로 새 회귀 검사 3개를 실행했다. 교차 IPv4/IPv6 subnet 판정과 길이 제한 진단의 2개 검사는 기존 `10.5.0`에서 예상대로 실패하고, `10.7.2`에서 모두 통과했다. 자원 고갈을 일으키는 대형 입력 대신 512문자의 작은 fixture를 사용했다.
- API 요청 제한 검사는 8개 통과했다. IPv4-mapped IPv6, IPv6 축약/확장 표기, 과도하거나 잘못된 신뢰 헤더에 대한 3개 사례를 추가했다. 같은 네트워크의 bucket 동작·세션 digest·익명 로그인 제한은 유지했다.
- `pnpm install --frozen-lockfile`, API 및 그 공유 의존성 빌드, API 타입 검사가 통과했다.
- 전체 루트 단위 1,028개·TypeScript 8개가 통과했다. 실패·건너뜀 0개다.
- API의 전체 PostgreSQL 통합 검사 356개가 최종 통과했다. 실패·건너뜀 0개다. 전용 로컬 컨테이너만 사용했고 운영 DB는 접속하지 않았다.
- 고객/관리자 Supabase Edge bundle을 각각 임시 경로에 생성했다. 각각 1,396,832바이트이며 금지 외부 패키지·통합 전용 entry·크기 검사가 통과했다. 실제 Supabase 실행/배포 증거는 아니다.
- 수정 후 production audit 결과는 info/low/moderate/high/critical 모두 0개다. 현재 registry의 알려진 취약점 조회 결과로, 전체 보안 무결함이나 운영 반영을 증명하지 않는다.
- 보호 런타임 28개 및 변경 형식 검사가 통과했다.

## 실패를 보존한 환경 준비 기록

첫 API 통합 실행은 353개 통과·3개 실패였다. 전용 시험 컨테이너의 `dabboba_runtime` 역할이 `NOLOGIN`인 것을 직접 조회했고, 실패 3개 모두 SQLSTATE `28000` 및 같은 로그인 거부였다. 의존성 문제로 재분류하거나 결과를 삭제하지 않았다. CI와 같은 역할 준비 스크립트를 **해당 로컬 fixture DB에서만** 실행하고 `rolcanlogin=true`를 확인한 뒤 같은 전체 검사를 다시 실행해 위 356개 통과 결과를 얻었다. 작업 후 전용 컨테이너는 다시 중지하고 삭제하지 않았다.

실행 증거: `/tmp/dabboba-dependency-qa.R2Dr49/`의 `before-audit.json`, `security-before.log`, `update.log`, `after-audit.json`, `install.log`, `api-build.log`, `api-typecheck.log`, `unit-tests.log`, `api-tests.log`, `runtime-role.log`, `api-tests-after-role-setup.log`, `edge-build.log`. 임시 로그는 정기 운영 보관소가 아니다.
