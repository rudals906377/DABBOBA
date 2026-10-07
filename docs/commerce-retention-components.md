# 거래정보 보관 종료: 로컬 준비와 운영 경계

이 기능은 **배송 주소 스냅샷과 종결된 문의 내용의 제한된 파기**를 준비한다. 전체 거래 기록·법정 보존 종료·분리보관·외부 사본 삭제가 완료됐다는 뜻은 아니다. 정책이나 운영 근거를 migration에서 승인하지 않으며, 기본 설정은 `DISABLED`다.

현재 운영 상태(2026-10-07): 관련 마이그레이션은 운영 DB에 적용됐고, 배송 주소 60개월·문의 36개월 정책을 승인했다(읽기 전용 미리보기 대상 0건). 검토(`review`) 단계, 실행(EXECUTE), 워커 Cron은 아직 하지 않았다.

## 구현된 범위

| 대상 | 처리 | 보존하거나 차단하는 내용 |
| --- | --- | --- |
| `SHIPPING_ADDRESS` | `DELIVERED` 또는 `CANCELLED` 배송의 `address_snapshot`을 `{"retentionDisposed":true}`로 교체하고 version을 증가 | 배송/주문/회원 ID, 상태, 금액, 경품 스냅샷, 배송일과 추적번호, 불변 배송 이벤트 보존 |
| `INQUIRY_CONTENT` | `CLOSED`이며 closed_at이 있는 문의의 제목과 모든 메시지를 파기 표기로 교체 | 문의/메시지/작성자 ID, 분류, 내부 메시지 표시와 상태 보존. 첨부 링크가 있거나 메시지가 50개를 넘으면 전체 문의 차단 |
| 정책·분쟁·처리 증거 | 서버 전용 RLS 테이블, 승인된 정책 및 검토·파기 증거는 append-only | 공개/API 역할과 worker의 직접 테이블 쓰기 금지. worker에는 두 제한 함수의 실행 권한만 추가 |

원장에 연결 가능한 기록 ID는 개인정보 관점의 검토 대상이다. 새 파기 원장은 주소·전화번호·문의 내용을 복사하지 않지만, 익명 데이터라고 표현하지 않는다. 예전 배송 화면은 파기된 주소 필드를 빈 값으로 보여주며, 문의는 파기 표기를 보여준다.

## 승인 근거와 자동 대상 산출

운영자는 과거 기록을 하나씩 등록하지 않는다. 두 종류마다 버전 있는 정책을 등록하고, 전체 분쟁 목록과 해당 내용의 다른 사본을 검토한 근거를 남기면 함수가 실제 원본 데이터에서 대상을 산출한다.

`commerce_retention_policies`의 필수 입력은 record_kind, policy_version, retention_months, evidence_reference다. 승인에는 실제 ACTIVE ADMIN/SUPER_ADMIN의 approved_by_admin_id와 approved_at이 필요하다. 초안에는 승인 시각/승인자를 넣지 않는다. 승인 후 정책 내용은 수정할 수 없고, 기존 정책을 retired_at·retired_by_admin_id·retirement_evidence_reference로 한 번만 종료한 뒤 새 버전을 승인해야 한다. 원 승인자가 비활성화되어도 원 승인 이력은 수정하지 않으며, 다른 현재 ACTIVE 관리자가 별도 종료 근거를 남겨 종료할 수 있다. 종료를 취소하거나 새 정책에서 옛 검토를 재사용할 수 없다. 같은 종류에는 승인된 현재 정책이 하나만 존재할 수 있다. 이 DB 역할 확인은 사업자의 실제 법률·권한 검토를 대신하지 않는다.

기산일 규칙은 `LATEST_RELEVANT_ACTIVITY`이며, 정책 승인 시 그 보수적인 해석을 함께 승인해야 한다. 배송은 요청·수정·배송·배송 상태 이벤트와 연결된 배송비/경품 원주문의 주문·결제·환급·원장 시각 중 가장 늦은 시각을 쓴다. 문의는 생성·수정·종결·마지막 메시지 중 가장 늦은 시각을 쓴다. 문의 분쟁이 종결됐다는 별도 근거가 없거나 관련 분쟁이 열려 있으면 hold를 유지한다. 광고의 기산일이나 외부 사업자 계약 내용을 추정하지 않는다.

