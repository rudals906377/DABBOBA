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

### pgmq PostgreSQL과 선택적 로컬 Redis

```sh
corepack pnpm run local:services
corepack pnpm run db:migrate
```

`db:migrate`는 advisory lock, 파일 순서, 체크섬, `schema_migrations`를 사용한다. 이미 적용한 SQL 파일을 수정하면 체크섬 오류로 중단된다. 적용된 migration을 고치지 말고 새 번호의 forward migration을 추가한다.

운영에서는 API `DATABASE_URL`에 `dabboba_runtime`, worker `WORKER_DATABASE_URL`에 `dabboba_worker`, 단일 migration job의 `DATABASE_MIGRATION_URL`에 schema owner를 사용한다. 세 credential은 서로 다른 secret이어야 한다. `0027`부터 `0031`까지의 원자적 queue 보안 migration 묶음, `0032` worker reconciliation migration, `0033` exchange bundle migration, `0034` Home catalog section migration, `0035` sealed kuji slot migration, `0036` draw result integrity migration, `0037` published draw version guard migration까지 적용한다. 새 DB를 만들거나 의도적으로 credential을 회전할 때만 각기 다른 새 비밀번호를 `provision:runtime-role -- --password-stdin`과 `provision:worker-role -- --password-stdin`에 표준입력으로 주입한다. 기존 credential을 release마다 불필요하게 회전하지 않는다. Supabase pooler에서 migration과 worker는 세션 advisory lock이 유지되는 Session mode(5432)만 허용하며 Transaction mode(6543)는 사용하지 않는다. 비밀번호는 migration SQL, 인자, Git에 넣지 말고 secret manager에서 별도로 회전한다. 이 migration 묶음은 `dabboba_runtime`의 pgmq/dead-letter 및 worker 전용 reconciliation 테이블 권한을 회수하므로 API는 해당 경로를 직접 다룰 수 없다.

`0035`는 아직 추첨권·주문·대기자가 없고 재고와 한 개의 유한 경품 풀이 정확히 일치하는 기존 단일 등급 ACTIVE 쿠지만 `LEGACY_SINGLE_TIER_V1` 봉인 덱으로 전환한다. 이 조건에서 벗어난 ACTIVE 쿠지가 하나라도 있거나 변환 중 쓰기 잠금을 즉시 얻지 못하면 전체 migration을 rollback하므로, API 쓰기 트래픽을 먼저 중단하고 상태를 다시 확인한 뒤 재시도한다. 봉인 덱 전환 뒤에는 번호 binding을 지원하는 API와 모바일 클라이언트를 함께 사용해야 하며, 구 API 코드로 rollback하거나 구 모바일 버전의 쿠지 소비를 계속 허용하지 않는다.

`0036`은 새 추첨 결과를 기록할 때 추첨권, 결제 완료 주문과 주문 항목, 확률표 버전, 선택 경품, 발급 재고의 사용자·상품·출처·상태가 모두 일치하는지 데이터베이스에서 재검증한다. 쿠지는 예약된 봉인 번호와 결과 snapshot까지 정확히 일치해야 한다. 적용 전에 정상 가챠·쿠지 소비 통합 테스트와 불일치 원장 차단 테스트를 통과시키고, 적용 뒤에는 제한 runtime 역할로 같은 소비 경로를 다시 확인한다.

`0037`은 이미 적용된 `0036`의 체크섬을 보존하면서, 새 결과가 `ACTIVE` 또는 `RETIRED` 상태의 실제 공개 확률표만 참조하도록 추가 차단한다. 미공개 `DRAFT` 확률표를 참조한 결과는 `23514`로 거부한다.

로컬 PostgreSQL 이미지는 pgmq를 포함하고 이전 PostgreSQL 16 volume과 다른 이름을 사용하므로 기존 로컬 데이터를 삭제하지 않는다. worker는 Redis/BullMQ 없이 한 batch를 처리하고 종료한다. Compose의 Redis는 `REDIS_URL`을 명시한 로컬 API의 선택적 공유 rate-limit 호환용일 뿐이며 Cloud Run API/worker에는 배포하지 않는다. `0027_supabase_worker_queue.sql`은 logged queue만 만들고 `pgmq_public`, `anon`, `authenticated`, `service_role`에 queue 접근을 주지 않는다.

