# DB·백엔드 연결 검증 — 2026-09-05

마무리 날짜: 2026-09-06. 사용자의 요청으로 진행 중이던 구매 복구 처리와 검증까지만 마무리하고 추가 작업은 중단했다. 아래 운영 미완료 항목은 다음 목표에서 결정한다.

## 범위와 판정

기존 DABBOBA Supabase PostgreSQL/Auth와 Fastify API를 유지한다. 기존 회원·주문·포인트·보관함은 테스트 데이터로 덮어쓰지 않는다. FINDE/FINDY는 작업 대상이 아니다. 로그인 정책 확대는 사용자가 보류했으므로 이번 작업에서 적용하지 않는다.

**현재 판정: 실제 DB 연결 및 로컬 서버 검증 통과, 외부 운영 적용은 미완료.** 이 문서는 작성 시점의 증거이며 배포 승인이나 최신 상태를 대신하지 않는다.

## 실제 Supabase — 읽기 전용 확인

| 항목 | 확인 결과 |
| --- | --- |
| PostgreSQL | 17.6, 기존 `postgres` 데이터베이스 |
| API 연결 | Session pooler 5432, `dabboba_runtime` 로그인 성공 |
| migration 연결 | 별도 `postgres` 소유자 연결 성공; API에 주입하지 않음 |
| 변경 이력 | 0000~0037 총 38개 적용, 로컬 SQL SHA-256과 전부 일치 |
| pgmq | 실제 설치 버전 1.5.1 및 `send/read/delete/set_vt` 함수 signature 확인 |
| API·Worker DDL | public 스키마 CREATE, SUPERUSER, CREATEDB, CREATEROLE 모두 없음 |
| Data API | `anon`, `authenticated`, `service_role`의 public 테이블 DML 접근 0개 |
| outbox | 확인 시점 미발행 0건, 재시도 0건 |
| Worker | 역할은 존재하지만 NOLOGIN, 로컬 `WORKER_DATABASE_URL` 없음 |

Runtime/Worker의 BYPASSRLS는 기존 **서버 전용** 설계다. 고객 행 접근은 Fastify 인증·인가와 트랜잭션으로 강제하며, 이 계정들은 앱에 제공하지 않는다. 이를 Supabase 클라이언트 직접 접근 권한으로 해석하면 안 된다.

원격 DB에는 이번 검증용 fixture, 포인트, 구매, 추첨 결과를 생성하지 않았다. 이미 일치하는 migration도 원격에 재적용하지 않았다.

## 새 격리 DB에서 검증

이름이 구분되는 로컬 PostgreSQL 17/pgmq 컨테이너를 새로 만들었다. 앱 `.env`를 통합 테스트에 로드하지 않았고, 테스트용 URL을 명시적으로 지정했다. 기존 로컬 DB와 원격 Supabase는 초기화하지 않았다.

| 요구·위험 | 증거 | 결과 |
| --- | --- | --- |
| 빈 DB 설치와 재실행 | 38개 migration 적용, 두 번째 실행 `Database schema is current` | 통과 |
| 역할 분리·결과 위조 차단 | DB 테스트 69개, skip 0 | 통과 |
| 고객·관리자·커머스 서버 계약 | API 전체 테스트 157개, skip 0 | 통과 |
| 제한 계정의 실제 구매·추첨 | 확장한 runtime-role route 통합 테스트 별도 실행 | 통과 |
| 만료·재조정·큐 재시도 | Worker 테스트 52개, skip 0 | 통과 |
| 모바일 구매 복구·화면 계약 등 | 마지막 변경 후 루트 테스트 436개, skip 0 | 통과 |
| 모바일 타입·프로젝트 무결성 | typecheck, workspace 14개 경로, runtime 보호 파일 28개, diff 공백 검사 | 통과 |

확장된 runtime-role 통합 테스트에서는 fixture 준비만 소유자 연결로 수행한다. 이후 고객 API는 실제 `dabboba_runtime`을 사용한다.

- 가챠: 포인트 전액 사용 → `INTERNAL_ZERO` 주문 → 추첨권 → 서버 확정 결과 → GACHA 보관함.
- 쿠지: 대기실 → 포인트 전액 사용 → 번호 바인딩 → 서버 확정 결과 → 방 완료와 KUJI 보관함.
- 동일 요청 재전송에도 주문·추첨·번호 바인딩의 결과가 같고 DB 기록이 한 번만 생김.
- 타 사용자의 주문 조회·추첨권 사용은 거부되고 보관함 상품은 노출되지 않음.
- 외부 결제, 실제 문자, 실제 배송은 이 테스트가 증명하지 않음.

## 가챠 구매 연결 및 응답 유실 보호

