# DABBOBA 출시 준비 — 무료 단계 진행표

작성일: 2026-09-06. 대상은 `/Users/kyoungmin/Desktop/DBB/dabboba-app`이다. 유료 전환과 운영자 계정·계약·실기기 확인은 마지막 단계로 분리한다. Supabase PostgreSQL/Auth, 기존 고객 데이터와 확정된 네이티브 UI를 보존한다. 이전 기록은 [2026-09-05 연결 점검](backend-connection-checkpoint-2026-09-05.md)에 남긴다.

**판정: 유료 전환·운영자 설정을 제외하고 지금 진행할 수 있는 1~7단계의 구현·로컬 검증을 마무리했다. 운영 배포나 출시 완료가 아니다.** 아래 표의 운영 증거는 실제 출시 전에 별도로 충족해야 한다. 보류한 인증 개편, 실제 PG사 선택, 비용 승인이나 운영 데이터를 임의로 대신 결정하지 않았다.

## 1~7 단계와 남은 경계

| 단계 | 현재 코드·로컬 증거 | 아직 필요한 운영 증거 |
| --- | --- | --- |
| 1. API 배포 준비 | Node 24 multi-stage 이미지, customer/admin 분리, PORT/0.0.0.0, health/readiness, 종료 시 DB 연결 정리. 후보 무트래픽 배포→검증→별도 트래픽 승격 가드. 전용 GCP 프로젝트 ACTIVE를 읽기 전용으로 재확인 | Billing 미연결. API 활성화·IAM·Secret Manager·실제 Cloud Run 배포·공개 URL 검증은 실행하지 않음 |
| 2. 작업 처리 | pgmq 1.5.1, transactional outbox, 45초 작업 시작 창, 중복 실행 잠금·재시도·dead letter·예약 만료. 미디어 잔여 최종 파일의 영속 목록과 주기적 재삭제. Worker 59개 테스트 skip 0 | 제한 Worker 역할 로그인/secret, 실제 한 번 실행, 비용 승인 후 Scheduler. 현재 1분 Job 주기는 무료 운영이 아님 |
| 3. 기존 로그인 | Kakao/Naver/휴대폰 선택과 Supabase 인증 검증 구조 유지. 미설정 공급자는 실패 처리. 운영 개발 로그인 차단 | 실제 공급자 설정·동의 항목·SMS 수신·네이티브 로그인 복귀. 보류한 Google/필수 휴대폰 인증/계정 연결 개편은 적용하지 않음 |
| 4. 주문·결제·복구 | 서버 가격·포인트·재고·동시성·idempotency·한 번만 소비되는 추첨권. 구매 내역의 남은 뽑기, 판매 중지/원래 버전의 쿠지 번호 복구 | PG사 선택·계약, 공식 결제창 SDK·웹훅 어댑터·조회/취소/환불 실제 검증. 현재 UNCONFIGURED이며 외부 결제가 필요한 요청은 성공시키지 않음 |
| 5. 상품·미디어 | 카탈로그·확률 버전·재고·소유권 보존. Supabase Storage 어댑터와 API/Worker·웹/네이티브 PUT 소비자 구현. 실제 로컬 Storage v1.73.0에서 업로드·SHA·정제·UUID 고정 읽기·만료·삭제·경쟁 복구 검증. 공급자별 배포 인자·API 후보/Worker 실제 설정 비교·secret 버전 지문 로컬 검사 통과 | 승인된 실제 상품·확률·라이선스 이미지. 운영 private 버킷·정책·CORS·서버 전용 키, 기존 GCS 파일 이관, hosted/CDN·실기기 업로드와 별도 authenticated hosted-media smoke는 미완료 |
| 6. 백업·관측·비용 | 암호화 v2 dump+pgmq 묶음, 빈 로컬 DB 복원·오류 롤백·동시 쓰기 격리. 민감정보 없는 DB 상태 집계, 비용 조회/배포 안전장치 | 관리형 Supabase 전체 복구·권한 재설정·Storage 파일, 자동 오프사이트 백업·보관 정책·운영 알림 수신/대응, 유료 PITR |
| 7. 통합·모바일 검증 | 로컬 역할별 실제 DB/API/Worker 테스트, 타입·웹 빌드·런타임 무결성. 쿠지 만료·남은 번호 복구와 실제 네이티브 가챠 checkout→부분 오픈→재시작→남은 권리→SQLite 의도 정리, 중복 주문·차감 없음 확인 | 실물 iPhone/Android, 서명 배포본, 실제 결제·문자·알림·네트워크 장애와 스토어 심사. 브라우저/Expo Go를 이 증거로 대체하지 않음 |