탈퇴 승인과 고객 변경 요청은 사용자별 advisory lock으로 직렬화된다. 운영자가 승인에 성공한 뒤에는 해당 사용자의 활성 세션이 폐기되고 새 idempotent 변경이 DB trigger에서 거부된다. 승인 계정을 다시 활성화하거나 DB에서 탈퇴 상태를 직접 되돌리지 말고, 보존·재가입 정책에 따른 별도 운영 절차를 사용한다.

개발 화면에 카탈로그 fixture가 필요할 때만 다음을 실행한다.

```sh
corepack pnpm run db:seed
```

seed는 로컬 개발 자료이며 라이선스가 확인된 운영 카탈로그가 아니다. 첫 삽입 뒤 다시 실행해도 기존 `product_stock` 수량은 바꾸지 않는다. 이후 재고 변경은 관리자 재고 조정 원장만 사용한다.
운영 환경에서는 기본적으로 즉시 실패한다. 정말 필요한 초기 삽입 작업만 승인 후 `DABBOBA_ALLOW_PRODUCTION_SEED=true`를 일시적으로 주며, 이 경우에도 기존 카탈로그·가격·재고는 절대 덮어쓰지 않고 없는 행만 추가한다. 작업 직후 플래그를 제거하고 결과를 운영 감사 기록에 별도로 남긴다.

### 첫 관리자 만들기

최초 한 번만 bootstrap CLI를 사용한다. 비밀번호는 12자 이상이어야 하며 명령 기록에 남지 않도록 대화형 비밀 주입 도구를 우선한다.

```sh
corepack pnpm --filter @dabboba/api bootstrap:admin
```

명령 실행 시 `DABBOBA_BOOTSTRAP_ADMIN_EMAIL`, `DABBOBA_BOOTSTRAP_ADMIN_NICKNAME`, `DABBOBA_BOOTSTRAP_ADMIN_PASSWORD`, `DABBOBA_BOOTSTRAP_ADMIN_ROLE`을 환경에서 제공한다. 운영에서는 그 명령에 한해 `ALLOW_ADMIN_BOOTSTRAP=true`를 주고 즉시 제거한다. 같은 이메일이 있으면 CLI가 중단되며 이후 관리자는 인증된 `SUPER_ADMIN` 화면에서 만든다.

### 가챠·쿠지 확률표 준비와 공개

실제 제조사·공급사 자료와 검수한 물리 재고가 없으면 확률을 임의로 만들거나 공개하지 않는다. 준비된 상품은 다음 순서로 등록한다.

1. 관리자 상품 관리에서 각 당첨품을 추첨 상품과 같은 IP의 `경품 전용 SKU`로 등록하고 활성화한다. 경품 전용 여부는 생성 후 바꿀 수 없으므로 잘못 만들면 새 SKU를 등록한다.
2. 추첨 상품의 `확률표` 화면에서 경품 SKU, 등급, 기본 가중치, 유한 수량을 입력한다. 화면의 유효 가중치와 현재 예상 확률은 `기본 가중치 × 남은 수량` 기준이다.
3. 입력 수량 합계가 현재 판매 가용 수량보다 작으면 공개하지 않는다. 새 버전 수량은 이전 버전·다른 초안과 겹치지 않는 별도 검수 재고인지 입고 원장과 대조한다.
4. 구체적인 초안 생성 사유를 남기고 DRAFT를 만든다. 공개 전 경품명·이미지·수량·확률과 실제 자료를 두 사람이 교차 검수한다.
5. 공개 사유를 남겨 최신 DRAFT만 ACTIVE로 전환한다. 이전 ACTIVE는 RETIRED가 되며 공개된 구성과 경품 스냅샷은 수정하지 않는다.
6. 고객 상품 상세에서 버전, 기준 시각, 분자·분모·백분율, 남은 수량과 중복 당첨 안내가 보이는지 확인한다. 결제·추첨 E2E는 실제 고객 계정과 PG sandbox가 준비된 뒤 별도로 검증한다.

