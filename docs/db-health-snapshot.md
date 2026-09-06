# DB 운영 상태 읽기 전용 스냅샷

[`health-snapshot.sql`](../ops/database/health-snapshot.sql)은 outbox, 작업 큐, 예약, 결제와 뽑기 원장의 상태를 **건수와 가장 오래된 항목의 경과 초**로만 반환한다. 응답 구조는 `schema_version: 1`, `metrics: {지표명: {count, oldest_age_seconds}}`이다. 빈 지표는 `count: 0`, `oldest_age_seconds: null`이다. 식별자·고객 정보·결제 금액·시크릿·오류 원문·메시지 내용은 출력하지 않는다.

## 실행과 권한

확인된 로컬 테스트 대상에서 실행하는 명령은 다음과 같다.

```sh
docker exec -i dabboba-backend-integration-20260905 \
  psql -X -U postgres -d dabboba_integration -qAt \
  -v ON_ERROR_STOP=1 -f - < ops/database/health-snapshot.sql
```

다른 연결에서 실행할 때도 SQL 파일을 독립된 연결의 작업으로 실행하고, `ON_ERROR_STOP=1`을 유지한다. 실행 대상과 읽기 권한은 별도로 확인한다. 이 문서 작성 과정에서는 실제 Supabase에 연결하지 않았다.

