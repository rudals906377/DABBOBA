# DABBOBA 운영 런북

## 목적과 제한

이 런북은 현재 TypeScript 모듈러 모놀리스의 로컬 기동, 배포 순서, 관측, 백업·복원 훈련, 장애 대응 기준을 설명한다. 특정 클라우드 배포나 실제 결제·스토어 출시가 완료됐음을 뜻하지 않는다. 운영 계정과 공급자별 명령은 계정이 정해진 뒤 별도 비밀 런북에 추가한다.

## 1. 로컬 기동

### 사전 조건

- Node.js 24와 Corepack
- Docker Desktop 또는 Docker Engine + Compose
- 저장소의 `packageManager`에 고정된 pnpm 버전
- 비밀값이 없는 로컬 `.env`; 이 파일은 Git에서 제외됨

### 최초 준비

```sh
corepack pnpm --version
corepack pnpm install --frozen-lockfile
test -f .env || cp .env.example .env
test -f apps/admin/.env.local || cp apps/admin/.env.example apps/admin/.env.local
corepack pnpm run workspace:assert
```

API, DB CLI, worker는 `.env`를 자동으로 읽지 않는다. 로컬 셸에 값을 export하거나 승인된 환경 주입 도구를 사용한다. 관리자 Next 앱은 `apps/admin/.env.local`을 읽는다. 실서비스 비밀을 로컬 파일, Git, 이슈, 채팅에 복사하지 않는다.

### PostgreSQL과 Redis

```sh
corepack pnpm run local:services
corepack pnpm run db:migrate
```

`db:migrate`는 advisory lock, 파일 순서, 체크섬, `schema_migrations`를 사용한다. 이미 적용한 SQL 파일을 수정하면 체크섬 오류로 중단된다. 적용된 migration을 고치지 말고 새 번호의 forward migration을 추가한다.

탈퇴 승인과 고객 변경 요청은 사용자별 advisory lock으로 직렬화된다. 운영자가 승인에 성공한 뒤에는 해당 사용자의 활성 세션이 폐기되고 새 idempotent 변경이 DB trigger에서 거부된다. 승인 계정을 다시 활성화하거나 DB에서 탈퇴 상태를 직접 되돌리지 말고, 보존·재가입 정책에 따른 별도 운영 절차를 사용한다.

개발 화면에 카탈로그 fixture가 필요할 때만 다음을 실행한다.

```sh
corepack pnpm run db:seed
```

seed는 로컬 개발 자료이며 라이선스가 확인된 운영 카탈로그가 아니다.
운영 환경에서는 기본적으로 즉시 실패한다. 정말 필요한 초기 삽입 작업만 승인 후 `DABBOBA_ALLOW_PRODUCTION_SEED=true`를 일시적으로 주며, 이 경우에도 기존 카탈로그·가격·재고는 절대 덮어쓰지 않고 없는 행만 추가한다. 작업 직후 플래그를 제거하고 결과를 운영 감사 기록에 별도로 남긴다.

### 첫 관리자 만들기

최초 한 번만 bootstrap CLI를 사용한다. 비밀번호는 12자 이상이어야 하며 명령 기록에 남지 않도록 대화형 비밀 주입 도구를 우선한다.

```sh
corepack pnpm --filter @dabboba/api bootstrap:admin
```

명령 실행 시 `DABBOBA_BOOTSTRAP_ADMIN_EMAIL`, `DABBOBA_BOOTSTRAP_ADMIN_NICKNAME`, `DABBOBA_BOOTSTRAP_ADMIN_PASSWORD`, `DABBOBA_BOOTSTRAP_ADMIN_ROLE`을 환경에서 제공한다. 운영에서는 그 명령에 한해 `ALLOW_ADMIN_BOOTSTRAP=true`를 주고 즉시 제거한다. 같은 이메일이 있으면 CLI가 중단되며 이후 관리자는 인증된 `SUPER_ADMIN` 화면에서 만든다.