경품 전용 SKU는 공개 상품 목록·찜·직접 주문에는 나타나지 않지만 당첨 뒤 보관함·배송·교환에는 실제 품목으로 나타난다. `PAYMENT_PROVIDER=UNCONFIGURED` 환경에서는 확률표를 공개해도 유료 주문이 503으로 닫히는 것이 정상이다.

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
corepack pnpm --filter @dabboba/mobile start
```

기본 주소:

- 고객 앱: Expo 개발 서버가 표시하는 iOS Simulator·Android Emulator·실기기 연결 주소
- 이전 고객 웹: `http://127.0.0.1:4174` (`dev:lan` 기준). 마이그레이션 참고·웹 확장 채널이며 앱 완성 증거가 아님
- API liveness/readiness: `http://127.0.0.1:8788/healthz`, `http://127.0.0.1:8788/readyz`
- 관리자 웹: `http://localhost:4180`
- worker: `dev:worker` 한 번의 종료 코드·구조화 로그와 DB의 outbox/queue/dead-letter 상태로 확인

관리자 쿠키는 `Secure`로 설정된다. 로컬 관리자는 브라우저의 localhost secure-cookie 예외가 적용되는 `http://localhost:4180`을 우선하고, 쿠키가 저장되지 않으면 HTTPS local proxy로 확인한다.

서비스를 멈출 때 `corepack pnpm run local:services:stop`은 컨테이너만 중지하고 named volume은 보존한다. volume 삭제는 데이터 삭제 작업이므로 이 런북의 일반 종료 절차에 포함하지 않는다.

## 2. 변경 검증

로컬 의존성을 설치한 뒤 다음 순서로 확인한다.

```sh
corepack pnpm run workspace:assert
corepack pnpm --filter @dabboba/contracts generate
corepack pnpm run build:all
corepack pnpm exec turbo run typecheck
corepack pnpm exec turbo run test --force
corepack pnpm run test:sites
corepack pnpm run test:runtime
bash ops/cloud-run/check-artifacts.sh --build
git diff --check
```

DB 변경은 disposable PostgreSQL에서 migration을 두 번 실행해 첫 실행은 적용되고 두 번째 실행은 no-op인지 확인한다. 다음 URL과 비밀번호는 운영이나 보존해야 할 로컬 DB가 아니라 해당 검증만을 위한 DB와 두 제한 역할을 가리켜야 한다. 모든 값이 준비되지 않으면 통합 테스트가 조용히 skip될 수 있으므로 먼저 각각을 검사한다.

