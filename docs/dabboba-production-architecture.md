# DABBOBA 운영 아키텍처

## 문서 상태

이 문서는 현재 저장소에 만들어진 운영 기반과 아직 외부 준비가 필요한 경계를 구분하는 기준 문서다. `docs/ip-system-architecture.md`의 프런트엔드 Phase 1 설명보다 이 문서의 현재 상태가 우선한다.

현재 목표는 Expo 네이티브 앱을 본체로 하는 TypeScript 모듈러 모놀리스다. 코드가 존재한다는 사실은 배포, 실결제, 실제 기기, 복구 훈련 또는 법적 출시 준비가 완료됐다는 뜻이 아니다. 앱 중심 이전의 구체 순서는 `docs/dabboba-mobile-first-migration.md`가 우선한다.

## 현재 구성

```text
Expo React Native 앱 ─────────┐
향후 고객 웹 확장 ────────────┼── Fastify API ── Supabase PostgreSQL (업무 원장)
                             │          │
관리자 브라우저 ── Next Admin┘          ├── transactional outbox
                                        │           │
결제사 webhook ─────────────────────────┘           ▼
                                           Supabase Queues ── Worker
                                                          │
                                             Supabase Storage/알림 공급자
```

| 계층 | 저장소 위치 | 현재 역할 |
| --- | --- | --- |
| 고객 앱 | `apps/mobile` | Expo Router 기반 React Native 제품 본체. 네이티브 화면, SecureStore token, SQLite cache와 실제 기기 동작의 기준 |
| 고객 웹/legacy | 저장소 루트 `src/` | 기존 승인 화면을 보존하는 이전 참고 구현이자 향후 웹 확장 채널. 새 고객 기능의 단독 기준이 아님 |
| 관리자 웹 | `apps/admin` | 별도 Next.js App Router 운영 화면. 브라우저가 DB에 직접 연결하지 않고 서버 측 DAL이 API만 호출 |
| API | `apps/api` | 인증/RBAC, 계정·배송지·찜, 카탈로그, 커뮤니티, 문의, 교환, 주문·결제·재고·포인트·추첨, 관리자 명령의 권위 있는 경계 |
| 비동기 작업 | `apps/worker` | Supabase Queues(`pgmq`) outbox 전달, 예약 만료, 결제 재조정 대상 탐지, 알림, 미디어 정리를 한정된 Cloud Run Job 실행으로 처리 |
| 계약 | `packages/contracts`, `packages/api-client` | OpenAPI 원본, 생성 TypeScript 타입, 공용 REST 클라이언트 |
| 도메인 | `packages/domain` | 역할, 상태 전이, 카테고리별 구매/추첨 규칙 |
| 데이터 | `packages/db` | Supabase PostgreSQL 연결 대상, 체크섬 SQL migration, 로컬 seed. Drizzle을 안정된 module부터 점진 도입 |
| 공용 설정/UI | `packages/config`, `packages/ui` | 런타임 환경 검증, 운영 화면 토큰 |

pnpm Workspace와 Turborepo가 이 경계를 묶는다. 독립 서비스로 분리하기 전에 기능 모듈, 트랜잭션, 권한, 운영 지표를 먼저 안정화한다.

## 데이터와 트랜잭션 원칙

PostgreSQL만 다음 상태의 진실 공급원이다.

- 사용자, 인증 식별자, 세션, 관리자 권한과 감사 로그
- 공지, 문의와 답변, 게시물·댓글·신고·제재
- IP·캐릭터·상품·재고·카탈로그 신청
- 보관 상품, 교환 글·제안·결정
- 주문, 결제 이벤트와 원장, 쿠폰, 포인트 원장, 재고 예약
- 추첨권, 확률표 버전, 추첨 풀, 확정 결과
- 알림, 사용자별 알림 수신 설정과 변경 불가 동의 이력, 미디어 메타데이터, transactional outbox

상품 카테고리는 주문 스냅샷, 추첨권, 확률표와 보관 자산의 의미를 결정하므로 생성 후 변경하지 않는다. 다른 카테고리로 운영해야 하면 새 상품/SKU를 등록한다. 경품 전용 SKU 여부도 생성 후 변경하지 않는다. 경품 전용 SKU는 공개 판매 카탈로그·찜·직접 주문과 카탈로그 신청의 정규 대상에서는 제외하지만, 확률표·추첨 결과·보관함·배송·교환에서는 실제 상품 식별자로 유지한다.

