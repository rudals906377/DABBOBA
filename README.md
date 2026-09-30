# DABBOBA

DABBOBA는 Expo + React Native 고객 앱, Fastify API, PostgreSQL, worker, Next.js 관리자 웹과 고객 웹 확장 채널을 한 pnpm workspace로 관리합니다. 제품의 기준은 `apps/mobile` 네이티브 앱이며, 기존 React/Vite 화면과 WebView 셸은 화면별 이전이 끝날 때까지 보존하는 참고·호환 구현입니다. 운영 결제·인증·클라우드 공급자가 연결되지 않은 상태를 출시 완료로 간주하지 않습니다.

2026-09-09 사용자 결정에 따라 백엔드 실행을 Supabase 내부로 통합하는 작업을 시작했습니다. 별도 Cloud Run·Railway·Render 서버는 추가하지 않습니다. [전환 순서와 검증 기준](docs/supabase-only-transition.md)을 우선하며, 기존 서버 코드가 존재하는 것과 Supabase 이전·배포 완료는 구분합니다.

앱 중심 전환의 유지/이전/신규 범위와 의존성 순서는 [앱 중심 전환 기준](docs/dabboba-mobile-first-migration.md)을 따릅니다.

DB·백엔드의 최신 적용 상태와 남은 출시 조건은 [2026-09-08 출시 체크포인트](docs/backend-release-readiness-2026-09-08.md)를 기준으로 확인합니다. 과거 검증 기록의 migration 개수나 상품 예시를 현재 상태로 해석하지 않습니다.

## 전체 로컬 실행

현재 Supabase는 출시용으로 보호하고, 개발 앱/API/worker는 별도 로컬 DB를 사용합니다. 사전 조건은 **Node.js 24(필수, `engines.node` `>=24 <26`)**, Corepack, Docker Desktop입니다. `engineStrict`(`pnpm-workspace.yaml`)와 `.npmrc`의 `engine-strict=true` 때문에 다른 Node 주 버전에서는 `pnpm install`이 실패합니다. `node --version`이 `v24.x`인지 먼저 확인하세요. **기존 `.env`를 source하거나 개발 실행에 넘기지 않습니다.** 해당 파일과 모바일의 기존 Supabase public 설정은 보존하며, 운영 데이터의 복사·초기화 없이 로컬 프로필을 따로 준비합니다.

```sh
cd dabboba-app
node --version   # v24.x 필요
corepack pnpm --version
corepack pnpm install --frozen-lockfile
corepack pnpm run local:backend:prepare
```

현재 bundled IP·상품 fixture는 의도적으로 비어 있습니다. `db:seed`는 호환 CLI로만 남아 있고 예전 25개 개발 카탈로그를 복구하지 않습니다. 실제 IP·상품·이미지·재고·확률표는 승인된 자료로 관리자/API에서 등록합니다. `0039`는 기존 개발 상품을 삭제하지 않고 비활성화하므로, 운영 상품 등록 전 빈 고객 카탈로그는 정상입니다.

준비 명령은 `ops/local/backend.compose.yaml`의 전용 `dabboba-development` PostgreSQL 클러스터·볼륨과 `dabboba_development` DB, API/worker 역할 및 `.env.development.local`을 준비합니다. 기존 DB·볼륨·LOGIN과 운영 연결 파일을 지우거나 덮어쓰지 않으며 원격 Supabase에는 접속하지 않습니다. 이전 `local:services` PostgreSQL과 같은 55433 포트를 동시에 사용하지 않습니다. 같은 Mac에서 앱을 여는 방법은 기존 `../DABBOBA 열기.command`를 유지합니다. 자세한 경계는 [운영 런북](docs/dabboba-operations-runbook.md)과 [로컬 앱 실행](docs/local-app-isolation.md)을 따릅니다.

모든 개발 프로세스를 한 터미널에서 보려면 로컬 준비 후 다음을 실행합니다. 전역 `pnpm` 명령 설치나 운영 `.env` export는 필요하지 않습니다.

```sh
cd dabboba-app
corepack pnpm run dev:all
```

로그를 프로세스별로 나눠 보려면 아래처럼 실행합니다. 개발 실행기는 로컬 프로필을 선택하며 운영 연결/외부 키를 상속하지 않습니다. worker는 상시 서버가 아니라 한 batch를 처리하고 정상 종료합니다.

```sh
# 터미널 1 — API :8788
cd dabboba-app
corepack pnpm run dev:api
```

```sh
# 터미널 2 — 로컬 PostgreSQL Queues worker 1회 실행
cd dabboba-app
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
- worker 결과: 해당 실행의 구조화 로그와 PostgreSQL `outbox_events`/`worker_dead_letters`로 확인

`/v1/auth/dev-session`은 비운영 환경에만 존재하는 개발 로그인입니다. 실제 고객 로그인은 Kakao·Naver·한국 휴대폰 SMS OTP → Supabase Auth → DABBOBA 세션 교환 경로이며, 개발 세션으로 공급자 가입·문자 수신·네이티브 복귀 검증을 대신하지 않습니다.

로컬 최초 관리자 계정은 한 번만 다음처럼 만듭니다. 실제 비밀번호를 명령줄 인수, 채팅 또는 저장소에 적지 마세요.

```sh
cd dabboba-app
set -a; source .env.development.local; set +a
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

