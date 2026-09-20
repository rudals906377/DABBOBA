# DABBOBA 백엔드·DB 출시 체크포인트

## 최신 출시 준비 지시 · 2026-09-09

사용자가 앱 출시를 확정하고 필요한 개발·준비를 진행하도록 요청했다. DB·백엔드·결제 범위의 로컬 구현을 이어가며, 실제 공개 출시 완료로 해석하지 않는다. 사용자 도움이 필요한 결정·계정 작업은 마지막에 모으지 않고 해당 단계에서 함께 처리한다. 검증은 각 구현 묶음의 마지막에 수행하고, 실패를 발견하면 수정·재검증한다.

현재 목표는 [Supabase 중심 전환](supabase-only-transition.md)과 [PortOne V2 → KG이니시스](kg-inicis-integration.md)다. 기존 Cloud Run 구현·과거 검증 기록은 보존하되 현재 배포 지시로 실행하지 않는다. 다른 작업에서 맡은 고객 홈 UI와 관리자 UI는 덮어쓰지 않는다.

| 순서 | 작업과 완료 조건 | 현재 작업 상태 |
| --- | --- | --- |
| DBB019 | 기존 REST·세션·권한·원문 결제 통보·원장을 보존하는 Supabase API 실행 경계. Node 호환성 및 실제 Deno 요청/응답 증거 필요 | 로컬 후보 구현·Node/Deno 회귀 통과; 공개 배포·운영 전환 아님 |
| DBB020 | PortOne 조회·통보 서명 검증·취소의 독립 서버 adapter. 호출 시간/크기 제한, 상점·채널·결제 식별자 대조, 불확실한 취소 결과의 구분 | 독립 adapter 구현·집중 검사 14개 통과; 공식 SDK 0.19.0 고정, 기존 실결제 차단 유지 |
| DBB021 | 최신 의존성 보안 경고의 호환 patch와 회귀 검증 | Next 16.3.3 / Sharp 0.35.4 / js-yaml 4.3.2 반영, 재검사 high·critical 0 / moderate 1 |
| 결제 후속 연결 | 주문 원장·앱 결제창·조회 재처리 연결. 중복 통보·시간초과·만료 후 승인·환불 실패 복구의 통합 검증 | 미착수; 독립 adapter만으로 결제 연동 완료라고 표시하지 않음 |
| 후속 연결 | 이미지 처리 이전, 분산 요청 제한/신뢰할 수 있는 접속 정보, 관리자 서버 기능/2단계 인증, 소셜·문자·파일·푸시의 실제 연결 | 미완료; API/결제 공용 파일 변경은 직렬 통합 |
| 온라인 검증 | 운영과 분리한 환경, 최소 권한 DB 연결·TLS·비밀 주입, 실제 Edge/예약 작업·부하·장애 복구 | 별도 준비·승인 필요; 운영에서 테스트하지 않음 |
| 출시 판단 | 테스트 결제/취소·iPhone/Android 실제 기기·백업 복원·사업/상품/정책·스토어 요건의 증거 | 미완료; 코드 통과만으로 출시 승인하지 않음 |

로그인은 최신 사용자 결정으로 카카오·네이버·구글·애플·이메일 인증번호 다섯 가지가 승인됐다. 휴대폰 로그인 선택지는 제외하되 기존 계정과 데이터는 보존한다. 국내 본인확인과 1인1계정 요구는 취소됐으며 CI/DI를 수집하지 않는다. 인증된 동일 이메일은 Supabase 기본 자동 연결을 허용한다. 다른 이메일의 SNS는 회원정보 화면에서 직접 연결·해제하고 마지막 로그인 수단은 보호하는 방향이다. 별도 DABBOBA 계정의 주문·잔액은 자동 병합하지 않는다. 구현·외부 설정·연결 검증의 최신 상태는 [고객 로그인 안내](customer-auth-setup.md)를 기준으로 한다. [Apple 심사 기준 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services)

운영 DB 변경, 서비스 공개·배포, 유료 전환, 계약·결제 카드 등록, 실제 결제·환불, 비밀 발급·회전은 해당 단계의 명시적 권한을 확인한다. 계정 비밀번호나 서버 비밀값을 채팅·Git·공개 앱 설정에 넣지 않는다. 아래 검증 수치는 각 과거 단계의 증거이며, 이번 최종 코드 조합의 새 검증 결과가 아니다.