운영 worker의 Redis/BullMQ 의존은 제거됐다. API의 `REDIS_URL`은 로컬 호환용 선택 설정일 뿐 Cloud Run 배포에는 주입하지 않으며, 인스턴스 내부 coarse rate-limit 앞단의 실제 client-IP abuse 방어는 별도 edge/WAF 출시 조건으로 남는다. 주문·결제·포인트·재고·추첨 결과는 계속 PostgreSQL 원장이며, 미발행 outbox와 공급자 원장을 기준으로 재처리하거나 조정한다.

### 주문과 결제

1. API가 클라이언트 금액을 신뢰하지 않고 DB 상품가, 쿠폰, 포인트를 다시 계산한다.
2. `Idempotency-Key`와 요청 해시를 저장하고 재고·포인트·쿠폰을 한 트랜잭션에서 예약한다.
3. 결제사는 서명된 webhook을 호출한다. API는 공급자 이벤트 ID를 중복 제거한 뒤 결제·주문·재고·원장을 함께 변경한다.
4. 불확실하거나 이미 소비된 자산이 얽힌 환불은 자동 확정하지 않고 `REFUND_REVIEW`로 보낸다.
5. 현재 특정 PG 어댑터와 실제 승인 요청은 연결되지 않았다. `PAYMENT_PROVIDER=UNCONFIGURED` 상태에서는 API가 주문 생성부터 503으로 닫아 재고 예약이나 가짜 결제 대기 주문을 만들지 않는다.

### 가챠와 쿠지

결제 완료가 일회성 추첨권을 만든다. API는 추첨권과 활성 확률표 버전을 잠그고, 서버 난수로 한 항목을 선택하고, 한정 수량을 차감하고, 보관 상품과 변경 불가 결과를 같은 트랜잭션에 기록한다. 클라이언트의 슬라이더와 영상은 이미 커밋된 결과를 보여주는 표현 계층일 뿐이다.

확률표 초안에는 추첨 상품과 동일 IP에 속한 활성 경품 전용 SKU만 넣을 수 있다. 공개 시점의 경품 SKU·상품명·이미지·IP·카테고리를 pool entry에 스냅샷으로 고정하므로 이후 카탈로그 문구가 바뀌어도 공개 확률표와 확정 결과는 바뀌지 않는다. 오래된 초안은 더 최신 버전이 생긴 뒤 공개할 수 없으며, 유한 풀은 `기본 가중치 × 현재 남은 수량`을 서버가 계산한다. 현 schema에는 물리 prize lot 원장이 없으므로 운영자는 새 버전 수량이 이전 버전이나 다른 초안의 재고와 겹치지 않는지 입고·검수 원장으로 대조해야 한다.

인증 사용자는 cursor pagination이 있는 계정 API로 기본 `AVAILABLE` 추첨권을 다시 조회할 수 있다. 고객 API adapter는 로그인 snapshot에 이를 포함하고, 고객 화면은 `orderId + productId`로 묶어 현재 가챠/쿠지 카탈로그와 probability version을 확인한 뒤 이어 뽑기를 시작한다. 로컬 unit/runtime와 390×844 브라우저 회귀는 통과했지만 실제 PostgreSQL·PG·실기기 재개 증거는 별도다.

### 교환과 사용자 콘텐츠

교환 글과 제안은 인증된 사용자 ID와 실제 보관 상품을 사용한다. 글 작성자만 제안을 수락하거나 거절할 수 있고, 하나가 수락되면 경쟁 제안을 함께 닫는다. 양측 완료 확인 또는 증거를 확인한 운영자의 강제 완료에서만 잠긴 두 보관 상품의 소유권이 원자적으로 바뀌며, 이전 원장은 수정할 수 없다. 매칭 취소는 소유권을 유지한 채 예약 상태만 해제한다. 사용자 콘텐츠는 soft-delete/숨김/신고/제재 상태를 사용하며 운영 명령은 사유와 감사 로그를 남긴다. 신고는 대기와 검토 중 상태를 분리하고, 게시글·Snap·댓글·교환 글 신고의 경고·이용정지는 서버가 해당 작성자를 다시 확인한 뒤 적용한다.

### 미디어

목표 경계는 private Supabase Storage bucket이다. 앱은 API가 소유자와 object path, MIME, 크기, 만료 시간을 제한해 발급한 signed upload 권한만 사용한다. Worker는 업로드 파일 검증, EXIF 위치정보 제거, 압축, thumbnail, 유해 콘텐츠 검사와 삭제 재시도를 담당하며 PostgreSQL에는 object 경로와 checksum, 크기, 치수, 처리/삭제 상태만 저장한다.