## 재실행 가능한 로컬 통합 검증

공유 테스트 DB에 동시에 여러 스위트를 실행하지 않는다. 아래 명령은 이름이 고정된 기존 disposable 컨테이너의 **현재 루프백 포트**를 확인하고 테스트 전용 owner/runtime/worker 연결만 사용한다. 앱 `.env`를 읽거나 migration·seed·원격 배포를 실행하지 않는다. 중지된 컨테이너, 잘못된 포트, 테스트 0개 또는 skip 발생은 성공으로 보고하지 않는다.

```sh
node scripts/verify-local-backend.mjs --container dabboba-backend-integration-20260905
corepack pnpm run test:unit
corepack pnpm --filter @dabboba/mobile typecheck
corepack pnpm run check:runtime
corepack pnpm run workspace:assert
corepack pnpm run build
git diff --check
```

이번 Storage 변경 후 통합 재실행 증거: DB **69**, API **167**, Worker **59** 테스트, 모두 실패/skip 0. 계약 **18**, Storage 패키지 **15**, 웹/네이티브 업로드 소비자 **21** 테스트도 실패/skip 0이다. 이후 QA 고정 주문 조회 5개를 포함한 최신 루트 실행은 **493개**, 실패/skip 0이었다 (`/tmp/dabboba-backend-final-unit-20260906.log`; 이전 488개 결과를 대체). 소비자 21개는 루트 테스트에 포함된 별도 집중 실행이며 합산하지 않는다. 전체 주문 완료 증명, 화면 경로 왕복 중 지연 응답 차단과 영속 잔여 파일 정리를 포함한다. 최종 모바일 타입 검사, runtime 보호 파일 **28개**, workspace **15개** 경로와 최신 웹 빌드도 통과했다.

근거 로그는 `/tmp/dabboba-storage-{backend-final,unit-final,contract-final,package-final,consumers,mobile-types,runtime,workspace,web-final}-20260906.log`이다. 새 계약 테스트는 POST/PUT 전송 협상과 양식 오인 방지를 포함한다. 최신 웹 빌드에도 500kB 초과 chunk 경고가 남아 있으며 네이티브 성능 측정이 아니다. 별도 config 15/domain 3/API client 4 테스트는 앞선 시점의 보존 증거다.

최종 관리자 웹 `corepack pnpm --filter @dabboba/admin typecheck`와 `test`도 **18개**, 실패/skip 0으로 통과했다. 실제 관리자 로그인·외부 배포·브라우저 전체 조작을 증명하지 않는다. 루트/관리자 Node 검사에는 기존 typeless-package 경고가 남아 있으며 이를 없애기 위해 무관한 패키지 모듈 형식을 변경하지 않았다. 프로젝트 조회 가드 **24개**와 DB 읽기 전용 상태 검사 **7개**도 각각 `/tmp/dabboba-backend-final-project-guards-20260906.log`, `/tmp/dabboba-backend-final-health-20260906.log`에서 실패 0으로 재확인했다.

## Supabase Storage — 구현된 로컬 범위

신규 [서버 전용 어댑터](../packages/media-storage/README.md)를 연결한 API/Worker는 기본 공급자와 무관하게 각 미디어 행에 기록된 공급자·버킷·버전을 사용한다. 기존 GCS 행을 Supabase로 잘못 해석하지 않고, 필요한 원래 공급자 설정이 없으면 읽기/정리를 성공으로 처리하지 않는다. 기존 파일 이관이나 운영 버킷 생성은 수행하지 않았다.