```sh
test -n "$DABBOBA_DISPOSABLE_TEST_DATABASE_URL"
test -n "$DABBOBA_DISPOSABLE_RUNTIME_DATABASE_URL"
test -n "$DABBOBA_DISPOSABLE_WORKER_DATABASE_URL"
test -n "$DABBOBA_DISPOSABLE_RUNTIME_DATABASE_PASSWORD"
test -n "$DABBOBA_DISPOSABLE_WORKER_DATABASE_PASSWORD"

DATABASE_MIGRATION_URL="$DABBOBA_DISPOSABLE_TEST_DATABASE_URL" corepack pnpm run db:migrate
DATABASE_MIGRATION_URL="$DABBOBA_DISPOSABLE_TEST_DATABASE_URL" corepack pnpm run db:migrate

printf '%s\n' "$DABBOBA_DISPOSABLE_RUNTIME_DATABASE_PASSWORD" | \
  DATABASE_MIGRATION_URL="$DABBOBA_DISPOSABLE_TEST_DATABASE_URL" \
  corepack pnpm --filter @dabboba/db provision:runtime-role -- --password-stdin
printf '%s\n' "$DABBOBA_DISPOSABLE_WORKER_DATABASE_PASSWORD" | \
  DATABASE_MIGRATION_URL="$DABBOBA_DISPOSABLE_TEST_DATABASE_URL" \
  corepack pnpm --filter @dabboba/db provision:worker-role -- --password-stdin

DATABASE_URL='' \
DATABASE_MIGRATION_URL="$DABBOBA_DISPOSABLE_TEST_DATABASE_URL" \
DABBOBA_RUNTIME_TEST_DATABASE_URL="$DABBOBA_DISPOSABLE_RUNTIME_DATABASE_URL" \
DABBOBA_WORKER_TEST_DATABASE_URL="$DABBOBA_DISPOSABLE_WORKER_DATABASE_URL" \
  corepack pnpm --filter @dabboba/db test

DATABASE_URL='' \
DATABASE_MIGRATION_URL="$DABBOBA_DISPOSABLE_TEST_DATABASE_URL" \
DABBOBA_TEST_DATABASE_URL="$DABBOBA_DISPOSABLE_TEST_DATABASE_URL" \
DABBOBA_RUNTIME_TEST_DATABASE_URL='' \
  corepack pnpm --filter @dabboba/api test
DATABASE_URL='' \
DATABASE_MIGRATION_URL="$DABBOBA_DISPOSABLE_TEST_DATABASE_URL" \
DABBOBA_RUNTIME_TEST_DATABASE_URL="$DABBOBA_DISPOSABLE_RUNTIME_DATABASE_URL" \
  node --test apps/api/dist/runtime-role-routes.integration.test.js

DATABASE_URL='' \
DATABASE_MIGRATION_URL="$DABBOBA_DISPOSABLE_TEST_DATABASE_URL" \
DABBOBA_WORKER_TEST_DATABASE_URL="$DABBOBA_DISPOSABLE_WORKER_DATABASE_URL" \
WORKER_DATABASE_URL="$DABBOBA_DISPOSABLE_WORKER_DATABASE_URL" \
  corepack pnpm --filter @dabboba/worker test
```

이 통합 스위트는 일반 사용자/관리자 세션 분리, 관리자 RBAC, 공지 lifecycle, 문의 내부 메모 비노출, 신고 제재, 감사 로그 불변성, 교환 동시 수락·양측 완료·운영 해결과 소유권 이전을 실제 PostgreSQL에서 확인한다. 또한 배송 목록/상세의 사용자 소유권·송장 상태, `AVAILABLE` 추첨권 pagination, 알림 수신 설정의 기본값·낙관적 버전·same-key replay/다른 payload 충돌·append-only 동의 event/outbox, 미디어 intent/complete idempotency와 만료 410·미연결 삭제/연결 충돌을 확인한다. GCS, 실제 PG, APNs/FCM과 실기기는 별도 sandbox/기기 검증 대상이다.

현재 전체 API 통합 suite는 fixture 준비를 위해 schema owner로 실행되고, 제한된 `dabboba_runtime` 경로는 카탈로그와 알림 설정 대표 route 통합 테스트로 검증한다. DB ACL suite와 대표 route 검증은 통과하지만, production release 전에는 제한 역할로 실행하는 route 범위를 더 넓혀 route와 테이블 권한의 회귀 증거를 보강한다.

## 3. 배포 순서

저장소에는 Cloud Run용 컨테이너·사전점검·배포 스크립트가 있지만 실제 GCP 프로젝트에는 아직 적용하지 않았다. `docs/cloud-run-deployment.md`의 비용 승인 가드와 다음 순서를 함께 유지한다.