최소 60개월(배송 주소)과 36개월(문의)은 저장소에 이미 공개된 privacy의 5년/3년 약속보다 짧게 처리하지 않기 위한 하한이다. 법률 적합성 판정이나 자동 승인된 실제 정책이 아니다. 달력의 월 간격을 사용하며 기간은 최대 120개월이다. 승인 전 법정 기간, 실제 기산일, 보존/파기 대상 필드와 예외를 사업자가 확인해야 한다.

`commerce_retention_reviews`에는 현재 policy_id, reviewed_by_admin_id, hold_registry_reviewed_at, external_copies_reviewed_at, external_copies_status와 evidence_reference를 기록한다. 외부 사본 상태는 기본 `UNVERIFIED`다. `CLEARED`는 이 두 내용의 다른 DB 스냅샷·응답/감사 로그·Storage·PG/택배/지원 위탁·복제본·백업 등 실제 범위의 검토 근거가 있을 때만 기록한다. 어떤 사본이 남거나 처리 여부를 모르며 파기 범위에 영향이 있으면 `UNVERIFIED`를 유지한다. 단순 접속 성공이나 빈 registry 조회는 전체 분쟁/사본 검토 근거가 아니다.

두 검토 시각은 24시간 이내여야 하며, 항상 최신 검토 한 건만 사용한다. 검토를 갱신하려면 새 행을 추가한다. 이전 성공 검토 뒤 최신 검토가 미확인으로 바뀌면 과거 성공을 재사용하지 않는다. 정책 승인 전 만들어진 검토, 비활성 승인자/검토자, 미래 검토 시각은 사용할 수 없다.

## 분쟁 보류와 실행 조건

`commerce_retention_holds`는 ALL(전체), USER(회원), RECORD(종류+기록 ID) 범위를 지원한다. 생성 시 기본적으로 보류 상태이며, 명시적인 released_at/released_by_admin_id 기록이 있어야 해제된다. 범위를 수정하거나 해제를 재작성/되돌리는 것은 금지한다. 새 분쟁은 새 hold로 기록한다. 정해진 시간이 지났다고 보류를 해제하지 않는다.

다음 조건 중 하나라도 있으면 내용을 파기하지 않는다.

- 승인 정책 없음 또는 승인자 비활성.
- 최신 분쟁 검토 또는 사본 검토 누락·만료·미확인.
- 전체/회원/기록 hold 존재.
- 서비스 진행 중, 보관기한 미도래.
- 같은 회원의 열린 commerce review, 미결제·불확실 결제·환급 검토, 아직 해소되지 않은 worker 결제 대사 기록. 대사 기록은 `RECONCILED`로 끝났거나, 이후 결제가 확인된 PAID/REFUNDED 상태(더 새로운 결제 버전)가 됐거나, 마지막 시도 뒤 관리자가 그 결제의 commerce review를 닫았으면 더 이상 막지 않는다(0083). 공급자 확인 없이 취소된 결제의 UNKNOWN·MANUAL_REVIEW 기록은 계속 막는다.
- 문의 첨부 미디어 또는 메시지 50개 초과.

처리 가능한 기록을 먼저 선정하므로 오래된 hold 기록이 후순위의 승인된 기록을 막지 않는다. 미리보기/실행 반환은 한 번에 최대 100개다. 실행은 serializable 트랜잭션에서 전역 겹침 잠금, 원본 및 문의 메시지 잠금, 잠금 뒤 재검사를 수행한다. registry 쓰기도 같은 잠금을 사용한다. 0083부터 worker는 이 잠금을 트랜잭션 snapshot이 생기기 **전에** session 단위로 잡고 커밋 뒤 푼다. 그래서 실행 직전에 커밋된 hold·정책 종료·commerce review도 실행이 본다. 잠금을 얻지 못하면 그 회차를 건너뛴다. 같은 0083에서 후보 목록은 한 번만 평가하고, 잠근 기록은 그 기록 하나만 다시 평가한다. 배송 요청의 주문 조회는 배송비 주문과 배송 품목의 주문을 각각 인덱스로 찾는다. 동시 수정/교착/serialization 오류는 전체 묶음을 롤백하고 다음 승인된 실행에서 다시 확인한다. registry 변경과 실행이 동시에 들어오면 잠금을 얻은 순서로 처리되므로, 새 보류 사유를 알게 된 운영자는 실행을 정지하고 보류 등록 완료 후 재개해야 한다.