### 관리자 로그인 프록시 신뢰 경계

운영 관리자 로그인은 브라우저 → 신뢰하는 edge → Next 관리자 BFF → Fastify API 순서로만 전달한다. 배포 전에 다음을 모두 설정한다.

- `ADMIN_PROXY_IDENTITY_SECRET`: 관리자 BFF와 API에 동일하게 주입하는 전용 32–512 byte 비밀값. `SESSION_TOKEN_PEPPER`와 반드시 다르게 생성하고 저장소나 일반 로그에 남기지 않는다.
- `ADMIN_EDGE_CLIENT_IP_HEADER`: 첫 신뢰 edge가 외부에서 들어온 동명 header를 제거한 뒤 실제 접속 IP 하나로 항상 덮어쓰는 provider 공식 전용 header 이름. comma-separated proxy chain이나 운영자가 덮어쓰기 동작을 확인하지 않은 header는 사용하지 않는다. 설정 loader는 일반 `Forwarded`/`X-Forwarded-For`와 내부 서명 header 이름을 거부한다.

Next BFF는 지정 header의 단일 IPv4/IPv6 주소와 정규화한 `User-Agent`, 발급 시각을 로그인 전용 HMAC에 포함한다. API는 서명과 60초 freshness를 확인한 동일 identity를 로그인 rate-limit key, `admin_login_events`, 관리자 session에 사용한다. Fastify의 `trustProxy`는 계속 `false`이며 API는 임의의 `X-Forwarded-For`를 신뢰하지 않는다. 운영에서 서명 header가 없거나 변조·만료되면 로그인은 DB 인증 전에 401로 중단된다. 개발·테스트에서 두 설정을 비워 두면 기존 direct socket IP fallback만 허용된다.

운영 ingress와 내부 경계에는 다음 조건도 적용한다.

1. edge가 `ADMIN_EDGE_CLIENT_IP_HEADER`를 제거·덮어쓰는 동작을 배포 설정과 실제 요청으로 확인한다.
2. edge는 외부의 `x-dabboba-admin-client-*` header를 제거한다. Next BFF가 API 요청을 새로 만들며 이 내부 header를 생성한다.
3. BFF→API 구간은 HTTPS와 network policy/service identity로 제한한다. HMAC secret 보유만으로 네트워크 접근 통제를 대신하지 않는다.
4. 양쪽 서버 시계를 NTP로 동기화한다. 60초보다 큰 오차는 의도적으로 fail closed 된다.
5. secret 회전은 BFF/API를 함께 갱신하는 배포로 수행한다. 값이 어긋난 동안 새 로그인은 실패하지만 기존 관리자 session은 유지된다.

### 일반 API rate-limit 신뢰 경계

Fastify의 일반 `trustProxy`는 의도적으로 `false`를 유지한다. 배포 토폴로지를 모르는 애플리케이션이 `Forwarded`나 `X-Forwarded-For`를 임의로 신뢰하면 공격자가 rate-limit key를 바꿀 수 있다. 반대로 TLS ingress 뒤에서 모든 요청이 같은 socket IP로 보이면 한 사용자가 공유 예산을 소진해 다른 사용자를 차단할 수 있다.

출시 전에 배포 경계에 맞춰 다음 중 하나를 선택하고 구성한다.

1. API가 실제 client IP를 사용해야 한다면 신뢰할 proxy CIDR 또는 정확한 hop만 제한적으로 설정하고, 첫 신뢰 edge가 외부 forwarding header를 제거한 뒤 표준값으로 항상 덮어쓴다.
2. 애플리케이션의 `trustProxy: false`를 유지한다면 edge/WAF가 실제 client IP별 일반 API rate-limit을 담당하고, 애플리케이션 제한은 내부 coarse guard로만 사용한다.