아래 GCS 절차는 이미 구현된 보안·멱등성·검증 규칙을 잃지 않기 위한 전환 전 기준이다. Supabase Storage adapter는 이 규칙과 동등한 실패/재시도/소유권 증거를 갖춘 뒤 교체한다.

사용자 업로드는 비공개 GCS staging object에 2분짜리 V4 multipart POST policy를 사용한다. 정책은 object key, `Content-Type`, SHA-256·media ID 메타데이터, 선언한 정확한 파일 크기를 서명 조건으로 고정한다. GCS form POST policy는 create-only generation precondition을 제공하지 않으므로 만료 전 동일 key·동일 조건 업로드 재전송 자체는 막지 못한다. 따라서 API는 intent/complete별 `Idempotency-Key`와 요청 해시를 PostgreSQL에 영속 저장하고, 동일 key·동일 요청은 같은 결과를 재생하며 payload가 달라지면 충돌로 닫는다. 만료된 signed intent도 같은 key에는 원래 계약이 재생되므로 새 업로드 intent를 만들 때는 새 key를 사용한다. 고객 adapter는 로컬 만료 또는 서버의 complete `410 MEDIA_UPLOAD_INTENT_EXPIRED`를 받으면 해당 action key와 stage를 폐기해 intent/storage/complete를 같은 key로 다시 호출하지 않고, 게시물·문의 작성 화면만 새 key를 만든다. API는 intent/complete별 IP rate limit, 사용자별 활성 업로드 최대 10건·합계 30 MiB, 최근 24시간 최대 50건·200 MiB, 누적 READY 최대 500건·512 MiB의 durable transaction advisory quota, 사용자·API instance별 동시 decode 2건 상한을 함께 적용한다. 최종 WebP 크기는 READY 전환 transaction에서 다시 한도를 확인한다. 5분이 지난 미완료 intent는 `REJECTED`로 전환하고 staging object 삭제를 시도하며 이후 complete는 410으로 새 intent 생성을 요구한다. 완료 API는 staging generation·메타데이터·크기·SHA-256·magic byte·선언 MIME을 다시 확인하고, 16 MP/8192 px 입력 상한에서 실제 디코드한 뒤 EXIF orientation을 적용한다. 결과는 메타데이터를 보존하지 않은 최대 4096 px WebP로 재인코딩하며 원본을 복사하지 않는다. 원본 staging object 삭제가 성공한 뒤에만 최종 generation, 최종 checksum·byte size·width·height를 DB에 기록하고 `READY`로 공개한다. 인증 사용자는 콘텐츠에 연결되지 않은 자기 미디어만 idempotent하게 `DELETED`로 전환할 수 있다. 존재하지 않거나 다른 사용자의 미디어는 동일한 404로 숨기고, 게시물·문의·카탈로그 요청 등에 연결된 미디어는 409로 거부한다. API는 객체 삭제를 즉시 시도하고 outbox를 남긴다. Cloud Scheduler가 유한 worker Job을 호출할 때마다 만료/중단/실패/삭제 record를 찾아 staging과 추적된 미완성 final object를 재삭제하고, READY 전환 후에도 정책 재전송 창이 닫힌 시점에 staging key를 한 번 더 삭제한다. 무료 구간 우선 기본 15분 일정에서는 정리가 최대 한 주기 지연될 수 있다. 공개 URL은 공개 상태 게시물에 연결된 READY 미디어에만 발급한다. 배포 시 staging lifecycle, Cloud Billing budget/request alerts, WAF rate control과 계정 생성 abuse 방어를 반드시 추가한다. 실제 버킷 CORS/IAM 검증, 유해 콘텐츠 검사와 CDN 연결은 공급자·정책 확정 후 남아 있다.

### 배송과 알림 수신 설정

인증 사용자의 배송 신청 목록·상세 API는 소유권 범위에서 상태/version, 마스킹된 수령 정보, 출고 시각과 송장 정보를 반환한다. 고객 API adapter, 로그인 snapshot, 배송 이력/상세 화면과 신청 성공 후 목록 재조회까지 연결되어 로컬 회귀를 통과했다. `CANCELLED` 신청만 남은 보관 상품은 다시 신청 가능 상태로 복구하되 다른 활성 신청이 있거나 `DELIVERED`인 상품은 신청 대상에서 계속 제외한다. 실제 물류 원장과 실기기 검증은 남아 있다.