- 업로드: 최대 120초의 정확한 키·MIME·Content-Length·미디어 ID·SHA 메타데이터를 서명한 raw PUT을 사용한다. 기존 GCS POST도 유지하며 호환 소비자만 새 PUT을 받는다. 같은 길이의 잘못된 바이트는 공급자가 받아들일 수 있으므로 API가 실제 바이트의 SHA·크기·MIME를 검증한 뒤 정제한다. native upload-sign의 TTL, S3 POST 길이 범위, S3 If-Match를 동등한 보장으로 가정하지 않는다.
- 최종 파일: 처리 claim마다 서로 다른 서버 전용 키를 쓰고, 정제된 실제 바이트의 SHA·크기·MIME와 UUID 버전을 고정해 읽어 확인한다. 최종 파일 쓰기 전에 `storageCleanup.pendingFinalObjectKeys`에 키를 기록하며 READY에서는 승리한 키만 목록에서 제거한다. 뒤늦은 패배 claim이 승리 파일을 덮어쓰지 못한다.
- 재삭제: Worker는 해당 미디어 ID에 속한 올바른 최종 키만 대상으로 하며 READY의 현재 파일은 제외한다. 목록은 삭제 성공 후에도 보존하고 최소 5분 간격으로 재확인하여 늦게 다시 쓰인 파일도 정리한다. 기존 처리·거부·임시 업로드 보관 기간, 행 잠금·실행 기한·공급자 미설정 시 skipped 동작을 유지한다. 메타데이터 갱신 때문에 기존 보관 기간이 계속 연장되지 않도록 보호한다.
- 캐시 한계: 최종 객체의 저장 메타데이터는 `no-store`지만 실제 v1.73.0 signed download 응답에는 **토큰 만료와 같은 Expires만 있고 Cache-Control: no-store는 없었다**. 이미 내려받은 응답의 즉시 회수, hosted CDN 만료·캐시 무효화까지 입증한 것이 아니다.

[격리된 실제 Storage fixture](../scripts/storage-conformance/README.md)는 공식 v1.73.0 이미지, 전용 로컬 PostgreSQL·네트워크와 file backend를 사용했다. 별도 어댑터 실연결에서 SigV4 PUT·변조 거부·UUID 고정 읽기·실제 바이트 검증·반복 삭제를 확인했다. 인증 API를 거친 **7개 테스트**도 모두 통과했다. 외부 사용자 접근 거부, idempotent intent, 동시 완료, 내용 해시 위조, 만료, 소유자 삭제, A claim 지연→B claim 완료→A 재개 시 승리 파일 보존과 패배 키의 영속 추적을 포함한다. 근거는 `/tmp/dabboba-storage-adapter-final-20260906.log`와 `/tmp/dabboba-storage-api-final-20260906.log`이다.

fixture가 실행 중일 때만 아래 로컬 검증을 재실행한다. `52269`는 당시 전용 루프백 gateway 포트이며 재실행 전 실제 출력 포트를 확인한다. 공유 앱 DB 통합 검사와 동시에 실행하지 않는다. 이 검증은 운영 자격 증명·TLS·cloud S3 backend·hosted CDN·실기기 전송·운영 준비 완료의 증거가 아니다.

```sh
corepack pnpm --filter @dabboba/media-storage test
node packages/media-storage/scripts/local-conformance.mjs http://127.0.0.1:52269
node scripts/verify-local-storage.mjs --storage-url http://127.0.0.1:52269
```

## 보존된 브라우저 증거와 이미지·배포 설정 검증

브라우저 런타임은 최종 기본 명령 `corepack pnpm run test:runtime`으로 **9개 통과**했다. 기본 4186의 전용 루프백 fixture 서버를 소유하고, 기존 서버를 재사용하지 않으며, 포트가 점유되어 있으면 실패한다. 필요 시 `MOBILE_RUNTIME_TEST_PORT=4191`처럼 유효한 비특권 포트를 명시한다. 최초 4174 실행에서 두 검사가 실패했는데 embed 상품 누락은 기존 실 API 연결 서버를 잘못 재사용한 환경 혼선으로 확인됐다. 다른 최초 Carousel `scrollLeft=0` 실패 원인은 미확정이며, 최종 통과만으로 Carousel 결함까지 고쳤다고 주장하지 않는다. 보호 런타임/UI를 수정하거나 테스트 기준을 완화하지 않았다.