실제 ingress를 통과하는 통합 테스트에서 서로 다른 두 source IP가 독립 예산을 갖는지, 한 IP의 초과 요청만 429가 되는지, 위조한 `Forwarded`/`X-Forwarded-For`가 key를 바꾸지 못하는지를 확인한다. webhook처럼 공급자 retry가 필요한 경로는 별도 공급자 allowlist/용량 정책도 확인한다. 구성과 테스트 증거가 없으면 출시를 중단한다.

### 애플리케이션

각 프로세스를 별도 터미널에서 실행한다.

```sh
corepack pnpm run dev:api
corepack pnpm run dev:worker
corepack pnpm run dev:admin
corepack pnpm run dev
```

기본 주소:

- 고객 웹: `http://127.0.0.1:4174` (`dev:lan` 기준) 또는 Vite가 출력한 loopback 주소
- API liveness/readiness: `http://127.0.0.1:8788/healthz`, `http://127.0.0.1:8788/readyz`
- 관리자 웹: `http://localhost:4180`
- worker liveness/readiness/metrics: `http://127.0.0.1:8791/live`, `/ready`, `/metrics`

관리자 쿠키는 `Secure`로 설정된다. 로컬 관리자는 브라우저의 localhost secure-cookie 예외가 적용되는 `http://localhost:4180`을 우선하고, 쿠키가 저장되지 않으면 HTTPS local proxy로 확인한다.

서비스를 멈출 때 `corepack pnpm run local:services:stop`은 컨테이너만 중지하고 named volume은 보존한다. volume 삭제는 데이터 삭제 작업이므로 이 런북의 일반 종료 절차에 포함하지 않는다.

## 2. 변경 검증

로컬 의존성을 설치한 뒤 다음 순서로 확인한다.

```sh
corepack pnpm run workspace:assert
corepack pnpm --filter @dabboba/contracts generate
corepack pnpm run build:all
corepack pnpm exec turbo run typecheck
test -n "$DABBOBA_DISPOSABLE_TEST_DATABASE_URL"
DABBOBA_TEST_DATABASE_URL="$DABBOBA_DISPOSABLE_TEST_DATABASE_URL" corepack pnpm exec turbo run test --force
corepack pnpm run test:sites
corepack pnpm run test:runtime
git diff --check
```

DB 변경은 disposable PostgreSQL에서 migration을 두 번 실행해 첫 실행은 적용되고 두 번째 실행은 no-op인지 확인한다. 마이그레이션이 적용된 전용 테스트 DB에서 다음처럼 PostgreSQL 통합 테스트를 별도로 실행한다. 이 URL은 운영이나 보존해야 할 로컬 DB가 아니라 해당 검증만을 위한 DB여야 한다.

```sh
test -n "$DABBOBA_DISPOSABLE_TEST_DATABASE_URL"
DABBOBA_TEST_DATABASE_URL="$DABBOBA_DISPOSABLE_TEST_DATABASE_URL" \
  corepack pnpm exec turbo run test --force
```

이 통합 스위트는 일반 사용자/관리자 세션 분리, 관리자 RBAC, 공지 lifecycle, 문의 내부 메모 비노출, 신고 제재, 감사 로그 불변성, 교환 동시 수락·양측 완료·운영 해결과 소유권 이전을 실제 PostgreSQL에서 확인한다. 또한 배송 목록/상세의 사용자 소유권·송장 상태, `AVAILABLE` 추첨권 pagination, 알림 수신 설정의 기본값·낙관적 버전·same-key replay/다른 payload 충돌·append-only 동의 event/outbox, 미디어 intent/complete idempotency와 만료 410·미연결 삭제/연결 충돌을 확인한다. GCS, 실제 PG, APNs/FCM과 실기기는 별도 sandbox/기기 검증 대상이다.

## 3. 배포 순서

현재 저장소에는 배포 IaC가 없다. 배포 플랫폼을 정한 뒤에도 다음 순서를 유지한다.