1. CI의 workspace와 disposable DB migration job이 모두 통과했는지 확인한다. `corepack pnpm audit --prod --audit-level high`도 통과시키고, EAS가 루트 `pnpm-lock.yaml`을 사용하는지 확인한다.
2. 운영 PostgreSQL의 자동 백업/PITR 상태와 최신 복원 훈련 결과를 확인한다.
3. 운영 secret manager에 새 release가 필요로 하는 환경값이 있는지 확인한다. 모든 release 명령에는 API·worker·migration·scheduler 네 서비스 계정과 API·worker·migration DB secret ID 세 개, session pepper secret ID를 전부 선언한다. 사전점검이 계정의 존재·상호 분리와 네 secret ID의 상호 분리를 확인하며, secret version은 실제로 점검·배포하는 component 것만 필수다. 프로젝트 레벨 `roles/secretmanager.secretAccessor`는 누구에게도 부여하지 않고 각 secret의 정확한 단일 계정 정책만 사용한다. 다른 predefined/custom role이나 상위 폴더·조직에서 상속된 `secretmanager.versions.access`는 자동 분석 대상이 아니므로 유효 권한을 별도로 감사한다.
   관리자 배포에서는 BFF/API의 `ADMIN_PROXY_IDENTITY_SECRET` 일치, edge의 `ADMIN_EDGE_CLIENT_IP_HEADER` overwrite, 서버 시계 동기화도 함께 확인한다.
   일반 API는 신뢰 proxy 범위/hop 또는 edge/WAF 실제 client IP별 rate-limit 구성을 확인하고, 애플리케이션에서 미검증 `trustProxy`를 켜지 않는다.