Storage 배포 연결 전 `ops/cloud-run/check-artifacts.sh`의 과거 결과는 build guard 8개, 후보 릴리스 41개, release attestation 44개였으며 프로젝트 읽기 전용 가드 24개도 통과했다. 최신 Storage 통합 후 결과는 아래에 별도로 기록한다. 이 검사는 GCP 리소스를 생성하지 않는다.

이번 변경 전의 `api-runtime` 이미지 `dabboba-api:backend-local-20260906` 빌드·smoke 증거를 보존한다. SHA-256은 `e22b7c60de11b67f67cf64a8476bdee69f3fa946d12d7db1ff086f456c6de977`, 크기 92,344,522 bytes이다. 로컬 production/customer 컨테이너를 CPU 1·512MiB·기본 entrypoint·비root `node`로 실행해 기존 제한 Supabase 연결을 **읽기 전용으로만** 확인했다. healthz/readyz/상품 6개/home-sections 200, 비로그인 계정 401, 관리자 두 경로와 개발 로그인 404, SIGTERM 종료 0/OOM 없음. 짧은 읽기 smoke에서 47.41MiB가 관측됐으나 부하·콜드스타트·운영 성능 증거는 아니다. `.env`/TS/source map/테스트/migration·seed·권한 부여 도구는 이미지 검사에서 0개였다. 새 smoke 컨테이너만 제거했고 기존 컨테이너/이미지는 보존했다.

새 Storage 코드의 `dabboba-api:storage-local-20260906`도 빌드 exit 0으로 완료했다. 기록된 이미지 ID는 `sha256:2740c9f2b2747abd616e953c84cd0983a46e91eadd29b531053f8b0bfe15fa4b`, 크기는 **92,790,012 bytes**이다. [오프라인 이미지 검사기](../scripts/verify-local-storage-image.mjs)는 `/app`의 **2,841개 파일**, 비root `node`·기본 CMD·production 환경 메타데이터, `.env`/TS/source map/테스트/migration·권한 부여 도구 제외, production 공급자 설정·오프라인 SigV4, local HTTP/누락 secret 거부, GCS 기본값으로 돌아갈 때의 보조 Supabase 설정 보존을 검사해 exit 0으로 종료했다. 초기 검사 fixture의 빈 `WEB_ORIGINS`가 기존 production fallback 금지 조건에 걸렸고, 공개 fixture HTTPS origin을 넣어 검사 입력만 바로잡았다. 앱 production 설정을 완화하지 않았다.

이 새 검사는 **network none**, host 파일·환경 마운트 없음, read-only 파일시스템, capability 제거 조건에서 기본 entrypoint를 Node 검사 코드로 바꿔 실행했다. 따라서 실제 API 서버 기동·DB/TLS·health/readiness·hosted Storage 검증은 아니며, 위 `backend-local`의 실제 읽기 smoke와 구분한다. 근거 로그는 `/tmp/dabboba-storage-image-direct-20260906.log`와 `/tmp/dabboba-storage-image-probe-20260906.log`이다. 별도 검토에서 발견한 태그 변경 경쟁 조건은 해결했다. 검사기가 조회한 `sha256` ID의 형식을 검증하고 그 정확한 ID를 `--pull=never`로 실행하도록 바꾼 뒤 재실행도 exit 0, 같은 이미지 ID·2,841개 파일로 확인했다.

최종적으로 같은 `storage-local` 이미지 ID를 기본 `docker-entrypoint.sh` / `node dist/index.js`로 실행하는 [로컬 컨테이너 검사기](../scripts/verify-local-api-container.mjs)도 추가했다. 두 모드를 root에서 각각 실제 실행했다.

