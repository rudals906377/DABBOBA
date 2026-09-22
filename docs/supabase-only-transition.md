# Supabase 중심 백엔드 전환

## 운영 활성화 · 2026-09-10

로그인과 결제를 제외한 고객 DB·API·비동기 worker·이미지 저장 경로를 기존 DABBOBA Supabase 프로젝트에 운영 구성으로 활성화했다. `dabboba-api`와 `dabboba-worker` Edge Function은 ACTIVE이며, 실제 hosted smoke에서 health·readiness·catalog가 HTTP 200, worker 무권한 요청이 401, 전용 비밀로 인증한 실행이 200 `completed`를 반환했다. 결제 공급자는 계속 `UNCONFIGURED`이고 결제 성공을 합성하지 않는다.

- API는 `dabboba_runtime`과 transaction pooler 6543, worker는 별도 `dabboba_worker`와 session pooler 5432를 사용한다. worker 역할은 로그인만 허용하고 superuser·DB/role 생성·replication·inherit는 허용하지 않는다.
- private `dabboba-media` bucket은 5MB와 JPEG·PNG·WebP·GIF만 허용한다. Edge sanitizer는 파일 형식·크기·해상도·단일 프레임을 제한하고 방향 보정·metadata 제거·최대 4096px WebP 재인코딩 후 checksum을 계산한다.
- `pg_cron`과 `pg_net`이 Vault의 worker 전용 비밀로 1분마다 함수를 호출한다. 확인 시 최근 3회가 모두 succeeded/HTTP 200이고, outbox 미처리 0건·dead letter 0건이었다.
- 운영 비밀은 Git 밖의 `../.dabboba-launch/supabase-edge.env`에 0600으로 유지한다. Supabase CLI access token과 Storage S3 key 값은 코드·문서·로그에 기록하지 않는다.
- 최종 자동 검사는 domain 4, media-storage 15, DB 89(+6 통합 미실행), API 193(+23 통합 미실행), worker 81(+6 통합 미실행), Deno Edge 4, 배포물/프로필 11개가 실패 없이 통과했다. 실제 hosted smoke와 Cron 이력은 로컬 단위 검사와 별도로 확인했다.
- 고객 인증 마이그레이션 `0040`·`0041`은 이번 제외 범위에 따라 운영 DB에 적용하지 않았다. 로그인 운영 확인은 별도 단계이며, 결제는 KG이니시스 계약 정보와 실제 provider event 검증 전까지 fail-closed를 유지한다.

## 승인된 방향 · 2026-09-09

### 실제 상품을 사용하는 앱 검증

사용자는 앱과 관리자 페이지의 일상 검증에 기존 DABBOBA Supabase DB(`yxkmvgfruphgghowzvmo`)를 사용하도록 승인했다. 이는 서버 호스팅 배포와는 별개다. 앱은 기존 로컬 API를 거치고 DB 접속 비밀은 서버에만 둔다. 고정 실행기는 `DABBOBA 열기.command`를 유지하며, 원격 연결 실패 때 빈 로컬 DB로 자동 전환하지 않는다.

연결 전 읽기 전용 점검에서 제한 역할 `dabboba_runtime`으로 인증서 검증을 포함한 TLS 접속을 확인했다. 사용자 등록 상품 15개 중 13개 활성, 2개 비활성이고, 등록 상품의 이미지 URL과 실재고는 아직 비어 있다. 기존 상품을 다시 복제하거나 재고를 임의 생성하지 않는다. 원격 마이그레이션은 `0039`까지이며 고객 인증용 `0040`·`0041`은 미적용 상태다. 상품 조회 연결을 인증·결제·사진 등록 또는 출시 완료의 증거로 사용하지 않는다.