각 기록의 내용 교체와 `commerce_retention_disposals` 삽입은 같은 트랜잭션이다. 증거 기록 실패 시 내용 변경도 롤백한다. 같은 내용이 다시 처리되지 않으며, 문의가 나중에 실제로 재개돼 새 내용이 생기면 새로운 최종 활동 시각부터 다시 판단한다. 묶음은 최대 100개, 문의 하나는 최대 50개 메시지다. worker는 잠금 대기 2초/문장 5초 제한을 걸고 실행 완료 후에만 건수/차단 코드 로그를 남긴다. 큰 운영 데이터의 처리 속도·부하와 자연 스케줄 실행은 아직 검증하지 않았다.

## 실행 및 등록 절차

공유 worker job은 `commerce.retention.sweep`이고 설정 타입은 `CommerceRetentionConfig`다. 핵심 함수는 `runCommerceRetentionBatch(pool, config, logger, shouldContinue)`다. 환경 값은 `WORKER_COMMERCE_RETENTION_MODE`(DISABLED/PREVIEW/EXECUTE, 기본 DISABLED)와 `WORKER_COMMERCE_RETENTION_BATCH_SIZE`(1–100, 기본 25)다. PREVIEW/EXECUTE일 때만 일반 retention 뒤에 일곱 번째 job으로 추가되며 기본 여섯 작업 구성은 유지된다.

1. 별도 승인된 운영 변경에서 0082·0083 migration을 적용하고 제한 역할/권한을 검증한다. 0083은 함수 정의만 바꾸며 데이터를 수정하지 않는다. 새 내부 평가 함수는 소유자 전용이고 worker에는 기존 두 함수만 열려 있다.
2. 사업자가 필드 범위·기산일·보존기간·분쟁/사본 절차를 결정한다. 권한 있는 비공개 운영 세션에서 정책을 초안 등록한 뒤 승인한다. secrets나 실제 고객 내용을 Git/이 문서/공개 로그에 넣지 않는다.
3. 실제 분쟁 목록을 먼저 registry에 반영한다. 전체/회원/기록 hold를 적용하고, 해제 근거가 있으면 승인된 release를 기록한다.
4. 현재 정책을 참조하는 검토 행에 전체 hold 목록과 해당 내용의 다른 사본 검토 근거를 기록한다. 미확인 내용이 있으면 기본 UNVERIFIED 상태를 유지한다.
5. PREVIEW로 한 묶음의 처리 가능 수와 차단 원인을 확인한다. PREVIEW는 `BEGIN READ ONLY`에서 SELECT만 수행하며 정책·검토·hold·파기 증거를 기록하지 않는다. 기록 ID가 필요한 운영 확인은 제한 함수 결과를 비공개 세션에서 확인한다.
6. 검토자가 대상 범위와 미리보기 결과를 승인한 별도 실행에서만 EXECUTE를 선택한다. 환경의 EXECUTE만으로는 승인된 정책·24시간 검토·hold 등 DB 조건을 우회할 수 없다. 코드가 여는 transaction-local 플래그 및 serializable 상태가 없으면 DB 실행 함수도 거부한다.
7. 건수, 정책/검토/hold, 파기 증거, 원장·예외 상태를 확인하고 기본 DISABLED로 돌린다. 경보/스케줄/비용 변경과 지속 실행은 별도 승인 및 직접 증거가 필요하다.

### 출시용 승인 스크립트 (2026-10-07)

결정된 기간(배송 주소 60개월, 문의 36개월, 질문지 B7)은 `ops/database/commerce-retention-approval.sql`에 들어 있다. 운영자는 비공개 세션에서 마이그레이션 소유자 URL로 단계별로 실행한다. 이 스크립트는 파기를 실행하지 않는다.

```text
# 1) 정책 등록과 승인(ACTIVE ADMIN 또는 SUPER_ADMIN의 users.id, 비공개 근거 코드)
psql "$DATABASE_MIGRATION_URL" -v step=approve -v admin_id=<관리자 id> -v evidence=<근거 코드> -f ops/database/commerce-retention-approval.sql
# 2) 분쟁 목록을 holds에 반영한 뒤, 실행 직전 24시간 안에 검토 행 추가
psql "$DATABASE_MIGRATION_URL" -v step=review -v admin_id=<검토자 id> -v evidence=<근거 코드> -v holds_reviewed=yes -v copies_status=UNVERIFIED -f ops/database/commerce-retention-approval.sql
# 3) 읽기 전용 미리보기(종류별 처리 가능·차단 건수)
psql "$DATABASE_MIGRATION_URL" -v step=preview -f ops/database/commerce-retention-approval.sql
```