1. CI의 workspace와 disposable DB migration job이 모두 통과했는지 확인한다. `corepack pnpm audit --prod --audit-level high`도 통과시키고, EAS가 루트 `pnpm-lock.yaml`을 사용하는지 확인한다.
2. 운영 PostgreSQL의 자동 백업/PITR 상태와 최신 복원 훈련 결과를 확인한다.
3. 운영 secret manager에 새 release가 필요로 하는 환경값이 있는지 확인한다.
   관리자 배포에서는 BFF/API의 `ADMIN_PROXY_IDENTITY_SECRET` 일치, edge의 `ADMIN_EDGE_CLIENT_IP_HEADER` overwrite, 서버 시계 동기화도 함께 확인한다.
   일반 API는 신뢰 proxy 범위/hop 또는 edge/WAF 실제 client IP별 rate-limit 구성을 확인하고, 애플리케이션에서 미검증 `trustProxy`를 켜지 않는다.
4. 단일 migration job에서 `corepack pnpm run db:migrate`를 실행한다. API/worker replica 각각에서 migration을 자동 실행하지 않는다.
5. 이전 앱 버전과 새 schema가 함께 동작하는 expand/contract 방식인지 확인한 뒤 API를 점진 배포한다.
6. worker를 배포하고 `/ready`, unpublished outbox depth, failed job 수를 확인한다.
7. 관리자 웹과 고객 웹을 배포하고 정확한 HTTPS origin/CORS를 확인한다.
8. 읽기 smoke test 후 공지 작성→공개 조회, 문의 작성→관리자 답변→사용자 조회, 신고→처리→감사 로그의 sandbox 흐름을 확인한다.
9. PG sandbox에서 주문 idempotency, webhook 서명 거부, 중복 event, 재고 확정, 환불 검토, 추첨권 단일 소비를 확인한다.
10. 고객 계정에서 배송 목록→상세/송장, 취소된 신청의 재신청 복구와 배송 완료 상품 제외, 새로고침 후 `AVAILABLE` 추첨권 재개, 알림 선택 해제 후 인앱 기록 유지·외부 전달 차단을 확인한다. session refresh 중 일시적 장애는 만료 전 재시도되고 401은 session을 폐기하는지도 확인한다. 실제 GCS에서는 intent/complete replay, 만료 410 뒤 같은 client action key가 폐기되는지, 미연결 미디어 삭제와 연결 미디어 409, worker 재정리를 확인한다.
11. 오류율, latency, DB lock, outbox, queue, 결제 조정 지표를 관찰한 뒤 release를 완료한다.

### 롤백

- 마이그레이션에는 자동 down script가 없다. 적용된 파일을 되돌리거나 수정하지 않는다.
- 새 schema가 이전 앱과 호환되면 애플리케이션만 이전 image로 되돌린다.
- 호환되지 않으면 트래픽을 제한하고 forward-fix migration과 애플리케이션을 배포한다.
- 결제·포인트·재고·추첨 원장은 SQL로 임의 수정하지 않는다. 보정 API 또는 append-only 보상 원장 작업으로 처리하고 관리자 사유와 incident ID를 남긴다.
- 알림 수신 설정을 SQL로 직접 바꾸거나 consent event를 수정·삭제하지 않는다. 사용자 API와 낙관적 버전으로 변경해 변경 전후 evidence와 outbox를 함께 남긴다.
- 복원은 마지막 수단이다. 외부 PG 사건 이후 DB만 과거로 돌리면 공급자 결제와 불일치할 수 있으므로 복원 시점 이후 event를 반드시 재조정한다.

## 4. 백업과 복원 훈련

### 운영 요구