기존 가챠 `구매하기`의 개발 미리보기 전용 연결을 실제 `/v1/orders` 호출로 연결했다. 개발 체험은 별도 선택으로 유지하며, 정식 경로는 서버가 확인한 PAID/FULFILLED 주문과 정확한 추첨권 목록만 사용한다. 애니메이션과 당첨 결과의 서버 확정 경계는 변경하지 않는다.

- 요청 전 SQLite에 계정·상품별 구매 의도를 저장한다. 계정은 토큰 문자열이 아니라 인증된 서버 프로필 ID로 구분한다.
- 통신 오류·중복 탭·재시작에서도 같은 본문과 요청 키를 사용하며 저장 실패 시 POST하지 않는다.
- 결제 완료 의도를 화면 이동 전에 삭제하지 않는다. 알려진 주문은 GET으로 복구한다. 최종 결과에서 상품으로 돌아갈 때 현재 계정·주문을 다시 조회하고, 해당 주문의 모든 추첨권에 서버 consume 성공 증명이 있을 때만 구매 복구 정보를 정리해 다음 구매를 허용한다.
- 일부만 열고 나가기, 마지막 추첨권 URL만 열기, 체험 모드, 통신 실패, 화면 전환 중 늦게 도착한 응답은 복구 정보를 유지한다. SQLite 정리도 트랜잭션 안에서 현재 화면 소유권과 저장된 주문 ID·요청 키를 재확인한다. 다시 이어 열 때 이미 사용한 추첨권은 서버의 기존 확정 결과를 재생하며 새 당첨이나 추가 차감은 발생하지 않는다.
- 현재 재고/확률표가 없어도 저장된 주문 확인 경로는 유지한다. 다른 상품·계정·수량·포인트 응답은 거부한다.
- 서버도 완료된 `CREATE_ORDER` 키를 일반 24시간 TTL 이후 보존한다. 기존 코드에서 만료 후 원주문 재생에 실패하는 RED를 재현했고, 변경 후 같은 주문 재생/다른 본문 409/타 scope TTL 유지가 실제 제한 계정 DB 테스트에서 통과했다.
- 오래된 POST 응답을 복구할 때는 주문 ID를 먼저 저장하고 GET으로 최신 취소·환불·결제 상태를 다시 확인한다. GET 실패 후에는 저장된 ID로만 재시도한다.

미확정 주문을 24시간 넘게 자동 재전송하거나 새 키로 바꾸지는 않는다. 장기간 미확정 건과 앱 데이터 삭제/다른 기기 복구는 주문 내역 및 운영 확인이 필요하다. `Order` 응답에는 확률표 버전이 직접 노출되지 않지만, 서버는 요청한 `expectedDrawVersion`과 주문 행/추첨권의 고정 버전을 검증한다. 이 항목을 모바일의 직접 버전 재검증 완료로 보고하지 않는다.

이 서버 보강은 새 API 코드가 실행되는 환경에서만 유효하다. 아직 생성되지 않은 Cloud Run 서비스에 적용됐다고 간주하면 안 된다.

현재 로컬 API는 보강한 코드로 재시작했으며 `/healthz`, `/readyz`, 상품 목록 응답을 확인했다. 구매 완료 복구 처리는 실제 화면 콜백을 실행하는 테스트로 전체/부분 완료, 다른 계정·주문, 취소 주문, 미리보기, 통신 실패, 중복 터치, 화면 변경·종료 경계를 검증했다. 네이티브 시뮬레이터·실기기의 전체 구매 흐름을 이번 검증에서 직접 조작한 것은 아니다.

재실행은 CI의 `database-migrations` 작업을 따른다. URL은 반드시 별도 disposable DB로 준비하며, 앱 `DATABASE_URL`과 같은 대상을 쓰지 않는다.

```sh
corepack pnpm workspace:packages
corepack pnpm --filter @dabboba/api build
corepack pnpm --filter @dabboba/worker build
# 격리 DB 전용 환경변수를 구성한 뒤 실행. 실제 앱 .env를 로드하지 않는다.
corepack pnpm --filter @dabboba/db test
corepack pnpm --filter @dabboba/api test
node --test apps/api/dist/runtime-role-routes.integration.test.js
corepack pnpm --filter @dabboba/worker test
```

## 배포용 API 이미지 로컬 확인