- 기본 production 모드: 승인된 Supabase hostname만 허용하는 기존 가드가 고정 로컬 DB 주소를 거부하여 API 프로세스 exit 1, OOM false, DB 연결 0이었다. 검사 도구의 exit 0은 **예상한 차단 확인**이며 production health 성공이 아니다. hostname/TLS 제한은 수정하지 않았다.
- 명시적 `--local-test-db`: 같은 이미지·기본 CMD의 `NODE_ENV=test` / customer surface로만 기존 로컬 `dabboba_integration`에 연결했다. 비root PID 1, CPU 1 / 512MiB, read-only 파일시스템, capability 없음, mount 없음. healthz/readyz/home-sections/products GET 200, 비로그인 profile 401, admin/products 404와 상품 응답 구조를 확인했다. 개발 로그인 POST나 외부 공급자 요청은 보내지 않았다.
- 마지막 root 실행에서 SIGTERM 후 **246ms**, exit 0 / OOM false, 해당 실행의 runtime DB 연결 0, **38개 migration·schema 지문 불변**이었다. GET-only 읽기 작업을 수행한 증거이지 PostgreSQL 세션 자체의 read-only 강제나 부하 테스트 증거는 아니다. 잘못된 CLI 입력 3개도 Docker 접근 전에 거부했다.
- 도구가 만든 임시 컨테이너만 제거했으며 기존 DB·이미지·API/Metro와 모바일 clone은 보존했다. 최종 QA API readiness도 200이었다. 최신 이미지의 실제 production/Supabase TLS 기동은 운영 적용 전 별도 검증으로 남는다.

```sh
# 고정 disposable 컨테이너와 127.0.0.1:53168 바인딩이 존재할 때만 실행한다.
node scripts/verify-local-api-container.mjs --image sha256:2740c9f2b2747abd616e953c84cd0983a46e91eadd29b531053f8b0bfe15fa4b
node scripts/verify-local-api-container.mjs --image sha256:2740c9f2b2747abd616e953c84cd0983a46e91eadd29b531053f8b0bfe15fa4b --local-test-db
```

Worker 이미지 `dabboba-worker:storage-local-20260906`도 빌드 exit 0으로 완료했다. ID는 `sha256:3044d6b5a2a8d392c2e39c040dff7a2de297fc05ec74c28866c47419a5e204b6`, 크기는 **82,755,020 bytes**이다. 같은 검사기의 Worker 분기로 **1,537개 파일**, 기본 실행·비root·금지 파일, production Worker 45초/visibility 900초 설정, 저장소 정리 모듈 import, 오프라인 서명/오류 거부를 검사해 exit 0이었다. 이 실행 역시 네트워크가 차단되어 실제 큐 처리나 hosted Storage 작업을 수행한 것이 아니다.

GCS 중심 Cloud Run 스크립트는 Supabase API/Worker 환경과 서로 분리된 Secret Manager 숫자 버전 참조를 전달하도록 연결했다. 기존 GCS·Supabase-only·병행·기본값 복귀, raw secret/잘못된 endpoint/줄바꿈 삽입 거부, 실제 Worker Job의 정확한 env/secret 비교, 설정 변경 시 기존 실행 확인값 무효화를 포함한다. API도 배포 인자와 후보 검사에 동일한 전체 plain/secret 맵을 사용한다. 중앙 후보 게이트는 공식 v1/v2 Revision에서 이미지·실행 계정·고객 전용 환경·정확한 secret ID/숫자 버전을 비교하며, 같은 프로젝트 별칭만 정규화하고 중복/추가/다른 프로젝트/평문 secret/실행 덮어쓰기를 거부한다. 실제 배포·smoke·승격 스크립트는 이 검사 실패 시 진행하지 않는다.