- `copies_status=CLEARED`는 외부 사본 검토 근거가 실제로 있을 때만 쓴다. `UNVERIFIED`이면 미리보기와 실행 모두 `EXTERNAL_COPIES_UNVERIFIED`로 막힌다.
- 승인은 다시 실행해도 같은 결과다. 다른 버전의 승인 정책이 이미 현재 정책이면 멈춘다.
- 2026-10-07 판 행이 이미 있으면(미승인 초안) 기간이 60/36개월과 다르거나 근거 코드가 이번 실행과 다를 때 아무것도 승인하지 않고 멈춘다. 초안을 확인한 뒤 같은 근거 코드로 다시 실행한다.
- 인자가 빠지거나 `step` 값이 틀리면 SQL 오류로 끝나 psql이 0이 아닌 종료 코드를 낸다. 종료 코드 0만 성공으로 본다.
- `review`는 현재 승인 정책이 정확히 2026-10-07 판 60/36개월 두 행일 때만 그 두 행에 검토 기록을 남긴다. 승인 전이거나 다른 버전이 현재 정책이면 아무것도 남기지 않고 멈춘다. 검토자도 ACTIVE 관리자여야 한다.
- 실행은 별도 검토 후 Edge 워커 설정 `WORKER_COMMERCE_RETENTION_MODE=EXECUTE`(필요하면 `WORKER_COMMERCE_RETENTION_BATCH_SIZE`)로 한 번 돌리고 설정을 지운다. 2026-10-07부터 Edge 워커가 이 두 값을 전달한다. 설정하지 않으면 계속 `DISABLED`다.
- Edge 워커는 1분마다 Cron으로 호출되므로, 설정이 `EXECUTE`여도 Cron 호출은 `PREVIEW`로만 돈다. 실제 파기 한 배치는 운영자가 워커 호출 비밀값으로 본문 `{"source":"operator","commerceRetention":"EXECUTE"}`을 담아 `dabboba-worker`를 한 번 POST할 때만 돈다. 이 호출은 다른 워커 작업 없이 파기 배치만 실행하고 `{"ok":true,"commerceRetention":{"mode":"EXECUTE","disposed":N}}`를 돌려준다. 설정이 `EXECUTE`가 아니면 409로 거절한다. 실패 응답(`COMMERCE_RETENTION_OUTCOME_UNKNOWN`)이나 응답 없음은 결과를 알 수 없다는 뜻이다(DB가 커밋한 뒤 확인 응답만 끊겼을 수 있다). 다시 호출하기 전에 반드시 `commerce_retention_disposals`에서 이번 호출의 파기 기록이 있는지 확인한다. 끝나면 설정을 지운다.
- 2026-10-07 운영 DB에서 `approve` 단계를 실행했다(오너 승인, ACTIVE 관리자 1명이 승인자). 두 정책이 현재 승인 정책이고 읽기 전용 미리보기 대상은 0건이다. `review` 단계는 분쟁 목록을 holds에 넣은 뒤 실행 직전에 따로 한다.
- 2026-10-07 로컬 disposable DB에서 단계별 동작을 확인했다: 인자 누락·비관리자·잘못된 사본 상태 거부, 승인 재실행, 검토 전 `HOLD_REVIEW_REQUIRED`, 검토 후 `EXTERNAL_COPIES_UNVERIFIED`, 파기 0건. 같은 날 추가 확인: 누락·오타 인자는 종료 코드 3, 120개월 초안이나 다른 근거 코드의 초안이 있으면 승인 없이 종료 코드 3, 같은 근거 코드의 60/36개월 초안은 승인.

예를 들어 운영 등록은 다음 매개변수 계약을 따른다. 실제 실행을 승인하거나 값/근거를 만들어주는 예시는 아니다.

```sql
-- $1 kind, $2 reviewed policy version, $3 months, $4 private evidence code
INSERT INTO public.commerce_retention_policies
  (record_kind,policy_version,retention_months,evidence_reference)
VALUES($1,$2,$3,$4)
RETURNING id;

-- $1 draft policy id, $2 actually authorized active administrator
UPDATE public.commerce_retention_policies
SET approved_at=now(),approved_by_admin_id=$2
WHERE id=$1 AND approved_at IS NULL;

-- $1 approved policy, $2 currently active retirement administrator, $3 evidence
UPDATE public.commerce_retention_policies
SET retired_at=now(),retired_by_admin_id=$2,retirement_evidence_reference=$3
WHERE id=$1 AND retired_at IS NULL;

-- $1 policy id, $2 authorized reviewer, $3 private reviewed-scope evidence
-- Add hold/copy timestamps and CLEARED only after actual checks are complete.
INSERT INTO public.commerce_retention_reviews
  (policy_id,reviewed_by_admin_id,evidence_reference)
VALUES($1,$2,$3);

SELECT record_kind,record_id,eligible_at,blocker
FROM public.preview_commerce_retention(25);
```