- PostgreSQL: 암호화 자동 백업, PITR, 별도 장애 도메인 복제, 삭제 보호
- GCS: 비공개 bucket, `uploads/` staging prefix의 짧은 lifecycle, 최종 object 보존 lifecycle, 접근·요청 로그. V4 form POST는 만료 전 동일 조건 재전송이 가능하므로 create-only 요청으로 간주하지 않음. 미연결 소유 미디어 삭제의 즉시 삭제와 worker 재시도도 실제 bucket에서 확인
- 비용·abuse: GCS operation/request 급증과 저장 용량에 Cloud Monitoring·Billing budget alert를 설정하고, edge WAF/IP rate limit·계정 생성 속도 제한·비정상 업로드 계정 차단을 운영 정책으로 연결
- Redis: persistence와 고가용성. 단, Redis backup을 업무 원장 복구 수단으로 사용하지 않음
- secret: 버전 관리와 감사 가능한 secret manager; 코드/DB dump/log에 평문 포함 금지

RPO, RTO, 보존 기간, 복구 승인자는 사용자가 정해야 한다. 설정 화면을 캡처한 것만으로 끝내지 말고 최소 분기마다 별도 복원 환경에서 훈련한다.

### 논리 백업 예시

다음은 읽기 가능한 source URL과 저장소 밖의 암호화된 backup directory를 준비한 뒤 실행하는 예시다. `DABBOBA_BACKUP_DIR`은 미리 만든 명시적인 절대 경로여야 한다.

```sh
test -n "$DABBOBA_BACKUP_DIR"
test -d "$DABBOBA_BACKUP_DIR"
pg_dump --format=custom --no-owner --no-acl \
  --dbname "$DABBOBA_BACKUP_SOURCE_URL" \
  --file "$DABBOBA_BACKUP_DIR/dabboba-$(date +%Y%m%dT%H%M%S).dump"
```

dump 파일에는 개인정보, 알림 동의 변경 evidence와 업무 원장이 포함되므로 암호화하고 접근과 보존을 제한한다. 운영 URL을 명령 기록에 직접 쓰지 않는다. 동의 event의 보존 기간은 승인된 개인정보·마케팅 정책에 맞춰 별도로 정한다.

### 복원 훈련

1. 운영과 분리된 계정/프로젝트에 빈 `dabboba_restore_drill_<date>` DB를 만든다.
2. `DABBOBA_RESTORE_DRILL_URL`이 그 전용 빈 DB를 가리키는지 두 사람이 확인한다.
3. `pg_restore --exit-on-error --no-owner --no-acl --dbname "$DABBOBA_RESTORE_DRILL_URL" <dump-file>`을 실행한다. `--clean`은 사용하지 않는다.
4. `schema_migrations` 버전/체크섬, 주요 테이블 row count, FK/trigger, 최근 주문·결제·추첨 원장 연결을 확인한다.
5. 복원 DB에 API/worker를 격리 연결하고 읽기 smoke test와 migration no-op을 확인한다. 외부 알림과 결제 webhook outbound는 비활성화한다.
6. 실제 소요 시간, 마지막 복구 가능 시점, 누락, 후속 작업을 기록해 RPO/RTO와 비교한다.
7. 삭제 승인 후 관리형 DB 콘솔에서 정확한 drill DB만 폐기한다. 일반 운영 명령에 자동 삭제를 넣지 않는다.

## 5. 관측과 알림

### 현재 노출된 신호

- API: `/healthz`는 PostgreSQL/Redis 상태를 반환하고 `/readyz`는 PostgreSQL 실패 시 503
- worker: `/live`, `/ready`, `/health`, process-local JSON `/metrics`
- 구조화 로그: request/correlation, 작업 ID, aggregate ID; 인증 header/cookie/password/token redaction
- PostgreSQL: unpublished/failed outbox, 오래된 예약, 결제 조정 대상, 감사 로그
- BullMQ: waiting/active/delayed/failed 수와 반복 실패

### 출시 전 반드시 연결할 알림