최종 `bash ops/cloud-run/check-artifacts.sh`에서 build **8**, API 후보 **44**, release **45**, Storage **11**, API Revision **8** 테스트와 업로드 context 검사가 통과했다 (`/tmp/dabboba-backend-final-cloudrun-20260906.log`). 외부 변경 없이 로컬 stub 계약만 실행했다. authenticated hosted-media smoke는 별도 운영 항목이며 이 결과를 운영 적용 완료로 표시하지 않는다. 동시 운영자에 의한 후보 태그 A→B→A 변경을 포괄적으로 방지하는 control-plane 잠금은 제공하지 않으므로 배포·검증·승격 중 병행 배포/태그 변경을 금지해야 한다.

앞선 `backend-local` smoke의 Runtime DB는 TLS 연결, SUPERUSER/CREATEDB/CREATEROLE/INHERIT/REPLICATION/public 스키마 CREATE 없음으로 확인했다. BYPASSRLS는 기존 **서버 전용** 정책대로 유지되며 API 인증·인가가 고객 행 접근을 통제한다. 최초 smoke 검사기의 `BYPASSRLS=false` 가정이 문서화된 정책과 달라 검사만 바로잡았고 DB 역할은 바꾸지 않았다. 이 smoke에는 비어 있는 CORS 허용 목록을 썼으므로 운영 웹 origin 설정은 검증한 것이 아니다.

## 네이티브 복구 확인 범위

`DABBOBA SDK54` iOS 26.5 시뮬레이터와 Metro 8084 → 별도 API 8879 → `dabboba_restore_drill_mobile_20260906` clone만 사용했다. 기존 API 8788, 실제 Supabase 데이터, 다른 프로젝트의 시뮬레이터는 수정하지 않았다. 테스트 상품 두 개와 포인트로 발행한 `INTERNAL_ZERO` 주문 두 개를 사용했으며 외부 PG 결제가 아니다.

- 쿠지: 지난 5분 draw lease의 미선택 주문 → 구매한 2장만 선택 → 01번을 오른쪽 드래그로 오픈 → 02번은 미개봉으로 준비 → 앱 종료/재실행 → 구매 내역에서 02번만 복구 → 버튼 오픈과 서버 결과 확인. 번호를 재추첨하거나 재결제하지 않았다.
- 가챠: 2장 중 이미 사용한 한 장이 있는 주문 → 남은 한 장만 복구 → SKIP → 서버 확정 결과 → 상단 복귀로 상품 화면. 원래 주문은 두 개 그대로이며 DB 읽기 확인에서 각 상품의 권리/결과가 각각 2개이고 남은 AVAILABLE은 0개였다. 재실행한 구매 내역에서도 완료된 두 복구 카드는 사라졌다.
- 원래 두 fixture 주문에는 앱 checkout의 SQLite 구매 의도가 없어 별도로 실제 네이티브 checkout에서 수량 2 / 포인트 2,000 / 최종 0원 주문을 만들었다. 첫 결과 후 앱 종료·재실행 → 남은 1개만 복구 → 최종 결과 복귀까지 확인했다. SQLite 의도는 마지막 결과 표시 중에는 유지되고 복귀 후 1→0으로 정리됐다. 주문은 총 3건, 새 주문의 권리/결과 2개, SPEND 1건 / -2,000, 잔액 2,000이며 원래 주문들은 그대로다. [전체 경로·관측 한계·보존 이미지](backend-checkout-lifecycle-2026-09-06.md)에 상세 증거를 기록했다.
- 테스트 상품 이미지는 의도적으로 등록하지 않아 이미지 placeholder를 확인했다. 실제 Storage 업로드/상품 이미지 전달 검증으로 간주하지 않는다. 확인 이미지들은 Git 제외 `work/qa/backend-recovery-20260906/`에 보존했다.
- 초기 구매 내역 딥링크의 헤더가 존재하지 않는 이전 화면으로 이동하려던 문제도 수정했다. 히스토리가 있으면 기존 뒤로 가기, 없으면 프로필 탭으로 복귀하며 UI는 유지한다. 실제 앱 종료→구매 내역 직접 실행→헤더 복귀에서 프로필과 보관 상품 4개를 확인했다.