4. schema owner의 `DATABASE_MIGRATION_URL`을 받은 단일 migration job에서 `corepack pnpm run db:migrate`를 실행한다. 새 DB/credential rotation이면 두 제한 login을 운영자 호스트에서 프로비저닝한다. API에는 `dabboba_runtime`의 `DATABASE_URL`, worker에는 `dabboba_worker`의 `WORKER_DATABASE_URL`만 주고, replica 각각에서 migration을 자동 실행하지 않는다. 대상 DB에서 0037 체크섬과 두 역할 suite를 검증한 뒤에만 문서의 정확한 `DABBOBA_DATABASE_RELEASE_ATTESTATION`을 설정한다. 이 값이 없으면 API/worker 배포 스크립트가 중단된다.
5. 이전 앱 버전과 새 schema가 함께 동작하는 expand/contract 방식인지 확인한다. 고유한 `candidate-*` 태그로 API를 `--no-traffic` 배포한 뒤, 첫 HTTP 요청 전에 태그가 가리키는 정확한 revision을 고정해 검증하고 태그 URL에서 `/healthz`, `/readyz`, 공개 Home catalog 및 `/v1/auth/providers` API의 200과 실제 관리자 route `/v1/admin/products`의 404를 확인한다. smoke 뒤에도 같은 revision과 운영 트래픽 0%를 다시 확인하고, 그 image·tag·정확한 Cloud Run revision에 묶인 attestation을 설정한 다음에만 별도 승인으로 `--to-revisions=<attested-revision>=100` 승격한다. 첫 서비스는 생성 전에 프로젝트와 반환된 모든 상위 폴더·조직 IAM을 읽는다. `roles/run.invoker` 외의 predefined/custom role에도 호출 권한이 포함될 수 있으므로 `allUsers`/`allAuthenticatedUsers`에 어떤 역할이든 연결돼 있으면 중단하고, 상위 정책을 읽을 권한이 없어도 중단한다. Invoker IAM 검사를 유지한 private bootstrap 생성 후 서비스 IAM에도 같은 검사를 적용하고 인증된 smoke를 통과시킨 다음, 별도 승인에서 정확히 검증된 revision의 100% 지정과 공개 접근 전환을 수행한다. 이 검사는 점검 이후 관리자의 동시 IAM 변경까지 잠그지는 못하고 그룹·도메인 구성원을 확장 분석하지 않으므로 배포 중 IAM 변경을 금지하고 Audit Log를 확인한다.
6. 유한 worker Job을 한 번 수동 실행해 성공 종료, unpublished outbox depth, pgmq queue depth와 `worker_dead_letters`를 확인한다. 실행한 immutable image tag에 맞는 `DABBOBA_WORKER_EXECUTION_ATTESTATION`을 설정한 뒤에만 인증된 Scheduler 호출을 연결한다. 기본 일정은 쿠지의 3분 결제 lease가 만료된 뒤 다음 1분 안에 정리 작업을 시작하도록 서울 시간 `* * * * *`이며 Scheduler 자체 재시도는 0회다. Worker의 새 작업 시작 구간은 검증 가능한 `WORKER_MAX_RUN_SECONDS=45`로 제한하고 예약 만료 sweep을 queue보다 먼저 실행한다. 같은 Worker를 가리키는 기존 15분 일정이 남아 있으면 새 일정을 만들지 않고 중단하고, 생성 후에도 정확한 1분·OAuth·활성 상태를 다시 읽어 검증한다. Job 자체 IAM은 조건 없는 `roles/run.invoker` 한 개와 지정 Scheduler 계정 한 명만 허용하며, 추가 멤버·공개 주체·`roles/run.jobsExecutor`·custom role·조건부/기타 바인딩이 있으면 중단한다. Worker는 Session mode 연결의 non-blocking session advisory lock을 먼저 얻으며, 겹친 실행은 queue와 주기 작업 전에 정상 종료한다. 다만 Cloud Run Job은 실행마다 최소 1분 과금될 수 있어 30일 기준 최대 43,200회인 1분 기본 일정은 종전 15분 무료 우선안보다 비용이 크다. USD 1/USD 5 예산 알림과 billable instance time을 확인한다. 이 값이나 DB release attestation이 없으면 Scheduler 생성 스크립트가 중단된다.
7. 관리자 웹을 배포하고 정확한 HTTPS origin/CORS를 확인한다. 고객 Expo 앱은 서명된 iOS·Android 후보 빌드로 만들고, 이전 고객 웹은 필요한 마이그레이션 참고·웹 확장 범위만 배포한다.
8. 읽기 smoke test 후 공지 작성→공개 조회, 문의 작성→관리자 답변→사용자 조회, 신고→처리→감사 로그의 sandbox 흐름을 확인한다.
9. PG sandbox에서 주문 idempotency, webhook 서명 거부, 중복 event, 재고 확정, 환불 검토, 추첨권 단일 소비를 확인한다.
10. 실제 iPhone·Android 고객 계정에서 배송 목록→상세/송장, 취소된 신청의 재신청 복구와 배송 완료 상품 제외, 새로고침 후 `AVAILABLE` 추첨권 재개, 알림 선택 해제 후 인앱 기록 유지·외부 전달 차단을 확인한다. session refresh 중 일시적 장애는 만료 전 재시도되고 401은 session을 폐기하는지도 확인한다. Storage 전환 전에는 실제 GCS에서, 전환 후에는 실제 Supabase Storage에서 intent/complete replay, 만료 뒤 같은 client action key가 폐기되는지, 미연결 미디어 삭제와 연결 미디어 충돌, worker 재정리를 확인한다.
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
- Supabase Storage: 비공개 bucket, 소유자·경로 제한 정책, staging의 짧은 lifecycle, 처리 완료 object 보존, 접근·요청 로그. 서명된 업로드 권한은 재전송될 수 있으므로 API의 업로드 intent와 완료 처리를 멱등하게 유지
- 비용·abuse: Storage 요청·저장량 급증과 비정상 업로드를 관측하고, edge WAF/IP rate limit·계정 생성 속도 제한·비정상 계정 차단을 운영 정책으로 연결
- 전환 중 GCS: 현재 구현의 private signed direct-upload 보안·멱등성 기준을 유지한다. Supabase Storage adapter가 동등하게 검증되기 전까지 임의 교체하지 않음
- secret: 버전 관리와 감사 가능한 secret manager; 코드/DB dump/log에 평문 포함 금지

RPO, RTO, 보존 기간, 복구 승인자는 사용자가 정해야 한다. 설정 화면을 캡처한 것만으로 끝내지 말고 최소 분기마다 별도 복원 환경에서 훈련한다.

### 논리 백업 예시

