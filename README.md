# DABBOBA

DABBOBA는 Expo + React Native 고객 앱, Fastify API, PostgreSQL, worker, Next.js 관리자 웹과 고객 웹 확장 채널을 한 pnpm workspace로 관리합니다. 제품의 기준은 `apps/mobile` 네이티브 앱이며, 기존 React/Vite 화면과 WebView 셸은 화면별 이전이 끝날 때까지 보존하는 참고·호환 구현입니다. 운영 결제·인증·클라우드 공급자가 연결되지 않은 상태를 출시 완료로 간주하지 않습니다.

앱 중심 전환의 유지/이전/신규 범위와 의존성 순서는 [앱 중심 전환 기준](docs/dabboba-mobile-first-migration.md)을 따릅니다.

## 전체 로컬 실행

사전 조건은 Node.js 24, Corepack, Docker Desktop입니다.

```sh
cd dabboba-app
corepack pnpm --version
corepack pnpm install --frozen-lockfile
test -f .env || cp .env.example .env
test -f apps/admin/.env.local || cp apps/admin/.env.example apps/admin/.env.local
corepack pnpm run local:services
set -a
source .env
set +a
corepack pnpm run db:migrate
corepack pnpm run db:seed
```

개발 seed는 현재 승인 화면의 로컬 기준선인 IP 25개, 대표 캐릭터 75개, 상품 25개를 넣습니다. 상업 이용 권리가 확인된 운영 카탈로그가 아니므로 production 판매 데이터로 사용하면 안 됩니다.

모든 개발 프로세스를 한 터미널에서 보려면 다음을 실행합니다. `dev:all`은 Corepack의 pnpm workspace runner를 사용하므로 전역 `pnpm` 명령 설치가 필요하지 않습니다. Docker 기동, migration, seed는 자동 수행하지 않으므로 위 준비를 먼저 끝내야 합니다.

```sh
cd dabboba-app
set -a; source .env; set +a
corepack pnpm run dev:all
```

로그를 프로세스별로 나눠 보려면 터미널 네 개에서 실행합니다. API와 worker 터미널은 시작 전에 같은 `.env`를 export해야 합니다.

```sh
# 터미널 1 — API :8788
cd dabboba-app
set -a; source .env; set +a
corepack pnpm run dev:api
```

```sh
# 터미널 2 — worker :8791
cd dabboba-app
set -a; source .env; set +a
corepack pnpm run dev:worker
```

```sh
# 터미널 3 — 관리자 웹 :4180
cd dabboba-app
corepack pnpm run dev:admin
```

```sh
# 터미널 4 — 고객 웹 :4174
cd dabboba-app
corepack pnpm run dev:lan
```