이번 읽기 전용 확인에서 출시용 Supabase `DABBOBA`는 정상 상태였고, 배포된 Edge Function 및 프로젝트 branch는 각각 0개였다. 연결 도구에 나열된 프로젝트도 1개였으므로 이 연결 범위에서는 별도 온라인 검증 환경을 확인하지 못했다. 조직 전체 계정의 유료/무료 한도나 다른 계정의 프로젝트 수를 확정한 것은 아니다. API 후보는 로컬에서 준비하며, 실제 온라인 검증 단계에서 격리 환경과 필요한 권한을 사용자와 함께 정한다.

현재 Edge 후보의 이미지 완료 처리는 기존 Node의 이미지 재인코딩/검사 보장을 대체할 수 있을 때까지 명시적으로 거부해야 한다. 요청 제한도 한 실행 인스턴스 안의 제한과 여러 실행 인스턴스에 걸친 제한을 구분한다. 두 경계가 남은 상태에서 Node API를 종료하거나 고객 앱의 운영 주소를 새 함수로 교체하지 않는다.

### 최신 보안 검사에서 발견한 변경

2026-09-09 첫 의존성 검사에서 critical 2개, high 2개, moderate 1개를 발견했다. 앞선 날짜의 안전 판정을 재사용하지 않는다. 새 네 건은 Next 16.3.0, Sharp 0.35.3, js-yaml 4.3.1 경로이며 각각 공식 수정판 16.3.3, 0.35.4, 4.3.2로의 호환 patch를 완료했다. 재실행한 `pnpm audit --prod --audit-level high`는 종료 0, high·critical 0, moderate 1이다. 이는 실제 서비스 침해 여부를 조사하거나 모든 취약점이 없음을 입증한 결과는 아니다.