2026-09-06 추가: 평문 dump 예시를 직접 실행하기 전에 [암호화 백업·로컬 복원 도구](database-backup-restore.md)를 우선 사용한다. 해당 도구는 저장소 밖의 암호화 archive, 전체 인증 태그 확인, 빈 로컬 훈련 DB 제한을 강제한다. v2 묶음은 일반 dump에서 제외되는 pgmq 메시지·아카이브를 같은 읽기 스냅샷으로 보존한다. 38개 migration, public·pgmq 84개 테이블, 제약 469개, 동시 쓰기 격리 및 복원 실패 전체 롤백을 disposable DB에서 검증했다. 실제 Supabase 전체 복구·역할 권한·Storage 파일 복구는 별도 검증 항목이다. 아래 명령은 PostgreSQL 원리 설명으로 유지하며 암호화되지 않은 저장 위치에 실행하지 않는다.

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

- API: `/healthz`는 외부 의존성을 조회하지 않는 process liveness, `/readyz`는 제한 시간 안의 PostgreSQL 준비 상태이며 실패 시 503
- worker: Cloud Run Job 실행/종료 로그, pgmq `read_ct`/queue depth, immutable `worker_dead_letters`, unpublished outbox age
- 구조화 로그: request/correlation, 작업 ID, aggregate ID; 인증 header/cookie/password/token redaction
- PostgreSQL: unpublished/failed outbox, 오래된 예약, 결제 조정 대상, 감사 로그
- Supabase Queues: queue depth, visibility timeout 재노출, `read_ct` 재시도, dead-letter 증가

### 출시 전 반드시 연결할 알림

- API readiness 실패, worker Job 실패/실행 누락과 오류율 상승
- DB 연결/저장 공간/replication lag/lock 대기/PITR 실패
- unpublished outbox age/depth, pgmq retry/dead-letter 폭증
- 만료되지 않은 오래된 재고 예약
- `PENDING`, `AUTHORIZED`, `REFUND_REVIEW` 결제 backlog
- 재고 음수 방지 위반, 추첨 pool 소진, draw entitlement/result 불일치
- 관리자 로그인 실패 급증과 고위험 감사 이벤트
- GCS 처리 실패·POST 요청/저장량 급증·staging/deleted cleanup backlog, CDN 오류, 알림 공급자 실패와 선택 해제된 외부 알림 전달 시도

중앙 metric exporter, 오류 추적, dashboard, paging destination은 배포 플랫폼에서 별도로 구성해야 한다. Job은 상시 HTTP metric endpoint를 열지 않는다.

## 6. 장애 대응

### 공통

1. incident ID, 시작 시각, 영향 범위, 담당자를 기록한다.
2. 결제/추첨/재고처럼 금전 또는 지급에 영향을 주면 쓰기 트래픽을 우선 제한하고 읽기 증거를 보존한다.
3. DB row를 직접 고치지 않고 공급자 event, ledger, outbox, audit 순서로 사실을 재구성한다.
4. 보정은 idempotent API/작업과 append-only 원장으로 남긴다.
5. 복구 후 재발 방지, 탐지 시간, 복구 시간, 고객 고지를 기록한다.

### PostgreSQL 장애

- API `/readyz`와 최근 worker Job 실행 결과를 확인하고 쓰기 요청을 받지 않게 한다.
- 관리형 DB failover/PITR 상태를 확인한다.
- 복구 후 schema version과 최근 provider event/order ledger를 대조한다.
- outbox publication을 재개하고 backlog가 0으로 수렴하는지 본다.

### Supabase Queues/worker Job 장애

- PostgreSQL 업무 트랜잭션은 계속 outbox를 남길 수 있지만 queue 의존 작업은 지연됨을 공지한다.
- pgmq extension/ACL, Scheduler 인증, 최근 Job 종료 코드를 확인한 뒤 유한 worker Job을 한 번 수동 실행한다.
- visibility timeout이 지난 메시지는 다시 읽히며 기존 handler가 멱등하게 처리한다. 시도 상한을 넘은 항목은 `worker_dead_letters`와 canonical outbox를 함께 조사한다.
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