`node scripts/serve-mobile-qa.mjs --container dabboba-backend-integration-20260905 --approve-clone-fixtures`는 기존 clone을 초기화하지 않는다. 다시 실행할 때 서버 준비와 원래 미완료 fixture 상태를 `fixtureBaselineReady`로 구분하며, 이미 소비한 권리를 되돌리지 않는다. 완료 후 실제 재실행에서도 서버 준비 성공, `fixtureBaselineReady: false`, 기존 두 주문 각각 CONSUMED 2개와 쿠지 remaining 0이 유지됐다.

이후 추가 네이티브 주문이 있는 경우도 보존하도록 QA fixture 조회를 고정 CREATE_ORDER idempotency 리소스 기준으로 바꿨다. 집중 테스트 5개와 문법 검사, 현재 clone의 주문 2개/고정 키를 사용한 read-only helper 검사에서 원래 fixture만 선택했다. 이 변경 후 서버 재시작은 아직 실행하지 않았으며 앞 문단의 재시작은 추가 주문 이전 증거다.

## 데이터 보존·복구 증거

- [백업 도구와 훈련](database-backup-restore.md): 원본과 복원 DB의 public·pgmq 84개 테이블, 38개 migration, 제약 469개와 CHECK 재파싱 196개를 비교했다. 메시지·아카이브·시퀀스·RLS와 동시 스냅샷 일관성 및 복원 후반 오류 전체 롤백을 확인했다. 테스트 clone에만 fixture를 만들었다.
- [읽기 전용 상태 집계](db-health-snapshot.md): 19개 count/age 지표, 7개 테스트 통과. 큐 visibility/읽기 횟수를 바꾸지 않으며 권한 부족/테이블 누락을 0건으로 숨기지 않는다. 통합 DB에 남은 비정상 수치는 고의적인 음수 테스트 fixture이므로 운영 사고 수치가 아니다.
- 최종 문서·후보 게이트 변경 후 값 비출력 검사는 Git에 보이는 8MiB 이하 텍스트 **704개**와 선택된 실제 비공개 값 **2개**를 비교해 `matchingFiles: 0`, `privateKeyHeaders: 0`이었다 (이전 697개 스냅샷 이후 재실행). 공개된 개발용 `SESSION_TOKEN_PEPPER` 기본값은 비공개 값 집합과 별도로 분류했다. 이를 운영에 재사용하면 안 되며 production 설정 검증은 이 개발값을 거부한다. 검사 시점·선택한 값·텍스트 파일 범위의 스냅샷이며 모든 가능한 비밀정보의 부재를 보장하는 검사는 아니다.

## 운영자 항목 — 유료 전환 직전에

1. DABBOBA 전용 프로젝트의 Billing 연결·과금 승인, API/Worker 실행 계정과 Secret Manager 참조 설정. 비밀값은 채팅·Git·보고서에 넣지 않는다.
2. PG사 계약과 카카오·네이버·문자·외부 알림 공급자 설정, 실기기 테스트 계정/수신 확인. 설정이 없는 것을 가짜 성공으로 처리하지 않는다.
3. 실제 판매 상품·재고·당첨 확률·라이선스 이미지 승인, 미디어/백업 보관·삭제·복구 정책과 담당자 결정.
4. 비용 수신자와 $1/$5 알림 설정 후 후보 배포를 검증하고 별도 승인으로 트래픽 전환. 일반 Billing Budget은 자동 비용 차단이 아니다.

[비용 추정](cloud-run-cost-estimate-2026-09-06.md)에서 유휴/API 소규모 베타/한도 초과를 구분했다. 특히 현재 **1분 간격 Worker Job은 CPU/RAM만 월 약 $54** 예상이므로 무료 단계에서 켜지 않는다. [Cloud Run 공식 요금](https://cloud.google.com/run/pricing)

현재 원격 회원·주문·결제·포인트·보관함 데이터를 수정하거나 Supabase 유료 전환, GCP 과금 리소스 생성, 실제 PG 거래, Git 커밋·푸시·PR을 수행하지 않았다. 로컬 훈련 DB/암호화 fixture는 보존되어 있다.