- Next의 Windows 서버 조건과 현재 macOS/Linux 환경을 구분한다. 이미지 최적화 기능의 AVIF 경로도 실제 악용을 입증하지 않았지만 같은 수정판으로 해소해야 한다. [Windows 조건](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [AVIF 조건](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4)
- Node 이미지 처리의 입력 형식·크기·픽셀 상한·재인코딩 보장은 유지하며 Sharp를 갱신한다. API 직접 의존성뿐 아니라 Next의 optional Sharp 경로도 함께 확인한다. [Sharp 공지](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c)
- js-yaml은 확인된 Expo CLI 등 도구 경로다. Expo/React 버전을 바꾸지 않고 영향받는 4.x 해석만 수정판으로 제한한다. 기존 `decode-uri-component` moderate는 별도 항목으로 남긴다. [js-yaml 공지](https://github.com/advisories/GHSA-2883-xcg3-v3hh)

### DBB019–021 최종 로컬 검증 · 2026-09-09

| 범위 | 실제 결과 |
| --- | --- |
| DB / API / worker | 93 / 199 / 86 pass, 각각 fail 0·skip 0. 최신 본문 deadline과 의존성 patch 이후 재실행 |
| PortOne 독립 adapter | 14 pass, fail 0·skip 0; API 199에 포함되므로 중복 합산하지 않음. 실제 PortOne 호출·결제·환불 아님 |
| 관리자 | patch 후 Next 16.3.3 production build·타입 검사·22 tests 통과. 가짜 HTTPS API와 합성 proxy 비밀을 사용한 로컬 build이며 운영 로그인 증거 아님 |
| Deno 2.9.6 | production entry 타입 검사·묶음 prefix 검사, 별도 integration artifact의 실제 Fastify→제한 DB 검사, 실제 loopback HTTP 검사 각각 통과 |
| HTTP 확인 내용 | health/ready/catalog 200, 비로그인 401, 관리자 404, CORS 204, HEAD 빈 본문, 원문 HMAC, 비정상 JSON 400, 초과 본문 413, 동시 catalog 8건 |
| 본문 대기 제한 | 운영 고정 10초. 유효 JSON 뒤 EOF가 멈춘 스트림을 취소하고 환경·앱·DB 초기화 전 408 반환하는 집중 회귀 통과. 이미 취소된 입력 499 유지 |
| Edge artifact | production 1,212,969 bytes / 690 inputs, test-only integration 1,215,059 bytes / 691 inputs. artifact 보호 검사 2 pass. GCS/Sharp/ioredis/vm/worker_threads 제외 |
| 앱 호환 | 마지막 web build, 모바일 TypeScript, 보호 runtime 28개 통과. 웹 bundle 500kB 초과 경고 잔존 |
| root unit 관측 | 569개 중 567 pass, 2 fail, 0 skip. 홈 안내 문구 및 카테고리 이동 함수의 정적 기대값 불일치이며 별도 UI 작업에 전달. 전체 테스트 성공으로 표시하지 않음 |
| 로컬 DB release gate | 새 격리 DB의 40/40 migration checksum, 77 application tables RLS, anon/authenticated table grant 노출 0, 역할 분리 pass |

실행 환경은 macOS Node 25.8.1 및 Deno 2.9.6이다. Node 24 배포 이미지나 hosted Supabase에서 실행했다고 표시하지 않는다. Fastify 6에서 제거 예정인 logging 옵션 경고와 Deno의 응답 완료 후 legacy abort 경고도 남아 있다. 루트 UI 검사 결과는 당시 체크아웃 관측이며 동시 진행 중인 관리자·상품 작업의 후속 변경까지 포괄하지 않는다.

검증 로그는 `/tmp/dabboba-release-20260909.6Ay2oL/`에 있다. 테스트 DB는 이 단계가 새로 만든 `dabboba-release-edge-20260909`, loopback `127.0.0.1:55441`, DB `dabboba_edge_test`이며 실제 비밀 대신 합성 자격 증명을 사용했다. 기존 개발 DB·과거 fixture·실행 중 앱 서비스는 재기동하거나 초기화하지 않았다. 이 백엔드 작업은 원격 DB/Storage 변경·배포·Cron 활성화·실제 PG 호출을 하지 않았다. 별도 사용자 승인 상품 작업의 원격 변경과 구분한다.

검증 후 이 단계 전용 컨테이너만 종료하며 DB 볼륨은 보존한다. 보호 환경 파일·AGENTS·루트 package·migration 0038/0039의 7개 SHA-256은 단계 시작과 같고, tracked diff 및 신규 구현 파일의 공백 검사를 통과했다. 검증 snapshot 이후 media 공유 코드 소유권을 별도 관리자·상품사진 작업에 인계했다. 그 작업의 후속 변경은 별도 회귀 검증이 필요하다.

### 아래는 과거 체크포인트

기준일: 2026-09-08. 대상: `/Users/kyoungmin/Desktop/DBB/dabboba-app`, branch `feat/dabboba-capsule-gacha`.

## 현재 판정

백엔드·DB의 안전성 보강 및 운영/개발 환경 분리 구현과 마지막 로컬 통합 검증을 완료했다. 현재 Supabase를 출시용으로 보호하는 용도 결정은 승인됐으며, 현재 판정은 운영 공급자를 연결하기 전의 **출시 후보 기반**이다. 연결된 Supabase의 앞선 schema 적용 증거는 아래에 있지만 worker 운영 연결, PG, 소셜/문자 인증, 미디어 bucket, push, 물류, 실기기, 법무·IP 승인까지 완료된 것은 아니므로 **공개 출시 가능** 판정은 아니다.

## 이번 체크포인트의 보강

### 이후 승인된 환경 분리 — 구현·최종 로컬 검증 완료

사용자는 현재 Supabase를 출시용(PRODUCTION)으로 보호하고, 반복 테스트는 별도 로컬 DB, 실제 외부 연동은 별도 staging에서 확인하는 방향을 승인했다. DBB-013(백엔드 프로필·환경 검사·준비 명령)과 DBB-014(기존 실행기 연결)를 구현하고 감독자가 마지막 실행 검증을 수행했다. 과거 `UNKNOWN` 표기는 당시 관측 기록이며 이번 용도 결정은 배포·요금제 전환·운영 worker 실행 승인이 아니다. 이 환경 분리 단계에서는 원격 Supabase에 접속하거나 SQL·역할·비밀값을 변경하지 않았다.

- 실제 process 환경으로 시작하는 API/admin/migration/worker는 `DABBOBA_ENVIRONMENT_TIER`를 요구한다. LOCAL/development, TEST/test, STAGING·PRODUCTION/production을 구분하고 LOCAL/TEST의 원격 DB·URL query override·외부 공급자 혼입을 차단한다. 기존의 명시적 programmatic test config는 호환을 위해 tier 추론을 유지하므로 이 예외를 운영 entrypoint에 사용하지 않는다.
- 테스트 preflight는 root와 DB/API/worker package 실행 전에 원격 DB와 다른 tier를 거부한다. 세 역할 TEST URL을 함께 제공하면 같은 로컬 host·port·DB인지 검사한다. 실제 원격형 가짜 URL을 넣은 네 명령 모두 suite 실행 전 차단됐다.
- `local:backend:prepare`는 고정 Docker context와 `ops/local/backend.compose.yaml`의 PostgreSQL-only `dabboba-development` 프로젝트를 사용한다. 전용 volume은 `dabboba-development_dabboba_development_postgres17_pgmq_data`, DB는 `dabboba_development`, 포트는 loopback 55433이다. 기존 클러스터의 LOGIN 역할을 발견한 첫 시도는 덮어쓰기 전에 차단됐고, 기존 volume·DB·LOGIN을 보존하기 위해 새 클러스터로 분리했다.
- `.env.development.local`은 Git 제외·0600이며 준비 명령 반복 실행은 파일 변경·비밀번호 회전 없이 검증 후 재사용했다. API runtime/worker/migration URL을 분리하고 worker에는 session pepper·admin secret을 넘기지 않는다. LOCAL의 실제 결제·Supabase Auth/Storage·외부 push 연결은 비활성 상태다.
- 기존 `.env`, `apps/mobile/.env`, `apps/admin/.env.local`, `DABBOBA 열기.command`, migration 0038/0039는 SHA 비교로 보존을 확인했다. Redis의 시작 시각·PID·health도 유지됐다. 자동 포트 변경이나 다른 앱 서비스 종료는 하지 않았다.
- 기존 Metro의 옛 프로필은 launcher 읽기 전용 검사에서 먼저 차단됐다. 감독자가 정확한 DABBOBA PID/cwd를 확인한 뒤 SIGTERM으로 종료하고 새 LOCAL API·Metro를 기동했다. 기존 assets 서버는 재사용했다. `--services-only`로 확인했으며 Simulator UI나 실기기를 열어 검증한 것은 아니다.

| 마지막 검증 범위 | 결과 |
| --- | --- |
| 환경·launcher 집중 검사 | 53 pass, fail 0·skip 0; 후속 Compose/포트·admin loopback 보호 검사 5 pass |
| DB / API / worker / config | **86 / 173 / 65 / 27 pass**, 모두 fail 0·skip 0 |
| root unit | **528 pass**, fail 0·skip 0 |
| workspace build + typecheck | 23/23 작업 성공, 보호 UI/runtime 28개 파일 무결성 통과 |
| `test:all` 종합 명령 | 35/35 작업 성공; browser 9 pass, Sites 4 pass |
| 나머지 package | admin 18, media-storage 15, ui 1, mobile 34, domain 3, api-client 4, contracts 18 pass |
| Cloud Run | build guard 8, API revision 44, release attestation 45, media 11, IAM 8 pass; API/worker/migration 이미지와 context build 통과, 배포 안 함 |
| 별도 통합 DB release gate | 40/40 migration 일치, application table 77개 RLS, anon/auth table 노출 0, 세 역할·동일 DB 확인 `pass` |
| 새 개발 DB | 40개 migration, application table 77개 RLS, 활성 상품 0; prepare 반복·`local:backend:check` 통과 |
| 실제 LOCAL API | health/ready/catalog/providers 200, 비로그인 inventory 401, malformed JSON 400, 개발 계정 생성 201 후 me/inventory 200 |
| LOCAL admin | `127.0.0.1:4180` loopback-only listener와 `/login` 200 확인 후 검증용 프로세스 종료; 실제 관리자 로그인·MFA 증거 아님 |
| 실제 LOCAL worker | finite 실행 2회 모두 completed, periodicCompleted 3·periodicFailed 0, 외부 전송/실결제 없음 |
| iOS Metro | 개발 bundle 생성 성공, 저장된 운영 Supabase public URL/key 미포함; native/실기기 증거 아님 |

검증 로그와 보조 harness는 `/tmp/dabboba-environment-final-20260908.XWpPxG/`에 있다. 별도 통합 DB는 `dabboba-backend-integration-20260905`의 loopback 55439에 새로 만든 `dabboba_environment_isolation_20260908_v1`이며, 기존 검증 DB를 초기화하지 않았다. 신규 DB migration이 test cluster 역할을 NOLOGIN으로 정규화한 첫 실행 뒤 해당 disposable 역할의 LOGIN만 복구하고 비밀번호는 변경하지 않은 상태에서 86/173/65개 통합 검사를 다시 통과했다. 종합 `test:all`은 공유 DB 경쟁을 피하려고 DB URL 없이 실행했으며 DB 필요 suite의 통합 증거는 앞선 세 역할 순차·zero-skip 실행으로 확보했다. 예전 dev 명령 문자열을 비교하던 포트 테스트는 새 wrapper의 실제 고정 포트·상속 방지 경계로 갱신한 뒤 통과했다.

운영 worker는 아직 별도 LOGIN/연결 비밀값 준비와 실제 제한 역할 검증이 남았다. 온라인 staging 생성, 실제 OAuth/SMS/Storage/push/PG, 운영 배포·worker 스케줄, 원격 복원·외부 백업 및 실기기·스토어·법무/IP 검증은 완료 처리하지 않는다. 비밀값을 채팅에 붙이지 않고 승인된 비밀 저장소로 준비한다. 검증 후 새 개발 PostgreSQL·API·assets·Metro와 기존 Redis는 유지했고, disposable 통합 테스트 컨테이너 및 admin smoke 프로세스는 종료했다. 어느 DB/volume도 삭제하지 않았다.

### 앞선 DB·API 체크포인트

- `0038_shipping_request_item_snapshots.sql`이 기존 배송 상품을 backfill하고, 신규 신청은 신청 시점의 상품 ID·상품명·IP·카테고리·이미지·version을 JSONB로 고정한다.
- PostgreSQL trigger가 스냅샷을 현재 inventory/catalog 레코드와 교차 검증한다. 위조된 최초 INSERT는 `23514`, 생성 후 UPDATE/DELETE는 `55000`으로 거부한다.
- API는 선택한 inventory 수와 스냅샷 INSERT 수가 다르면 같은 transaction을 실패시켜 부분 배송 신청을 남기지 않는다.
- 배송 상세는 현재 카탈로그가 바뀌어도 신청 당시 상품 정보를 반환한다. 주소는 기존처럼 마스킹하고 요청 소유자 밖에는 404로 숨긴다.
- 운영 최소 권한 `dabboba_runtime` 연결로 기본 배송지 저장 → 배송 신청 → idempotent replay → 소유자 상세 → 타인 404 → DB 영속 상태를 검증했다.
- Cloud Run의 DB release attestation을 최신 `0039` checksum으로 회전해, 과거 `0037` 검증만으로 API/worker 배포가 열리지 않게 했다.
- `0039`는 대상 개발 판매 확률표를 같은 transaction에서 먼저 `RETIRED`로 전환한다. `AVAILABLE` 추첨권, 미해결 주문·결제·재고 예약, 활성 쿠지 참여·예약 binding 또는 일반 판매 확률표의 개발 경품 참조가 있으면 전체를 중단하며, 완료된 order/payment·draw result·inventory 이력은 보존한다.
- 네이티브 `redirectSystemPath`는 Expo Router 파싱 전에 4096자 초과와 malformed percent escape·UTF-8을 거부한다. 유효한 앱 경로·auth callback·Expo 개발 URL은 원문 그대로 반환한다. 이는 로컬 코드 완화이며 dependency audit 제거 또는 실기기 deep-link 증거가 아니다.

## 원격 DB 적용 체크포인트

- 로컬 `.env`가 가리키는 **원격 Supabase DB**에서 2026-09-08 암호화 논리 백업을 생성하고 전체 인증 태그와 SHA-256을 확인했다. 연결에는 Supabase Root 2021 CA와 TLS `verify-full`을 사용했으며 archive·key 파일은 각각 `0600`, 상위 디렉터리는 `0700`이다.
- 최신 archive: `/Users/kyoungmin/Desktop/DBB_BACKUPS/DABBOBA/20260908T103057Z/dabboba-remote-20260908T103057Z.dbbenc`
- 최신 archive SHA-256: `e08c76c1ea83969852defd38d4ac45376ce93864901efd56feadd15438f42153`. `0038`까지 적용된 원격의 변경 직전 백업이며, 기존 `20260908T082006Z` archive도 덮어쓰지 않고 보존했다.
- 첫 실행 전 원격에는 38개 migration(`0037`까지)이 있었다. 당시 `0038`은 checksum `59379f83d094d86a79523a83d69ebdb559947657bea24fea89e5a1a8233f8531`로 commit됐고, 최초 `0039`는 활성 확률표의 개발 경품 참조 때문에 해당 transaction 전체가 rollback됐다. 이 과거 실패를 현재 적용 상태와 구분한다.
- 차단 원인을 반영하고 로컬 검증한 `0039`(checksum `9bee32390788e2c57c549bfad41d882b2bb626da9b3a175182bfa240e1449502`)를 최신 백업 검증 후 한 번 적용했다. 현재 원격은 **40개 migration, 미적용 0, checksum 불일치 0, 알 수 없는 migration 0**이다. 적용 집합 SHA-256은 `2abe00bdd2be70d83606165ea82189402004b499347750bfde8dfbc354857aa2`다.
- 개발 상품 10개는 행을 보존한 채 active 10→0, 대상 IP 집합 25개는 active 6→0, 대상 판매 확률표는 ACTIVE 2→0·RETIRED 4→6이다. 혼합 경품 참조·미사용 추첨권·미해결 주문/결제/재고 예약·활성 쿠지 참여/예약 등 7개 중단 조건은 전후 모두 0이었다.
- 적용 직전·직후 읽기 전용 snapshot에서 완료 주문 상품 4행, 완료 결제 1행, 종료 추첨권 4행, 추첨 결과 4행, 보관함 4행, 종료 쿠지 참여 5행의 행 수와 정렬된 전체 행 해시가 일치했다. 나머지 배송/교환/종료 예약·binding 이력 집계도 동일했다. 운영 health snapshot의 19개 지표에서 이상 항목은 0이었다.
- 원격 `public` application table 77개 모두 RLS 활성, `anon`·`authenticated`에 노출된 application table 0개를 확인했다. 이는 실제 사용자별 권한 시험이나 Security/Performance Advisor 전체 검증을 대체하지 않는다.
- 원격 역할 조회와 로컬 설정 분류 결과 API는 `dabboba_runtime` LOGIN, migration은 별도 owner 계정이다. 실제 runtime 연결의 읽기 전용 세션에서도 `current_user=dabboba_runtime`과 TLS 인증 성공을 확인했다. `dabboba_worker`는 존재하지만 **NOLOGIN**, `WORKER_DATABASE_URL`은 없어서 3종 연결 분리와 실제 worker 제한 권한 실행 증거는 아직 미완료다. 역할·비밀번호·비밀값은 변경하지 않았다.
- 사후 확인 스크립트가 기존 RETIRED 4개를 누락하고 총 2개를 기대해 실패했으나, 실제 결과는 기존 4개+이번 전환 2개=6개로 정상이다. 직전·직후 JSON과 전체 checksum을 다시 비교했으며 migration을 재실행하지 않았다.
- DABBOBA 로컬 API만 잠시 멈춘 뒤 같은 cwd·기동 명령으로 복구했다. 재기동 확인에 잘못된 `/health`·`/ready` 경로와 유지되지 않는 자식 프로세스를 사용해 복구가 지연됐으며, 지속 실행 세션으로 재기동 후 감독이 `/healthz` 200, `/readyz` 200(`database=ok`)을 독립 확인했다. 고객 products·IP·home-sections는 200/0개, auth provider 조회는 200, 비로그인 inventory는 401이다. 승인된 운영 상품을 등록하기 전까지 고객 카탈로그가 비어 있는 것이 이번 비활성화 결과다. UI 파일과 다른 앱 서비스는 변경하지 않았다.
- 이 확인 시점에는 대상의 개발·스테이징·운영 등급이 저장소와 연결 문자열만으로 확인되지 않아 **UNKNOWN**으로 기록됐다. 이후 승인된 용도 결정은 위 환경 분리 절을 따른다. 원격 복원, 운영 앱/API/worker 배포는 수행하지 않았다.

## 후속 DB·API 완성도 보강 — 구현 및 최종 로컬 검증 완료

사용자 요청에 따라 후속 구현을 먼저 통합하고 테스트·타입 검사·빌드·실행 검증은 마지막 단계에 수행했다. 이번 범위는 기존 업무 규칙을 바꾸지 않는 연결 실패 복구·오류 정보 보호·운영 설정 검사와 읽기 전용 DB release 점검이다. 결제사 선택, 외부 인증 개편, 관리자 MFA 방식, 가격·법무 정책, 운영 credential 변경·배포는 임의로 결정하거나 실행하지 않았다.

- DBB-011: transaction 실패 원인 보존과 rollback 실패 연결 폐기, 유휴 DB 연결 오류 처리, worker 초기 연결 실패 정리, worker 로그·재시도 오류 원문의 민감정보 노출 방지, 읽기 전용 release 점검.
- DBB-012: 비정상 JSON의 400 처리, 유효 범위 밖 HTTP 상태 거부, DB 상세·stack·cause를 제외한 API/종료 오류 기록, 요청 로그에 원본 URL 대신 method·고정 route만 기록, 허용 origin·관리자 API 주소의 credentials/path/query/fragment 거부.
- CI: disposable PostgreSQL에 Supabase 모델용 `anon`·`authenticated` NOLOGIN 역할을 먼저 준비하고, migration/runtime/worker 준비 후 읽기 전용 `check:release`를 통과해야 후속 검사를 진행하도록 연결했다. 실제 GitHub Actions 실행은 하지 않았다.
- 문서: 실제로 비어 있는 IP·상품 fixture, 현재 Kakao·Naver·SMS 인증 경계, 기존 `.env`의 원격 대상 오사용 방지를 README와 운영 안내에 반영.

### 이번 최종 검증 결과

| 경계 | 이번 실행 결과 |
| --- | --- |
| 빈 로컬 PostgreSQL 17 + pgmq | 40개 migration 순서 적용, 재실행 no-op; 기존 0038/0039 checksum 유지 |
| 읽기 전용 DB release 점검 | `TEST`, 3종 실제 연결 역할 분리, checksum 40/40 일치, application table 77개 RLS, anon/authenticated table grant 노출 0; `pass` |
| DB / API / worker / config | 각각 **86 / 173 / 63 / 22 pass**, 모두 fail 0·skip 0 |
| 나머지 workspace 패키지 | admin 18, media-storage 15, UI 1, mobile 구조 34, domain 3, api-client 4, contracts 18 pass; 모두 fail 0·skip 0 |
| 앱 단위·구조 검사 | 521 pass, fail 0·skip 0; 다른 패키지 검사와 일부 범위가 겹치므로 총합을 고유 시나리오 수로 계산하지 않음 |
| 전체 build + typecheck | 23/23 task 성공; 모바일 보호 파일 28개 무결성 통과 |
| 브라우저 / Sites | 9 / 4 pass |
| 배포 보호 장치 | build guard 8, API candidate 44, release attestation 45, media storage 11, API revision 8 pass |
| 배포용 이미지 | API·worker·migration 3개 Docker build 및 context 검사 통과; 업로드·배포는 안 함 |
| 암호화 backup → 빈 로컬 clone restore | 84 tables·40 migrations·470 constraints·197 CHECK 일치; queue/archive/sequence와 0038/0039 복원 확인; 약 4.29초 |
| dependency audit | high/critical 0, 기존 moderate 1 잔존; 경고 제거 완료로 표시하지 않음 |
| 재기동한 로컬 API | health/ready 200·DB ok, catalog products/IP/home-sections 200·각 0개, providers 200, 비로그인 inventory 401, 비정상 JSON 400 `INVALID_REQUEST` |

테스트 fixture는 `dabboba-backend-integration-20260905`의 loopback `127.0.0.1:55439`에 새로 만든 `dabboba_restore_drill_backend_final_20260908_v2`다. 첫 v1 실행에서 Supabase 기본 역할 부재로 release 점검이 차단되어 CI와 로컬 fixture 준비를 보완한 후 v2 빈 DB에서 migration과 전체 역할 검사를 다시 수행했다. 복원 훈련은 v2에 RLS 없는 `backup_snapshot_probe` 시험 테이블을 남기므로 그 뒤 release 점검은 `public_table_rls_disabled`로 차단됐다. 해당 테이블을 무시하거나 지우지 않고, 마지막 release 증거는 새 빈 `dabboba_restore_drill_backend_release_clean_20260908_v3`에 40개 migration과 3종 역할을 준비해 별도로 `pass`를 확인했다. 차단 조건을 약화하지 않았고 v1·v2·v3 및 복원 훈련 DB를 자동 삭제하지 않았다. 로컬 복원은 자동 백업·원격 복원·role grants 복원·Storage 복원 증거가 아니다.

세부 실행 로그: `/tmp/dabboba-backend-final-20260908.srLwig/`. 복원 fixture: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/dabboba-encrypted-restore-drill-qtjxMF`. 이 임시 경로들은 영구·외부 백업 보관소가 아니다.

이전 DBB-011/012 단계에서 `.env`를 명시적으로 읽은 release 점검은 **`missing_worker_database_url`로 blocked**, 당시 환경 용도는 **UNKNOWN**이었다. 입력 검사에서 중단했으므로 이 실행은 원격 DB에 접속하거나 3종 운영 역할을 검증한 것이 아니다. 원격에 새 migration·계정·비밀값 변경은 하지 않았다. 앞선 원격 40개 적용 증거와 해당 로컬 검증을 구분한다.

그 체크포인트에서는 DABBOBA 로컬 API를 새 코드로 재시작해 유지했고, 다른 앱 서비스·기존 UI는 건드리지 않았다. 당시 시작한 테스트 DB 컨테이너는 검증 후 다시 종료했고 데이터 볼륨은 보존했다. 새 파일 7개와 tracked 변경의 whitespace 검사, CI YAML 구문 검사도 통과했다. 최신 API의 LOCAL 전환 상태는 위 환경 분리 절을 따른다. 실제 운영 API/worker 배포, signed native build, 실기기와 실제 외부 공급자 거래는 해당 검증 범위가 아니다.

## 앞선 체크포인트의 로컬 증거

| 경계 | 결과 |
| --- | --- |
| PostgreSQL 17 + pgmq 빈 DB migration | 40개 순서 적용, 재실행 no-op |
| 암호화 DB 복원 훈련 | backup→인증→빈 로컬 clone restore; 8 unit pass, 40 migrations·84 tables·470 constraints·197 CHECK 일치, 0038/0039 direct=true |
| DB 패키지 | 73 pass, 0 fail, 2 skip; 별도 URL이 필요한 runtime/worker 역할 suite 제외 |
| Fastify API | 168 pass, 0 fail, 0 skip |
| worker | 59 pass, 0 fail, 0 skip |
| 제한 역할 실제 API 경로 | 1 통합 시나리오 pass, skip 0; catalog·알림 설정·주문·가챠·쿠지·inventory·배송 포함 |
| TypeScript/정적 보안 가드 | DB/API typecheck·build, migration 정적 감사, `git diff --check` 통과 |
| 네이티브 system URL 경계 | 길이 상한·percent/UTF-8 검증과 cold `/`·warm `null` 거부를 실제 함수 호출로 확인 |
| 앱 단위/구조 검사 | 517 pass, 0 fail |
| Expo production JS export | iOS/Android exit 0, bundleIdentifier/package `com.dabboba.mobile`; metadata·Hermes bundle·assets 존재, 0-byte 0. 저장소 밖 로컬 export이며 signed native/development build·실기기·provider callback은 미검증 |
| 전체 작업공간 최종 조합 | task 35/35, runtime 9, Sites 4 통과 |
| 브라우저 런타임 | 9 pass, 0 fail |
| Sites/Cloud Run 배포 가드 | Sites 4 pass; Cloud Run artifact·release attestation 가드와 API·worker·migration Docker build 3종 통과 |

위 표의 검증 DB는 이 작업에서 새로 만든 루프백 전용 disposable container이며 기존 로컬 데이터 볼륨은 건드리지 않았다. 원격 Supabase에는 위에 적은 승인된 백업·migration·사후 read-only 확인 범위로만 접속했고, 원격 복원·PG 공급자·Storage·실기기에는 접속하지 않았다. 로컬 훈련과 원격 백업 성공은 운영 Supabase 전체 복구·PITR·role grants·Storage 또는 운영 RPO/RTO 검증이 아니다.

## 출시 전 필수 운영 게이트

1. 전용 Supabase project와 billing/region을 확정하고 40개 migration, runtime/worker 역할, RLS·Data API grant, Security/Performance Advisor를 검증한다.
2. 빈 별도 환경에 암호화 backup+pgmq 복원을 수행하고 RPO/RTO·보존 기간·승인자를 기록한다.
3. Kakao·Naver·최종 SMS 공급자와 Supabase Auth redirect/JWKS를 development build·실기기에서 확인한다.
4. 국내 PG를 선정하고 공급자별 승인·서명·조회·취소·환불 adapter와 sandbox 증거를 추가한다. 현재 `UNCONFIGURED`는 정상적으로 실결제를 거부한다.
5. private Supabase Storage, 유해물 검사, CDN/CORS, 타인 object 거부, worker 재삭제, 라이선스 자산을 운영 환경에서 확인한다.
6. 신뢰 ingress/WAF가 client IP header를 제거·덮어쓰는 구성을 확정하고 spoofing 거부, IP별 429, 서로 다른 사용자 예산 분리를 검증한다.
7. APNs/FCM, 택배/풀필먼트, 에러 추적·metric·alert·on-call을 실제 계정으로 연결한다.
8. TestFlight/Play internal testing에서 실제 iPhone/Android의 cold/warm auth callback, 결제 복귀, 업로드, push, background/kill, 네트워크 단절을 확인한다.
9. IP 자산 권리, 사업자/통신판매, 이용약관·개인정보·확률형 상품·환불·미성년자 정책, 스토어 신고 정보를 승인한다.

## 현재 알려진 코드 게이트

- `pnpm audit --prod --audit-level moderate`는 high/critical 0, moderate 1이다. 남은 경로는 Expo Router의 `query-string@7.1.3`이 사용하는 `decode-uri-component@0.2.2` DoS advisory다. 4096자 native intent 완화 뒤에도 audit 항목은 남는다. 패치 패키지 `0.5.0`은 ESM-only이므로 무조건 override하지 않고, 지원되는 Expo 업그레이드와 실제 iPhone/Android의 cold·warm deep link·auth callback 회귀 뒤 잔존 위험을 승인한다.
- 실제 운영 Supabase에서 Advisor·PITR·Storage·Queues·Auth를 실행한 증거는 없다. 로컬 PostgreSQL/fixture 결과로 대체하지 않는다.
- 상품 실물 lot/입고·검수 원장과 가챠·쿠지 pool 수량 대조는 운영 데이터·책임자 확정 전에는 자동 출시 승인으로 바꾸지 않는다.

전체 외부 작업은 [사용자 작업 목록](dabboba-user-actions.md), 배포·롤백은 [Cloud Run 배포 가이드](cloud-run-deployment.md), 장애 대응은 [운영 런북](dabboba-operations-runbook.md)을 따른다.