알림 수신 설정은 신규 사용자 생성과 기존 사용자 backfill에서 기본 행을 만들며, 필수 거래 알림 `orderUpdates`는 항상 `true`다. 나머지 7개 선택 항목은 `expectedVersion`, 사용자 scope idempotency, 요청 해시로 갱신하고 변경 전후를 append-only consent event와 outbox에 같은 트랜잭션으로 기록한다. worker는 인앱 알림을 먼저 idempotent하게 기록하고 교환·신청·재입고·마케팅·맞춤 추천의 선택 해제를 외부 전달에만 적용한다. remote 고객 화면은 snapshot/GET, version PUT과 409 뒤 최신 GET 재동기화를 연결해 로컬 회귀를 통과했지만 APNs/FCM 공급자는 구성되지 않았다.

## 인증, 권한, 감사

- 역할은 `USER`, `ADMIN`, `SUPER_ADMIN`으로 분리한다.
- 사용자 세션과 관리자 세션은 종류가 다르며, API가 모든 요청에서 상태와 권한을 다시 확인한다.
- 고객은 저장된 session을 서버에서 검증하고 만료 전에 refresh한다. 401 또는 실제 만료는 session을 폐기하지만 일시적인 network/5xx 실패는 남은 만료 시간 안에서 다시 시도하며, stale generation 응답이 새 session을 덮어쓰지 못하게 한다.
- 탈퇴 승인 시 남아 있는 세션을 다시 폐기하고 이후 사용자 API 접근과 개발용 재로그인을 차단한다. 모든 고객 변경 요청의 `idempotency_keys` 삽입과 관리자 승인은 같은 사용자별 PostgreSQL advisory lock을 사용하므로 승인 직전·직후에 새 주문이나 콘텐츠 변경이 끼어들 수 없다.
- 세션 원문은 발급 시 한 번만 반환하고 DB에는 pepper 기반 digest만 저장한다.
- 관리자 브라우저는 API token을 JavaScript 저장소에 두지 않는다. Next.js same-origin 로그인 route가 `HttpOnly`, `Secure`, `SameSite=Strict` 쿠키에 넣고 서버 측 요청에만 사용한다.
- 메뉴 숨김은 편의 기능일 뿐 권한 검사가 아니다. API의 role/permission 검사가 최종 권한 경계다.
- 관리자 생성과 역할 변경은 `SUPER_ADMIN` 전용이다. 다른 운영 기능은 `admin_role_permissions`의 세부 permission으로 제한한다.
- 관리자 상태 변경, 공지, 문의 답변, 콘텐츠 제재, 카탈로그 변경, 확률표 공개는 대상·사유·요청 ID·변경 전후를 감사 로그에 남긴다. IP와 브라우저 정보는 내부 BFF 요청값이 아니라 로그인 때 서명 검증해 관리자 세션에 고정한 클라이언트 identity를 사용한다.
- 감사 로그 테이블과 결제/추첨 원장의 update/delete 차단은 DB trigger로 방어한다. 운영 계정에 trigger를 우회할 수 있는 DB 소유자 권한을 주면 이 방어가 무효화되므로 애플리케이션 계정은 최소 권한으로 분리해야 한다.

## 관리자 운영 범위

별도 `apps/admin`에는 다음 화면이 있다.

- 대시보드
- 회원 상세와 상태 관리
- 탈퇴 요청 목록·상세·승인/반려. 승인 직전 거래·보관·포인트·배송·교환 차단 항목을 서버에서 다시 계산하고 사용자 변경을 직렬화하며 세션을 폐기한다. 실제 삭제·익명화는 수행하지 않음
- 관리자 생성·역할·상태 관리
- 공지 작성·수정·게시
- 문의 목록·상세·운영 답변
- 게시물·댓글 숨김/복원
- 신고 대기→검토 중 선점, 처리와 사용자·작성물 단위 신고 맥락 조회
- IP·캐릭터·상품·재고 관리
- 카탈로그 신청 보류·거절·병합과 활성 정규 IP/상품에 대한 승인
- 교환 매칭 상태 조회와 증빙 기반 운영 완료/취소
- 가챠·쿠지 확률표 초안 작성·버전 조회·공개
- 주문·결제 상태와 원장 조회
- 실제 PG 실행과 분리된 환불 검토·사유 기록
- append-only 재고 조정과 유한 추첨 수용량 검증
- 최소 개인정보 목록과 별도 권한 상세를 사용하는 배송 상태·송장 전이
- 감사 로그 조회