일상 앱 검증과 달리 초기화·시드·합성 주문·동시성 테스트는 기존 별도 loopback TEST DB에서만 실행한다. 원격 DB 변경, 테스트 계정 생성, 실제 결제, worker/Cron 및 알림 발송은 연결 점검에 포함하지 않는다. 로컬 API의 영구 연결에는 Supabase의 [Session pooler 연결 안내](https://supabase.com/docs/guides/database/connecting-to-postgres)를 적용하고, 기존 저장소의 인증서 검증을 유지한다.

2026-09-09 전환 검증: 명시적인 `supabase-integration` 프로필을 선택하고 기존 실행기로 API 8788을 재시작했다. Metro 8084와 자산 서버 4174는 재사용했다. 실 API의 활성 상품 13개 ID·제목·가격이 원격 SELECT와 정확히 일치했으며 상품 상세, IP, 홈 구성, 공지 및 readiness 조회가 모두 HTTP 200이었다. 인증 없는 관리자 상품 조회는 401을 유지했다. 관리자 4180은 동일 API를 향하며 로그인 페이지 HTTP 200을 확인했지만, 원격 관리자 자격 증명이 0개이고 신뢰할 수 있는 로그인 요청 헤더도 아직 미구성이므로 관리자 로그인 완료는 아니다. 프로필/실행기/테스트 격리 검사 41개 통과. 테스트 워커와 원격 초기화 실행 차단을 확인했고 원격 DDL/DML은 실행하지 않았다.

개발자용 설정은 `scripts/configure-backend-profile.mjs --supabase`로 명시 선택한다. 사용자 실행 방법은 바뀌지 않는다. `.dabboba-launch/backend-profile`이 선택을 저장하고 별도 0600 비공개 파일에 새 세션/관리자 프록시 비밀을 한 번 생성한다. 기존 `.env` 비밀과 개발용 설정은 덮어쓰지 않는다. 선택 파일이 없는 다른 설치는 기존 격리 로컬 프로필을 유지하지만, Supabase를 선택한 현재 설치에서 원격 설정 오류는 로컬로 자동 대체하지 않고 중단한다.

iOS Simulator의 기존 실행 화면에는 이전 빈 목록이 남아 있어 앱 프로세스만 종료·재실행했다. 이후 홈의 산리오·실바니안 등 실제 상품명과 9,900원 등 가격 표시를 직접 확인했다. 이미지는 아직 `이미지 준비 중`이고 쿠지 목록은 비어 있다. 화면 증거: `output/supabase-integration-2026-09-09/reopened.png`. 이 증거는 Simulator이며 실물 기기 또는 스토어 빌드 검증은 아니다.

사용자는 코드 교체를 허용하고 DB·인증·파일·API·비동기 처리를 우선 Supabase 안에서 해결하기로 결정했다. Cloud Run·Railway·Render 등의 신규 서버는 만들지 않는다. 이 결정은 설계·로컬 구현 승인이지 운영 DB 변경, 유료 전환, 배포 또는 자동 실행 활성화 승인이 아니다.

기존 Cloud Run 자료는 이전 구현과 복구 참고용으로 보존한다. 현재 운영 준비 순서로 실행하지 않는다. 기존 승인 UI와 DB 원장, REST 계약, 최소 권한 역할, 트랜잭션, 멱등성은 유지한다.

## DBB019 · 고객 API 로컬 후보와 검증

2026-09-09 고객 API를 기존 Node 서버와 Supabase Edge 후보가 공유하도록 `app-core`와 HTTP 경계를 분리했다. 기존 Node 로그인·원장·이미지 처리를 보존하며 고객 함수에는 관리자 경로를 등록하지 않는다. `verify_jwt=false`는 기존 DABBOBA opaque session을 앱 서버가 검증하는 구조를 위한 것이며 보호 경로의 인증을 생략한다는 뜻이 아니다.

- 함수 경로 prefix 두 형식만 수락하고 원문 본문·상태·쿼리·쿠키·CORS를 전달한다. 위조 가능한 forwarding 및 hop-by-hop 헤더는 전달하지 않는다.
- 본문 최대 1MiB, 운영 고정 대기 10초다. EOF가 멈춘 입력은 reader를 취소하고 앱/DB 초기화 전 408, 초과 입력은 413, 취소된 입력은 499로 종료한다.
- API는 제한 `dabboba_runtime` 역할과 transaction pooler 6543을 요구한다. worker의 session pooler 5432는 유지한다. 공유 전역 환경에 기대지 않고 DB pool에 production 역할 검사를 명시한다.
- Edge 로그는 제한된 요청/응답 메타데이터만 남기며 비밀·원문·임의 오류 메시지를 출력하지 않는다. 빌드 전용 Pino 경계로 unsupported worker_threads가 bundle에 들어오지 않게 하고 Node의 기존 logger는 유지한다.
- Node의 Sharp 검사·EXIF 제거·재인코딩을 보존한다. Edge에서 동일 보장을 제공할 이미지 처리는 아직 없으므로 이미지 완료 요청은 변경 전에 503으로 차단한다. 이를 이미지 이전 완료로 표시하지 않는다.

최신 검증은 [출시 체크포인트](backend-release-readiness-2026-09-08.md)의 DBB019–021 표에 기록했다. DB 93 / API 199 / worker 86, 관리자 22 tests가 통과했고, 실제 로컬 Deno HTTP→Fastify→제한 DB 경로 및 원문 HMAC·인증 거부·CORS·본문 제한을 확인했다. production artifact는 1,212,969 bytes / 690 inputs이며 테스트 전용 진입점을 별도 artifact로 격리한다. 생성 파일은 Git 제외이고 `corepack pnpm --filter @dabboba/api build:supabase`로 다시 만든다.

이 결과는 hosted Supabase의 TLS·gateway prefix·CPU/메모리/부하·장애 복구·신뢰할 수 있는 클라이언트 IP를 입증하지 않는다. 여러 실행 인스턴스에 걸친 요청 제한, 이미지 sanitizer 이전, 관리자 서버 기능, PortOne 원장/앱 연결도 남아 있다. 기존 API를 종료하거나 운영 앱 주소를 변경하지 않는다. Edge 함수 배포·운영 비밀 등록·실제 결제·Cron 활성화는 수행하지 않았다.

## DBB018 · 첫 구현과 검증 (이전 단계)

2026-09-09 첫 단계의 **로컬 코드 구현**을 마쳤다. `apps/worker/src/runner-core.ts`에 기존 한정 실행 로직을 보존하고, Node 호환 wrapper와 Supabase Edge 진입점을 분리했다. Edge는 전용 비밀 인증 뒤에만 설정을 읽고 작업 전체를 기다린다. 잘못된 역할·환경·저장소 설정을 거부하며, 외부 오류 원문이나 비밀은 응답하지 않는다. GCS 또는 다른 bucket으로 기록된 파일은 Supabase에서 삭제하지 않는다.

| 검증 | 이번 실제 결과와 경계 |
| --- | --- |
| worker 테스트 | 86 통과, 0 실패, 0 미실행. 실제 로컬 PostgreSQL에서 제한 역할의 큐/재시도/dead-letter, 결제 조회 관측, 예약 만료 등 포함 |
| worker 타입 검사·Node 빌드 | 통과. 기존 Node 실행 경로 유지 |
| Edge 묶음 생성·회귀 | 통과. 291,947 bytes / 입력 331개. Google/Sharp 제외, 외부 package import 없이 Node built-in만 허용, esbuild 0.28.2 고정 |
| Deno 2.9.6 | 함수 entry 타입 검사, 생성 묶음 smoke 1개 통과. 실제 loopback HTTP에서 entry 등록 및 GET 405·비밀 미설정 POST 503 확인 |
| Deno의 PostgreSQL 드라이버 | 실제 로컬 DB에서 `dabboba_worker` 역할·pgmq 1.5.1 조회 성공. hosted function의 인증된 HTTP→DB 전체 실행 증거와는 별개 |
| 앱 호환 검사 | 보호 runtime 28개, 웹 build, 모바일 TypeScript, workspace 구조 검사 통과 |
| 루트 공통 테스트 | 564개 중 562 통과, 2 실패. `tests/expo-shell-structure.test.mjs:301,537`의 모바일 홈 구성/안내 문구 구조 기대값 문제. 이번 worker 변경 범위 밖이며 수정하지 않음. 전체 green이라고 표시하지 않음 |

최초 검증에서 발견한 HTTP 타입/테스트 fixture 문제와 Deno CommonJS built-in 로딩 오류는 수정 후 다시 검사했다. 생성물은 `supabase/functions/dabboba-worker/worker.generated.js`이며 Git에는 넣지 않고 `corepack pnpm --filter @dabboba/worker build:edge`로 재생성한다. 배포 전에도 이 빌드가 필요하다. 정식 배포·Cron 생성/활성화·운영 DB/비밀 변경·PG 실제 호출은 실행하지 않았다.

동일 소스의 재빌드 SHA-256 일치, 문서 내부 링크 23개와 diff 공백 검사를 확인했다. 기존 환경 파일·고정 실행기·이전 Cloud Run 파일 26개의 hash는 유지했다. 테스트용 PostgreSQL 컨테이너는 다시 종료했으며 DB/볼륨은 삭제하지 않았다. 앱 검증은 해당 시점의 체크아웃 기준이며 별도 작업의 후속 모바일 변경까지 포괄하지 않는다.

**남은 개발:** 전체 API의 Edge 호환 HTTP 경계, 이미지 처리 교체, 관리자 서버 측 기능의 이전, 실제 Supabase 부하/복구 검증과 승인 후 배포. 이 첫 단계는 기존 API 서버까지 Supabase로 옮겼다는 뜻이 아니다. 온라인 검증 전에는 출시 완료로 판단하지 않는다.

## 순서와 완료 조건

| 단계 | 현재 출발점 → 목표 | 완료에 필요한 증거 |
| --- | --- | --- |
| 1. 자동 작업 | Node 일회성 worker → 인증된 Edge Function + Supabase Cron/Queues | 요청 인증, 실제 Deno 실행, DB 역할/잠금/재시도 회귀, 실제 Supabase 실행 제한 내 부하 확인 |
| 2. 업무 API | Fastify 서버 → Supabase에서 실행 가능한 HTTP 경계 | 기존 REST 상태 코드·오류·쿠키·본문·인증/RBAC/소유권 계약, PG 원문 서명 검증, 트랜잭션·동시성·rate limit 회귀 |
| 3. 이미지 | 기존 서버 이미지 처리 → Supabase Storage와 Edge 호환 처리 | 파일 위장/크기 제한, EXIF 제거, 변환 후 재인코딩, 비공개 접근, 기존 object provider/version 보존 |
| 4. 운영 연결 | 로컬 검증 → 별도 온라인 검증 뒤 승인된 운영 적용 | TLS/역할 분리, 스케줄 중복 방지, 실패 복구·경보, 실행량/CPU/비용 관측, 중단·복원 절차 |

첫 단계가 완료돼도 전체 API와 관리자 웹을 Supabase로 이전했다고 표시하지 않는다. 관리자 Next.js 서버 측 기능과 고객용 공개 홈페이지의 제공 방식은 별도 전환 항목이다. Supabase Storage를 일반 웹 호스팅처럼 간주하지 않는다. 필요한 경우 관리자 UI를 보존하면서 서버 측 인증/DAL을 Edge API로 옮기는 방식을 검증한다.

## 유지해야 하는 경계

- 앱은 결제 상태·재고·포인트·추첨 결과를 확정하지 않는다. 서버와 PostgreSQL만 확정한다.
- 기존 transactional outbox와 durable queue를 유지한다. 실패한 외부 요청을 성공으로 처리하거나 무조건 재전송하지 않는다.
- worker는 기존 `dabboba_worker` 제한 역할을 사용한다. Edge Function이라는 이유로 schema owner 또는 service-role DB 접근으로 승격하지 않는다. 큐를 `anon`/`authenticated`에 공개하지 않는다.
- 세션 advisory lock을 사용하는 동안에는 Session pooler 연결을 유지한다. Transaction pooler로 바꾸려면 잠금 전략 자체의 동등성 검증이 먼저다.
- Cron 호출은 전용 서버 비밀로 인증하며 사용자 로그인 토큰과 구분한다. 비밀은 앱·Git·문서에 넣지 않는다. 요청 인증 전에 DB 연결이나 작업을 시작하지 않는다.
- 이전·새 스케줄을 동시에 켜지 않는다. 작업 내부 중복 방지를 유지하더라도 운영 전환은 단일 실행 경로로 한다.
- GCS로 기록된 기존 파일을 Supabase 파일로 재해석하지 않는다. 이전 대상 조사·검증 없는 일괄 metadata 변경/삭제는 금지한다.
- 관리자에서 변경 가능한 운영 설정은 서버 권한·입력 검증·변경 사유·버전 충돌 방지·감사 이력으로 보호한다. 결제·추첨·잔액·인증 안전장치를 우회하는 임의 설정은 허용하지 않는다. 별도 관리자 UI 작업은 `apps/admin`을 소유하며 이 첫 worker 전환 단계는 관리자 UI와 홈 설정 API/공유 계약을 수정하지 않는다. 세부 운영 항목과 UI 단계는 [관리자 중심 운영 계획](admin-managed-app-roadmap.md)을 참조한다.

## 실행 제한과 설계 판단

2026-09-09 공식 문서 기준 Edge Functions는 메모리 256MB, 요청당 CPU 2초(비동기 I/O 대기 제외), worker wall time Free 150초/유료 400초, 응답 대기 150초 제한이 있다. 기존 worker의 45초 협력적 batch 제한만으로 CPU 제한 준수를 입증할 수 없다. 작은 batch부터 실제 Supabase에서 측정해야 한다. `sharp`/libvips 같은 다중 스레드 Node 라이브러리는 지원되지 않아 기존 이미지 처리의 단순 복사는 불가하다. [실행 제한](https://supabase.com/docs/guides/functions/limits)

함수별 의존성을 고정하고 실제 Deno 실행과 배포 bundle을 확인한다. Node에서 통과한 단위 테스트만으로 Supabase 호환성을 선언하지 않는다. Cron은 DB에서 Edge Function을 호출할 수 있으며 호출 비밀은 Vault 등에 보관한다. 이 문서는 스케줄을 생성하지 않는다. [의존성](https://supabase.com/docs/guides/functions/dependencies), [예약 실행](https://supabase.com/docs/guides/functions/schedule-functions)

## 운영자 준비와 별도 승인

### Edge worker 설정 이름

Supabase는 `SUPABASE_`로 시작하는 사용자 정의 비밀 이름을 예약한다. 기존 Node 설정을 그대로 등록하지 않는다. Edge 진입점은 인증 후 아래 설정을 기존 worker 설정으로 변환하며, 기존 설정을 함께 전달하거나 GCS 설정이 남아 있으면 실행을 거부한다. 기본 제공 `SUPABASE_URL`은 사용할 수 있다.

| Edge에 사용할 이름 | 용도 |
| --- | --- |
| `DABBOBA_WORKER_INVOKE_SECRET` | Cron/내부 호출 전용 비밀. 사용자 로그인·앱 publishable key와 별개 |
| `DABBOBA_WORKER_DATABASE_URL` | `dabboba_worker` 역할의 전용 Supabase 연결. Session pooler 5432 |
| `DABBOBA_STORAGE_BUCKET` | 기존 metadata와 일치하는 비공개 bucket |
| `DABBOBA_STORAGE_SERVICE_KEY` | 선택 사항. 별도 Storage 자격 증명을 쓸 때만 등록하며, 없으면 Edge에 기본 제공되는 `SUPABASE_SERVICE_ROLE_KEY`를 내부 변환해 사용 |
| `DABBOBA_STORAGE_S3_ENDPOINT`, `DABBOBA_STORAGE_S3_REGION` | 기존 Storage adapter가 요구하는 Supabase S3 호환 설정 |
| `DABBOBA_STORAGE_S3_ACCESS_KEY_ID`, `DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY` | 기존 adapter의 서버 전용 S3 호환 자격 증명 |
| `DABBOBA_WORKER_EXPO_PUSH_ACCESS_TOKEN` | 선택 사항. Expo 원격 푸시용 서버 전용 access token. 없으면 인앱 알림만 유지하고 원격 전송은 비활성화 |

현재 설치의 운영용 값은 Git 밖의 `../.dabboba-launch/supabase-edge.env` 한 파일에 0600 권한으로 준비한다. `node scripts/prepare-supabase-edge-profile.mjs --prepare`는 기존 Supabase 세션 pepper를 보존하고 API는 transaction pooler 6543, worker는 별도 `dabboba_worker` 역할의 session pooler 5432로 분리한다. 공개 웹 주소가 확정되기 전 CORS 허용 origin은 프로젝트의 HTTPS Supabase origin 하나로 제한하고, 네이티브 앱의 origin 없는 요청은 기존대로 허용한다. 결제는 항상 `UNCONFIGURED`로 고정한다. Storage S3 접근키 두 값은 Dashboard에서 한 번 발급한 뒤 이 비공개 파일에 넣으며 채팅·명령 인수·Git에 노출하지 않는다.

배포는 고정 Supabase CLI 2.117.0과 `scripts/deploy-supabase-edge.mjs`를 사용한다. 이 명령은 API/worker artifact를 다시 만들고 비밀 등록 뒤 두 함수를 `verify_jwt=false`로 배포한다. 이는 인증을 생략하는 옵션이 아니라 기존 DABBOBA 세션 검증과 worker 전용 bearer 검증을 함수 내부에서 유지하기 위한 설정이다. worker 역할 provision과 1분 Cron 활성화는 각각 별도 스크립트로 분리해, 함수 배포 및 수동 smoke가 끝나기 전 스케줄이 먼저 실행되지 않게 한다.

Edge 이미지 입력은 private `dabboba-media` bucket과 애플리케이션 양쪽에서 5MB로 제한한다. JPEG·PNG·WebP·GIF만 받고, 형식·픽셀 수·프레임 수를 확인한 뒤 방향 보정·metadata 제거·최대 4096px WebP 재인코딩을 거쳐야 READY가 된다. 이는 hosted Edge에서 복잡한 5MB 초과 이미지가 실행 한도를 넘을 수 있다는 공식 안내에 맞춘 보수적 상한이다.

환경 등급은 `DABBOBA_ENVIRONMENT_TIER=STAGING` 또는 `PRODUCTION`을 명시한다. 운영은 별도 실행 허용 조건도 만족해야 한다. 어떤 이름도 비밀값 자체를 문서에 기록하라는 뜻이 아니며, 이 표는 운영 등록이나 실행 승인이 아니다. Edge 배포 경계에서 DB 관리자 역할과 transaction pooler를 명시적으로 거부하므로 공유 `process.env`에 의존하지 않는다.

- 개발 담당자: 전용 worker DB 연결과 호출 비밀을 안전하게 제공하고, Supabase 배포·Cron 활성화 시점 승인. 지금 채팅에 비밀을 붙일 필요는 없다.
- 사업 운영자: KG이니시스의 실제 상품/사업 구조 심사, PG 계약·테스트 상점, 상품·확률·환불·배송 정책 및 법적 고지 준비.
- 개발 작업: API/미디어 이전, 공급자 adapter, 관리자 MFA, 테스트·실기기 확인과 남은 코드 수정은 개발 단계에서 처리한다.

Supabase로 통합하는 것은 별도 범용 서버를 줄이는 결정이다. KG이니시스·카카오/네이버·문자/푸시 공급자·앱스토어까지 Supabase가 대신 제공한다는 의미는 아니다.