SQL은 `REPEATABLE READ READ ONLY` 트랜잭션 안에서 동작하며, 조회 제한 시간은 15초, 잠금 대기는 2초다. 운영 테이블의 변경·잠금 획득을 위한 조회·pgmq 함수 호출·작업 소비·삭제·재시도는 수행하지 않는다. PostgreSQL의 읽기 전용 트랜잭션이 금지하는 작업 범위는 [공식 SET TRANSACTION 문서](https://www.postgresql.org/docs/current/sql-set-transaction.html)를 따른다.

`SET LOCAL row_security=off`는 RLS를 우회하거나 테이블 설정을 바꾸지 않는다. 정책 때문에 일부 행만 보이는 역할이라면 오류를 발생시켜 일부 데이터의 집계를 전체 정상 수치로 오인하지 않게 한다. [PostgreSQL RLS 문서](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

모든 참조 테이블의 전체 읽기가 가능한 승인된 운영 역할이 필요하다. 기존 API/Worker 역할에는 필요한 전체 읽기 권한이 없을 수 있으며, 이 점검을 위해 역할의 권한을 넓히지 않는다. 테이블·열 누락, 권한 부족, RLS 필터링, 시간 초과는 실패다. 정상 JSON이 없거나 프로세스 종료 코드가 0이 아니면 **미확인**으로 처리한다. 실패를 모든 지표 0으로 바꾸지 않는다.

## 지표 해석

| 지표 | 건수 기준 | 경과 시간 기준 |
| --- | --- | --- |
| `outbox_pending` / `outbox_retry_pending` | 미발행 / 미발행 중 발행 시도 이력이 있는 이벤트 | 생성 시각 |
| `outbox_due` | 미발행이며 발행 가능 시각이 지난 이벤트 | 발행 가능 시각 |
| `queue_total` / `queue_visible` / `queue_not_visible` | 전체 / `vt <= now()` / `vt > now()` 큐 메시지 | 큐 등록 시각 |
| `queue_read_more_than_once` | 읽기 횟수가 1을 초과한 큐 메시지 | 큐 등록 시각 |
| `worker_dead_letters` | DABBOBA 작업 큐의 저장된 실패 기록 | 실패 시각 |
| `reservations_active` / `reservations_expired_active` | 활성 예약 / 활성인 채 만료 시각이 지난 예약 | 각각 생성 시각 / 만료 시각 |
| `payments_pending` / `payments_authorized` / `payments_refund_review` | 각 결제 상태에 속하는 결제 | 결제 `updated_at` |
| `payment_reconciliation_schedule_due` | 재확인 대상 상태이며 현재 결제 버전에 맞는 예약 시각이 지난 항목 | `next_attempt_at` |
| `payments_without_current_reconciliation_schedule` | 재확인 대상 상태이며 예약이 없거나 결제 버전이 바뀐 항목 | 결제 `updated_at` |
| `draw_consumed_without_result` | 사용 완료 권한에 대응하는 결과가 없음 | 사용 시각, 없으면 생성 시각 |
| `draw_results_without_consumed_entitlement` | 결과의 권한이 없거나 사용 완료 상태·사용 시각과 맞지 않음 | 결과 확정 시각 |
| `draw_result_identity_or_version_mismatch` | 결과와 권한의 사용자·상품, 확률 버전, 당첨 상품 관계 또는 버전 공개 상태가 맞지 않음 | 결과 확정 시각 |
| `draw_available_on_unpaid_order` | 사용 가능한 권한이 `PAID`/`FULFILLED`가 아닌 주문에 연결됨 | 권한 생성 시각 |

결제 재확인 대상 상태는 `PENDING`, `AUTHORIZED`, `REFUND_REVIEW`다. 예약 시각 지표에는 Worker의 별도 `staleMinutes` 설정을 적용하지 않았으므로 실제 Worker가 지금 처리해야 하는 정확한 배치 건수와 같다고 해석하지 않는다. 결제 경과 시간은 현재 상태에 진입한 시각이 아니라 마지막 수정 시각 기준이다.

보이지 않는 큐 항목은 지연 예약 또는 처리 중일 수 있다. 읽기 횟수가 높다고 실패가 확정된 것도 아니다. [pgmq 공식 문서](https://pgmq.github.io/pgmq/api/sql/functions/)에 따르면 `read`는 메시지의 visibility timeout을 변경하므로 점검 SQL에서는 호출하지 않는다. 로컬 pgmq 1.5.1의 `q_dabboba_worker`에서 `enqueued_at`, `vt`, `read_ct` 열을 확인했고 해당 메타데이터를 직접 집계한다. 확장 업그레이드 후에는 같은 읽기 검증을 다시 수행한다.

과거 dead letter에는 해결 완료 필드가 없으므로 총건수를 현재 미해결 장애 건수라고 단정하지 않는다. 지표 간에는 겹치는 항목이 있으며 합산해서 전체 문제 수로 쓰지 않는다. 뽑기 불일치 지표는 후속 확인 신호이며 전체 원장 감사나 모든 쿠지 슬롯 관계의 무결성을 증명하는 검사는 아니다. 이후 교환·배송으로 바뀔 수 있는 재고 소유자·상태는 최초 뽑기 결과와 단순 비교하지 않는다.

## 로컬 검증

```sh
node --test ops/database/test-health-snapshot.mjs

DABBOBA_HEALTH_TEST_CONTAINER=dabboba-backend-integration-20260905 \
  node --test ops/database/test-health-snapshot.mjs
```

첫 명령은 정적 계약 3개를 확인하고 DB 테스트 4개를 명시적으로 건너뛴다. 두 번째 명령은 지정한 로컬 컨테이너의 `dabboba_integration`만 읽으며, 다른 컨테이너명은 거부한다. SQL 실행 결과의 구조·지표 관계, 필수 테이블 누락 실패, API 역할의 접근 실패, 조회 전후 큐 노출 시각·읽기 횟수 보존을 확인한다. 큐 보존 검사는 다른 Worker가 작동하지 않는 로컬 테스트 DB에서 수행한다. 테스트는 `.env`를 읽거나 DB·테이블·역할·데이터를 만들고 바꾸지 않는다.

2026-09-06 로컬 실행에서 7개 테스트를 모두 통과했다. 그때의 전용 통합 테스트 기록은 미발행·발행 대기 outbox 444건, 환불 검토 결제 9건, 현재 버전 재확인 예약이 없는 결제 9건, 결과가 없는 사용 완료 권한 3건이었다. 이 숫자는 테스트 데이터에서 비정상 신호를 표시한 증거이며 운영 사고나 복구 완료를 뜻하지 않는다. 실제 운영 모니터링 주기·알림 기준·자동 복구와 Supabase 운영 실행은 별도로 검증해야 한다.

공식 문서 및 로컬 검증일: 2026-09-06.