- API/worker readiness 실패와 오류율 상승
- DB 연결/저장 공간/replication lag/lock 대기/PITR 실패
- unpublished outbox age와 depth, BullMQ failed/retry 폭증
- 만료되지 않은 오래된 재고 예약
- `PENDING`, `AUTHORIZED`, `REFUND_REVIEW` 결제 backlog
- 재고 음수 방지 위반, 추첨 pool 소진, draw entitlement/result 불일치
- 관리자 로그인 실패 급증과 고위험 감사 이벤트
- GCS 처리 실패·POST 요청/저장량 급증·staging/deleted cleanup backlog, CDN 오류, 알림 공급자 실패와 선택 해제된 외부 알림 전달 시도

현재 `/metrics`는 process-local JSON이다. Prometheus exporter, 중앙 로그, 에러 추적, dashboard, paging destination은 배포 플랫폼에서 별도로 구성해야 한다.

## 6. 장애 대응

### 공통

1. incident ID, 시작 시각, 영향 범위, 담당자를 기록한다.
2. 결제/추첨/재고처럼 금전 또는 지급에 영향을 주면 쓰기 트래픽을 우선 제한하고 읽기 증거를 보존한다.
3. DB row를 직접 고치지 않고 공급자 event, ledger, outbox, audit 순서로 사실을 재구성한다.
4. 보정은 idempotent API/작업과 append-only 원장으로 남긴다.
5. 복구 후 재발 방지, 탐지 시간, 복구 시간, 고객 고지를 기록한다.

### PostgreSQL 장애

- API `/readyz`와 worker `/ready`를 확인하고 쓰기 요청을 받지 않게 한다.
- 관리형 DB failover/PITR 상태를 확인한다.
- 복구 후 schema version과 최근 provider event/order ledger를 대조한다.
- outbox publication을 재개하고 backlog가 0으로 수렴하는지 본다.

### Redis/BullMQ 장애

- PostgreSQL 업무 트랜잭션은 계속 outbox를 남길 수 있지만 queue 의존 작업은 지연됨을 공지한다.
- Redis 복구 후 worker를 재기동하고 동일한 stable job ID로 unpublished outbox를 재게시한다.
- `published_at`가 있지만 부수 효과가 불명확한 event는 notification/payment 상태를 기준으로 idempotent 재조정한다.

### 결제 불일치

- webhook 원문, 서명 digest, provider event ID, payment/order ledger를 보존한다.
- provider dashboard/API와 금액·상태를 대조한다.
- 현재 worker adapter는 `UNKNOWN`을 반환하므로 상태를 추측해 변경하지 않는다.
- 소비된 추첨/이동된 보관 상품이 있는 환불은 `REFUND_REVIEW`에서 운영 검토한다.

### 관리자 계정 침해

- 다른 `SUPER_ADMIN`으로 계정을 정지해 활성 session을 revoke한다.
- 관련 감사 로그와 로그인 event를 보존한다.
- 관리자 비밀번호와 관련 외부 계정 비밀을 회전한다.
- `SESSION_TOKEN_PEPPER` 회전은 전체 사용자·관리자 session을 무효화하므로 incident commander 승인과 재로그인 공지가 필요하다.

## 7. 출시 승인 기준

다음이 하나라도 없으면 해당 기능은 출시하지 않는다.

- CI와 실제 환경 migration 증거
- production 인증 provider와 계정 복구 흐름
- PG sandbox/live 승인·webhook·중복·환불·조정 증거
- 권리 확인된 IP/상품 이미지와 법률 문서
- 관리자 최소 권한과 긴급 접근 절차
- 실제 ingress/WAF의 client IP별 일반 API rate-limit과 forwarding header spoofing 방어 통합 증거
- 백업/PITR 설정과 최근 복원 훈련
- 실기기 iPhone/Android 핵심 흐름
- 중앙 로그, 오류 추적, 주요 alert, on-call 담당자
- production dependency high/critical 0, 남은 moderate 보안 승인, 단일 CI/EAS package-manager·lockfile 경계

사용자 준비 목록은 `docs/dabboba-user-actions.md`에 있다.