이 Mac에서 앱 열기는 아래 기존 파일 하나를 사용합니다. 로컬 API·사진 서버·Metro를 준비하고 전용 시뮬레이터를 엽니다.

```sh
"/Users/kyoungmin/Desktop/DBB/DABBOBA 열기.command"
```

기본 개발 연결은 `127.0.0.1` 전용이며 기존 모바일 Supabase public 설정을 번들에 넣지 않습니다. 개발 계정은 로컬 API를 사용하고 실제 Kakao/Naver/SMS 확인은 별도 staging 준비 후 진행합니다. 물리 휴대폰의 LAN 연결은 별도 네트워크 경계 확인이 필요하며, 시뮬레이터 성공만으로 실기기 검증 완료라고 하지 않습니다.

현재 `App.tsx`/`webShell.ts` WebView 코드는 이전되지 않은 화면을 비교하기 위한 legacy 호환 자료로 남아 있으며 Expo entry가 아닙니다. Expo Go 확인은 standalone 서명 build, custom native module, TestFlight/Play internal testing 또는 실제 스토어 기기 검증을 의미하지 않습니다.

## 공개 정책 사이트와 웹 회원탈퇴

`dabboba.net/privacy`, `/terms`, `/support`, `/account-deletion`은 `public/legal`의 정적 문서를 Cloudflare Pages Worker가 고정 경로로 제공합니다. `/account-deletion`은 앱 재설치 없이 이메일 OTP 본인확인 → DABBOBA 세션 교환 → 탈퇴 가능 상태 확인 → 탈퇴 요청 → 접수번호 상태 조회를 수행합니다. 인증 응답과 API 주소는 브라우저가 공급자에 직접 요청하지 않고 같은 출처 Worker 경계를 통과합니다.

Cloudflare Pages 운영 환경에는 아래 **공개 값 세 개만** 개별 binding으로 넣습니다. 저장소의 전체 `.env`, DB URL, Supabase service-role/secret key, 세션 pepper는 사이트에 복사하지 않습니다.

```text
DABBOBA_PUBLIC_API_ORIGIN=https://<운영 고객 API origin>
SUPABASE_URL=https://<운영 project ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<운영 publishable key>
```

빌드 명령은 `corepack pnpm run build`, Cloudflare Pages의 운영 정적 출력 디렉터리는 `dist/public-site`입니다. 이 디렉터리에는 공개 사전오픈 랜딩과 정적 자산, 공개 정책·지원·탈퇴 문서, Pages advanced-mode 진입점인 `_worker.js`가 들어갑니다. `dist/client`는 내부 웹 프로토타입까지 포함하므로 운영 도메인에 배포하지 않습니다. Pages 프로젝트에는 위 세 환경변수와 `dist/public-site`만 연결해야 합니다. 저장소에는 Cloudflare 계정 ID, 프로젝트 ID, API 토큰 또는 운영 배포 자격증명을 두지 않으므로 실제 프로젝트 연결과 custom domain 설정은 Cloudflare에서 별도로 완료해야 합니다.

친구 소유 계정으로 이전할 때의 Git 연동, DNS·메일, 검증, 롤백 순서는 `docs/cloudflare-pages-handoff.md`를 따릅니다.

Worker는 `https://dabboba.net`이 아닌 Pages preview/custom host에서 인증 경로를 열지 않습니다. 세 값 중 하나라도 없거나 HTTPS origin이 아니거나 publishable key가 privileged key이면 `503`으로 닫힙니다. 또한 운영 API의 `/v1/auth/providers`가 `EMAIL`을 노출하고 `brokerExchangeConfigured=true`를 반환하며, 해당 정책 버전이 `/v1/public/config`와 일치할 때만 폼을 엽니다. 이메일 OTP 요청은 Supabase에 `create_user=false`로 전달하고, 미가입·가입 여부와 무관하게 같은 `202` 본문을 반환합니다. 접수 상태 토큰만 브라우저 localStorage에 보관하며 Supabase/DABBOBA 로그인 토큰은 저장하지 않습니다.

배포 전에는 `WEB_ORIGINS`에 정확한 `https://dabboba.net` origin을 추가하고, Cloudflare custom domain·HTTPS·`www` 리디렉션 및 `support@dabboba.net` 송수신을 별도로 확인해야 합니다. `/account-deletion/auth/email-otp`와 `/account-deletion/auth/verify`에는 Cloudflare의 IP별 rate-limit/WAF 규칙을 추가하고, Supabase Auth의 이메일 발송 제한과 운영 SMTP도 함께 검증합니다. 로컬/단위 테스트 성공은 실제 이메일 도착, 운영 Supabase 사용자 삭제 또는 공개 DNS 배포 증거를 대신하지 않습니다.

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

PostgreSQL 통합 테스트와 배포·복원 절차는 [운영 런북](docs/dabboba-operations-runbook.md), Cloud Run 설정·비용·롤백은 [Cloud Run 배포 가이드](docs/cloud-run-deployment.md), 계정·사업·법무·PG·스토어 등 사용자가 준비할 항목은 [사용자 작업 목록](docs/dabboba-user-actions.md)에 있습니다.