## 남은 운영·정책 결정

계약/청약철회·대금/공급 원장, PG 이벤트 payload, 주문/회원/작성자 식별자, 배송 추적 원장, 정책 수락/관리자 감사 기록과 사본의 만료 처리·접근 분리는 아직 구현된 전체 파기 경로가 아니다. 불변 원장을 임의 수정하거나 DELETE 예외를 추가하지 않았다. 표시·광고 6개월 기록의 실제 저장 원천과 승인된 파기 정책도 아직 없다. 문의 미디어, 50개 초과 문의, 외부 위탁과 Storage·복제본·백업은 승인된 개별 절차와 직접 검증이 필요하다. `CLEARED` 검토 행은 해당 외부 처리의 실행 기능이 아니다.

전체 정책 종료 파기를 완료하려면 사업자가 위 대상의 법적/계약상 처리와 분리 접근, 외부 사본·복구 지연을 결정하고 추가 구현·검증을 승인해야 한다. 이 구성요소 기능의 성공으로 그 차이를 지우거나 PRELAUNCH를 해제하지 않는다.

## 직접 검증

2026-10-04, 부모가 검증한 `dabboba-launch-ci-20261002-55449`의 loopback disposable `dabboba_ci`, TEST tier, 실제 dabboba_worker 제한 역할을 사용했다. 합성 사용자/배송/문의/결제만 생성했고 검증 후 정확한 fixture ID로 정리했다. 실제 운영 DB/PG/메일/Storage 호출은 하지 않았다.

- 집중 22 pass / 0 fail / 0 skip: 기본 비활성, 설정 검증, read-only 미리보기, 제한 권한, 승인/짧은 기간/비관리자/최신 검토, 전체·회원·기록 hold, 진행 중/기간/미해결 결제/분쟁, 미디어/51개 메시지, 오래된 금융 원장 연결, hold 기록의 후순위 처리 방해 방지, 겹침 잠금, audit 실패 롤백, 실제 동시 수정의 40001 롤백, 묶음 한도·중복 방지.
- 처리 후 주문/결제/불변 금전 원장 전체 행이 byte-for-byte 동일하고, DELIVERED 배송의 추적번호와 불변 배송 이벤트가 그대로 남음을 확인했다.
- worker TypeScript 검사와 `git diff --check` 통과. 공유 worker job/config/runner 결합의 최종 검증은 부모 통합 결과를 따른다.
- source/migration 부재 시 실패를 먼저 재현했다. 확장 fixture의 text/varchar 매개변수 불일치는 시험 결함으로 수정한 뒤 같은 검사를 다시 통과했다.

최종 0082의 checksum은 `6e8a469117d42315d10a41c4e1247772a7907e398a784c4ff725d46c593b4631`이다. 위 22개 집중 검사는 최초 구성요소 검증이며, 이후 원 승인자가 비활성화된 경우 다른 ACTIVE 관리자가 증거를 남겨 정책을 한 번만 종료할 수 있도록 보완했다. 최종 스키마는 별도 disposable TEST DB에 적용했고 암호화 백업·복원에서 두 retirement 필드와 함수 정의가 일치했다. 새 회귀 검사와 공유 worker 결합의 최종 결과는 부모 통합 증거를 따른다. 최초 fixture 종료 조회에서 정책/hold/파기 증거/시험 사용자 모두 0이었다. 운영 파기·법률 검토·자동 스케줄·알림 수신을 검증한 것은 아니다.

2026-10-04 커밋 후 CI에서 기존 마지막 migration이 0081이고 0082가 비어 있음을 확인했다. 운영에 적용하지 않은 새 migration의 파일 번호를 0083에서 0082로 정정하여 실제 순서를 이어 붙였다. SQL 바이트·checksum·잠금 ID·처리 동작은 바꾸지 않았다. 이전 loopback 검증과 암호화 복원 보고서는 원래의 0083 파일 이름으로 남긴 과거 증거다. 이를 운영에 적용된 migration을 다시 쓰거나 이미 적용된 DB에서 같은 SQL을 재실행할 권한으로 해석하지 않는다. 번호 정정 후 CI의 새 disposable DB로 정상 순서를 검증한다.