관리자 앱은 DB package를 import하지 않는다. 모든 조회와 변경은 `/v1/admin/*` API를 통하며, 검색/필터/cursor pagination과 사유가 있는 mutation을 사용한다.

## 비동기 작업과 장애 복구

API는 업무 상태와 outbox event를 같은 PostgreSQL 트랜잭션에 기록한다. 유한 worker는 `FOR UPDATE SKIP LOCKED`로 event를 가져와 같은 DB client/transaction에서 logged pgmq queue에 넣고 `published_at`을 기록한다. consumer는 양수 visibility timeout으로 읽고 성공 시 삭제하며, 실패는 지수 backoff 뒤 재노출하고 상한을 넘으면 `worker_dead_letters`에 원자적으로 격리한다. `published_at`은 queue가 작업을 받은 시점이지 외부 부수 효과가 끝난 시점이 아니다.

현재 worker가 수행하는 작업은 다음과 같다. 작업 handler는 보존하고 전달 adapter만 transactional outbox → Supabase Queues 소비 구조로 바꾼다.

- 미결제 재고 예약 만료와 포인트·쿠폰 보상
- 오래된 결제의 조정 대상 탐지. 현재 provider adapter는 상태를 임의 변경하지 않고 수동 검토로 남김
- idempotent 인앱 알림 생성. 개발/테스트용 HTTPS adapter는 사용자 수신 설정을 존중하지만, 운영은 receiver가 동일 key·동일 payload 재전송을 영속적으로 중복 제거하고 감사 가능한 전달 receipt를 제공하기 전까지 설정 단계에서 차단
- 오래된 pending/rejected/deleted 미디어와 READY 전환 후 남은 staging 객체 정리. 연결된 READY 최종 객체는 자동 삭제 대상이 아님
- API/DB 결과에서 생긴 outbox event 처리

재시도 횟수와 지수 backoff가 있지만 dead-letter 운영 절차, 공급자별 결제 조회 어댑터, 실제 push provider 계약은 배포 전에 확정해야 한다.

## 배포 토폴로지와 보안 경계

목표 배포 단위는 Expo iOS/Android 앱, 선택적 고객 웹, 관리자 웹, API, worker, Supabase PostgreSQL/Queues/private Storage와 승인한 CDN이다. Redis와 별도 검색엔진은 측정된 필요가 생기기 전 기본 구성에 넣지 않는다. 이 저장소에는 실제 Supabase/스토어/PG 계정, DNS, TLS, 네트워크, WAF, 비밀 관리자, 에러 추적 또는 배포 IaC가 포함돼 있지 않다.

- 고객/관리자/API는 서로 다른 HTTPS hostname을 사용하고 CORS는 정확한 origin allowlist만 허용한다.
- 관리자 앱과 worker는 DB public access를 요구하지 않는 private network에 둔다.
- API는 `dabboba_runtime`/`DATABASE_URL`, worker는 `dabboba_worker`/`WORKER_DATABASE_URL`, migration은 schema owner/`DATABASE_MIGRATION_URL`을 사용한다. worker만 pgmq와 dead-letter insert 권한을 가지며 세 credential은 별도 secret으로 관리한다.
- API의 일반 `trustProxy`는 꺼져 있다. 배포 경계를 확정하지 않은 채 forwarding header를 신뢰하지 않는다. 운영에서는 정확한 신뢰 proxy CIDR/hop과 edge header 제거·덮어쓰기를 구성하거나 edge/WAF가 실제 client IP별 일반 API rate-limit을 담당해야 하며, IP 분리·429·header spoofing 통합 증거가 없으면 출시하지 않는다. 관리자 로그인만 신뢰 edge가 덮어쓴 전용 client-IP header를 Next BFF가 HMAC 서명하고 API가 검증하며, 이후 감사 로그는 그 로그인 세션 identity를 사용한다. 운영 배포에서 edge overwrite와 BFF/API secret 일치 여부를 반드시 확인한다.
- GCS는 public bucket으로 열지 않고 짧은 업로드 권한과 CDN 변형만 노출한다.
- 결제 webhook은 현재 설정된 외부 공급자와 경로가 정확히 일치한 뒤 공급자 서명 검증과 이벤트 ID 중복 제거를 모두 통과해야 한다. 서버 전용 `INTERNAL_ZERO` 결제와 `UNCONFIGURED` 환경은 webhook을 받지 않는다.
- 로그는 인증 header, cookie, password, token을 redaction한다. 로그 수집 시스템에서도 payload와 개인정보 필드를 다시 제한한다.