- 고객 웹: [http://127.0.0.1:4174](http://127.0.0.1:4174)
- API 상태: [http://127.0.0.1:8788/readyz](http://127.0.0.1:8788/readyz)
- 관리자 웹: [http://127.0.0.1:4180](http://127.0.0.1:4180)
- worker 상태: [http://127.0.0.1:8791/ready](http://127.0.0.1:8791/ready)

고객 remote 모드의 로그인 화면은 개발 환경에서만 `/v1/auth/dev-session`을 사용하며 올바른 형식의 테스트 이메일을 입력하면 됩니다. 운영용 전화·Google·Kakao 인증을 대신하지 않습니다.

로컬 최초 관리자 계정은 한 번만 다음처럼 만듭니다. 실제 비밀번호를 명령줄 인수, 채팅 또는 저장소에 적지 마세요.

```sh
cd dabboba-app
set -a; source .env; set +a
export DABBOBA_BOOTSTRAP_ADMIN_EMAIL='admin@example.test'
export DABBOBA_BOOTSTRAP_ADMIN_NICKNAME='로컬 최고관리자'
read -s 'DABBOBA_BOOTSTRAP_ADMIN_PASSWORD?관리자 비밀번호(12자 이상): '
export DABBOBA_BOOTSTRAP_ADMIN_PASSWORD
export DABBOBA_BOOTSTRAP_ADMIN_ROLE='SUPER_ADMIN'
corepack pnpm --filter @dabboba/api bootstrap:admin
unset DABBOBA_BOOTSTRAP_ADMIN_EMAIL DABBOBA_BOOTSTRAP_ADMIN_NICKNAME DABBOBA_BOOTSTRAP_ADMIN_PASSWORD DABBOBA_BOOTSTRAP_ADMIN_ROLE
```

관리자 웹에서 위 이메일과 비밀번호로 로그인합니다. 같은 이메일로 bootstrap을 다시 실행하면 안전하게 중단되며 이후 관리자는 인증된 `SUPER_ADMIN` 화면에서 만듭니다. 자세한 보안 경계는 [운영 런북](docs/dabboba-operations-runbook.md)을 따릅니다.

## UI prototype만 실행

Docker/API 없이 승인된 화면만 확인하려면 `VITE_DABBOBA_API_URL`이 없는 별도 개발 환경에서 다음을 실행합니다.

```sh
cd dabboba-app
corepack pnpm install --frozen-lockfile
corepack pnpm run dev:lan
```

prototype의 fixture, 모의 결제, 화면용 확률은 운영 데이터가 아닙니다.

## 현재 서버 연결 경계

- 미디어 intent 생성과 complete는 `Idempotency-Key`와 요청 해시를 영속 저장하며, 만료된 intent complete는 `410 MEDIA_UPLOAD_INTENT_EXPIRED`를 반환합니다. 고객 adapter는 이 action key를 폐기해 같은 만료 요청을 재전송하지 않고 작성 화면은 새 key로 다시 시작합니다. 인증 사용자는 아직 콘텐츠에 연결되지 않은 자기 미디어만 idempotent하게 삭제할 수 있고, worker가 실패·만료·삭제 객체 정리를 재시도합니다. 실제 GCS CORS/IAM과 삭제 동작은 별도 공급자 환경에서 검증해야 합니다.
- 고객 배송 신청 목록·상세/송장과 결제 후 남은 `AVAILABLE` 추첨권을 remote 고객 화면에 연결했습니다. 배송 신청 후 목록 재조회, 취소된 신청만 있는 상품의 재신청 복구, 배송 완료/진행 중 상품의 중복 신청 방지, 상품별 이어 뽑기와 결제 확률표 version 표시까지 로컬 회귀 검증을 통과했지만 실제 물류·PG·실기기 증거를 대신하지 않습니다.
- 알림 수신 설정은 PostgreSQL에 version과 변경 불가 동의 이력을 저장하고, remote 고객 화면은 조회·저장과 409 충돌 뒤 최신값 재동기화를 수행합니다. worker는 인앱 기록을 유지한 채 선택 알림의 외부 전달 거부를 반영합니다. APNs/FCM 같은 실제 외부 전달은 별도 준비가 필요합니다.
- 저장된 고객 세션은 401이면 폐기하지만 일시적인 refresh 실패는 만료 전에 다시 시도합니다. 이 복구 로직은 실제 production 인증 provider나 장시간 background/네트워크 전환 검증을 대신하지 않습니다.

## Expo 네이티브 앱

```sh
corepack pnpm install --frozen-lockfile
set -a; source .env; set +a
corepack pnpm run dev:api
corepack pnpm run mobile
```

컴퓨터와 휴대폰을 같은 Wi-Fi에 연결한 뒤 Expo QR을 스캔합니다. 앱은 Expo Router 기반 네이티브 탭을 열고, 첫 이전 화면인 홈은 Fastify 공개 카탈로그를 읽어 Expo SQLite의 삭제 가능한 cache에 저장합니다. 개발 환경에서 `EXPO_PUBLIC_DABBOBA_API_URL`이 없으면 Metro host의 `8788`을 사용합니다. API가 `127.0.0.1`에만 bind돼 있으면 실물 휴대폰에서는 접근할 수 없으므로 `API_HOST`와 방화벽·LAN 경계를 별도로 확인해야 합니다.

현재 `App.tsx`/`webShell.ts` WebView 코드는 이전되지 않은 화면을 비교하기 위한 legacy 호환 자료로 남아 있으며 Expo entry가 아닙니다. Expo Go 확인은 standalone 서명 build, custom native module, TestFlight/Play internal testing 또는 실제 스토어 기기 검증을 의미하지 않습니다.

## 통합 검증

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

PostgreSQL 통합 테스트와 배포·복원 절차는 [운영 런북](docs/dabboba-operations-runbook.md), 계정·사업·법무·PG·스토어 등 사용자가 준비할 항목은 [사용자 작업 목록](docs/dabboba-user-actions.md)에 있습니다.