- production multi-stage API 이미지와 Worker 이미지 빌드 성공.
- `bash ops/cloud-run/check-artifacts.sh --build` 통과: build guard 8개, candidate release 41개, release attestation 44개, API/Worker/migration 이미지와 비밀 파일 제외 build-context 검사. Google Cloud에는 업로드하지 않았다.
- API를 `NODE_ENV=production`, `API_SURFACE=customer`, CPU 1, 512MiB, PORT 8080으로 **로컬에만** 실행했다.
- 이 짧은 API 점검에는 기존 runtime 연결만 전달했고, migration/Worker/관리자 secret은 전달하지 않았다. 테스트용 세션 pepper를 사용해 기존 사용자 세션을 사용하지 않았다.
- `/healthz`, `/readyz`, 실제 상품 목록, 홈 섹션 조회 200. DB readiness `ok`, 상품 목록 6개.
- 비로그인 `/v1/account/profile`은 401. `/v1/admin/dashboard`와 개발 로그인 경로는 404.
- 이미지 안의 `.env`, TypeScript 원본, source map, 테스트, seed/migration/role-provisioning 실행 파일 검출 0개.
- 점검 컨테이너는 정상 종료하고 제거했다. 빌드 이미지와 격리 테스트 DB는 로컬에만 존재한다.

512MiB에서 시작·가벼운 읽기가 가능하다는 증거이며, 실사용 부하나 미디어 처리의 최대 메모리를 증명하지 않는다. Cloud Run 배포·외부 공개·트래픽 전환을 수행한 것은 아니다.

Worker 이미지도 빈 격리 DB에서 한 번 실행해 정상 종료를 확인했다. 실제 pgmq 1.5.1, 주기 작업 3개 완료, 실패 0개였다. 이 실행은 `NODE_ENV=test`이며 원격 데이터·외부 미디어·외부 알림에는 접근하지 않았다. 운영 실행 일정이나 공급자 연결을 증명하지 않는다.

Worker 첫 실행은 새 DB migration이 안전 기본값으로 역할을 NOLOGIN으로 설정해 거부됐다. 테스트 환경 준비 순서 문제로 분류했고, 격리 DB 역할 로그인 provisioning을 migration **후**에 수행한 뒤 정상 실행을 확인했다. 로그인 제한을 없애거나 API 계정으로 우회하지 않았다.

## 사용자가 직접 준비해야 하므로 건너뛴 항목

1. **DABBOBA 전용 GCP 프로젝트와 Billing**: 현재 활성 프로젝트는 다른 제품이다. DABBOBA 운영자 설정과 접근 가능한 DABBOBA 배포 대상이 없어 다른 프로젝트를 사용하지 않았다.
2. **유료 리소스·운영 노출 승인**: Registry/버킷/Secret Manager/IAM/Budget와 공개 API 보호 정책, candidate 배포 및 트래픽 승격. Budget 알림은 과금 자동 차단이 아니다.
3. **Worker 운영 비밀값과 실행 일정**: 최소권한 계정의 안전한 로그인 설정, Secret Manager 전달, 짧은 인증 실행 일정과 비용 승인. API/소유자 계정으로 대체하지 않는다.
4. **결제사**: 현재 `PAYMENT_PROVIDER=UNCONFIGURED`. 외부 금액이 필요한 구매는 실패하도록 막혀 있다. PG 계약·키·결제창 SDK/복귀/서버 검증이 별도로 필요하다.
5. **문자·소셜·미디어·외부 알림 제공자**: 실제 공급자 설정과 운영 검증이 필요하다. 설정 존재, 버튼 표시, 단위 테스트 통과를 실제 문자 수신이나 로그인 성공으로 보고하지 않는다.
6. **운영 상품 판매 설정**: 가챠 판매용 활성 확률표/경품 풀과 재고를 관리자 절차로 확인해야 한다. 미설정 상품에 임의 경품이나 당첨 확률을 넣지 않는다.

비밀번호·DB URL·secret·서비스 계정 키는 채팅이나 이 문서에 붙여 넣지 않는다. Supabase 플랜 변경, GCP 과금 리소스 생성, 실제 결제, Git 커밋·푸시·PR은 수행하지 않았다.

작업 종료 시 이번에 만든 격리 테스트 DB 컨테이너만 중지하고 데이터는 보존했다. 기존 로컬 API·Metro는 그대로 유지한다.

## 참고한 공식 자료

- [Supabase 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres): Session/Transaction 방식의 용도를 구분한다.
- [Supabase pgmq](https://supabase.com/docs/guides/queues/pgmq): 문서와 별개로 실제 설치 함수 signature를 조회했다.
- [Extension 버전 지정 변경 공지](https://supabase.com/changelog/extension-version-pinning-ignored): 새 설치의 VERSION 지정에 의존하지 않으며 실제 설치 상태를 검증한다.
- [Cloud Run 배포](https://docs.cloud.google.com/run/docs/deploying): 로컬 이미지 검증과 실제 서비스 배포를 구분한다.