## 현재 완료 경계와 출시 차단 항목

| 항목 | 저장소 상태 | 출시 판단 |
| --- | --- | --- |
| Workspace/계약/DB/API/worker/admin 골격 | 구현됨 | 통합 검증과 배포 환경 검증 필요 |
| 관리자 화면과 API RBAC | 구현됨 | 실제 운영 계정, 부정 권한 테스트, MFA 정책 필요 |
| PostgreSQL 마이그레이션 | 구현됨 | disposable PostgreSQL CI와 운영/복원 환경 검증 필요 |
| 관리자·교환 PostgreSQL 통합 테스트 | 구현됨 | CI 또는 로컬 disposable DB 실행 증거 필요 |
| 계정 탈퇴 검토 | 차단 항목 재계산·사용자 변경 직렬화·승인 후 세션/재로그인 차단·감사/outbox 구현 | 보존 기간·익명화 범위·재가입 정책 승인과 실제 완료 배치 전 자동 삭제 불가 |
| 주문·재고·포인트·추첨 원장 | 구현됨 | 실제 PG sandbox와 장애·환불 통합 테스트 필요 |
| 고객 production 로그인 | 카카오·네이버·한국 휴대폰 OTP → Supabase Auth → Fastify 검증 → DABBOBA session 교환 구현 | 실제 provider 계정·redirect·SMS 연동, development build와 실기기 통합 검증 전 출시 불가 |
| 결제 공급자 | generic webhook 경계만 존재 | PG 선정·승인 API·서명 규격·조정 adapter 전 실결제 불가 |
| 일반 API 실제 IP rate-limit | `trustProxy: false` fail-closed, ingress 전략 미확정 | 신뢰 proxy 또는 edge/WAF 설정과 spoofing·IP 분리 통합 증거 전 출시 불가 |
| 미디어 | durable intent/complete idempotency·만료 410·미연결 소유 미디어 삭제·exact-size V4 POST policy·사용자 쿼터·generation/checksum/MIME 검증·decode 제한·orientation/EXIF 제거·WebP 재인코딩·worker 정리 경계 구현 | 실제 GCS CORS/IAM/삭제, 유해 콘텐츠 검사·CDN과 권리 자산 검증 필요 |
| 배송 이력·추첨권 복원 | 소유권 기반 배송 목록/상세·송장, 취소 재신청 복구·배송 완료 중복 방지, `AVAILABLE` 추첨권 조회, 고객 이력/상품별 이어 뽑기 UI와 로컬 회귀 구현 | 실제 물류·PostgreSQL/PG 새로고침 및 실기기 검증 필요 |
| 알림 | 인앱, 영속 수신 설정·append-only 동의 이력·외부 선택 전달 차단, remote 조회/버전 저장/409 재동기화 구현. 개발/테스트 HTTP adapter만 허용하고 운영 설정은 fail-closed | 동일 key·동일 payload 중복 제거와 감사 가능한 receipt를 보장하는 APNs/FCM 또는 공급자 계약, 실기기 검증 필요 |
| 고객 웹 API 전환 | 점진적 전환 중 | fixture/local 상태가 남은 화면은 운영 데이터로 간주 불가 |
| Expo 고객 앱 | Router·네이티브 탭·API 홈 카탈로그·SQLite cache·SecureStore token 경계 구현, 나머지 화면은 이전 중 | iOS/Android bundle, development build와 실제 iPhone/Android 전체 흐름 검증 필요 |
| Supabase 전환 | 목표와 단계·보안 경계 문서화 | project/Auth/Storage/Queues 설정, Drizzle module 전환, 실제 provider 통합 검증 필요 |
| 백업/PITR/모니터링 | 운영 요구만 문서화 | 공급자 설정과 복구 훈련 증거 전 출시 불가 |
| 법무/IP/스토어 | 저장소 밖 수동 작업 | 승인 완료 전 공개·상업 배포 불가 |

운영 절차는 `docs/dabboba-operations-runbook.md`, 사용자가 직접 준비해야 하는 항목은 `docs/dabboba-user-actions.md`를 따른다.
