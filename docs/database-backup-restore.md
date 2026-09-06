# 무료 단계의 암호화 백업·로컬 복원 훈련

작성일: 2026-09-06. 유료 기능이나 주기 실행을 활성화하지 않는 오프라인 운영 도구다.

## 제공 범위와 보안 경계

`ops/database/backup.mjs`는 PostgreSQL custom-format 논리 dump와 pgmq 보완 데이터를 **v2 snapshot bundle**로 묶어 AES-256-GCM으로 암호화한다. 일반 `pg_dump`가 생략하는 extension 소속 큐의 메타데이터·대기/보관 메시지·sequence도 보완 데이터에 포함한다. 큐 정보 없는 구형 archive는 거부한다.

매번 새 96-bit nonce를 사용하고 형식 식별자를 인증 데이터로 포함한다. 평문 dump/복원 SQL을 파일에 쓰거나 연결 문자열을 명령 인자·출력에 저장하지 않는다. 복원은 전체 인증과 bundle 검증 후에만 DB에 접근한다. 키는 **정확히 32바이트의 난수 파일**이며 비밀번호가 아니다. 키와 백업은 저장소 밖의 명시적인 절대 경로, 소유자 전용 파일(0600)과 디렉터리(0700)에 둔다. 같은 파일을 덮어쓰지 않는다.

- PostgreSQL 17 이상의 `psql`, `pg_dump`, `pg_restore`가 PATH에 있어야 한다. 실제 DB보다 오래된 dump 도구는 사용하지 않는다.
- 명령은 `.env`를 자동으로 읽지 않는다. 승인된 백업 전용 환경의 `DABBOBA_BACKUP_SOURCE_URL`만 읽는다. API/Worker 실행에는 이 URL이나 백업 키를 넣지 않는다.
- 원격 연결은 TLS 인증서·호스트 검증(`verify-full`)을 강제한다. Supabase 인증서에 맞는 신뢰 루트는 연결 설정의 `sslrootcert` 절대 경로로 제공한다. 인증서 오류를 `require`나 `disable`로 우회하지 않는다.
- source는 제한 시간이 있는 `REPEATABLE READ READ ONLY` transaction이다. 여기서 내보낸 **동일 MVCC snapshot**을 일반 dump와 큐 행/메타데이터 조회가 공유한다. 원본에 쓰거나 `ALTER EXTENSION`하지 않으며 실패해도 조회 세션을 종료한다. 연결 주소·자격 증명·원본 DB 오류를 채팅이나 로그에 복사하지 않는다.
- sequence 값은 PostgreSQL에서 MVCC 대상이 아니다. 큐 행 조회 뒤 읽은 **high-water mark**를 보관하고 다음 ID가 백업 메시지 ID와 충돌하지 않는지 검사한다. 원본 `nextval`은 호출하지 않는다. 동시 쓰기가 있으면 snapshot 행보다 sequence가 앞설 수 있으므로 모든 카운터가 같은 시점이라는 보장은 없다.
- pgmq는 검증된 **logged·비분할 기본 큐 구조**만 지원한다. 알 수 없는 테이블/열/기본값/인덱스, 사용자 큐 trigger·policy 등 지원 범위 밖 구조는 누락시키지 않고 실패한다. 복원 시 extension 집합과 실제 버전도 일치해야 한다. RLS/FORCE RLS 플래그는 보존한다.
- 복원은 루프백 주소의 **빈 `dabboba_restore_drill_*` DB**에만 가능하다. 실제 DB 이름과 사용자 객체 부재를 확인하므로 테이블 없이 함수만 있는 DB도 거부한다. `pg_restore --exit-on-error`로 SQL을 해석한 뒤 일반 dump와 큐 보완 SQL 전체를 `psql --single-transaction`과 `ON_ERROR_STOP=1`로 실행한다. `--clean`, `--create`, 자동 DB 삭제는 없다. dump 자체에는 SQL 코드가 포함되므로 알려진 신뢰할 수 있는 source만 복원한다.
- 암호화 전 bundle과 해독한 전체 복원 SQL은 각각 **256 MiB 상한**을 적용한다. 메모리에 여러 버퍼를 보관하므로 RAM 사용량 256 MiB를 보장하지 않으며 API 컨테이너 안에서 실행하지 않는다. 더 큰 데이터는 별도 검토한 도구로 전환한다. 이 한도는 운영 DB 크기나 복원 가능성의 보증이 아니다.
- `--no-owner --no-acl`이므로 DB별 소유권/GRANT를 자동 복원하지 않는다. 글로벌 역할·비밀번호·Secret Manager·OAuth 공급자 설정도 포함하지 않는다. 복원 후 별도 제한 역할 provisioning과 권한 검증을 완료하기 전 API에 연결하지 않는다.

## 명령

키·대상 경로는 운영자가 안전한 보관 위치와 복구 권한을 정한 뒤 마련한다. 아래 예시는 실제 비밀값이 아니며 자동으로 실행되지 않는다.

```sh
node ops/database/backup.mjs backup /secure/dabboba-backups/release.dbbenc /secure/separate-keys/backup-key
node ops/database/backup.mjs verify /secure/dabboba-backups/release.dbbenc /secure/separate-keys/backup-key
# DABBOBA_RESTORE_DRILL_URL은 별도 로컬 빈 DB만 가리켜야 한다.
DABBOBA_APPROVE_LOCAL_RESTORE=YES node ops/database/backup.mjs restore /secure/dabboba-backups/release.dbbenc /secure/separate-keys/backup-key
```

키는 백업과 **다른 보관 위치/장애 도메인**에 보관한다. 키를 잃으면 복원할 수 없다. 키 생성·회전·보존·접근 권한·오프사이트 위치는 운영 승인 사항이며 이 작업에서 임의로 정하거나 외부 서비스에 저장하지 않았다.

`verify`는 인증 태그와 v2 bundle 구조 확인일 뿐 실제 DB 복원이나 업무 무결성 검증은 아니다. `restore`의 성공도 권한·앱 동작·Supabase 전체 복구의 증거는 아니다.

## 이번에 실제로 검증한 내용

별도 disposable PostgreSQL 17/pgmq 1.5.1 컨테이너의 전용 clone에서 다음을 실행했다. 통합 스크립트는 **명시한 clone에 테스트 행/큐를 추가**하고 새 복원 대상 DB를 만든다. 아래 두 환경 변수 모두 필요하며 공유 `dabboba_integration` DB를 source로 허용하지 않는다. clone이 준비된 로컬 훈련 환경에서만 실행한다.

```sh
node --test tests/database-backup.test.mjs
DABBOBA_BACKUP_TEST_CONTAINER=dabboba-backend-integration-20260905 \
DABBOBA_BACKUP_TEST_SOURCE_DATABASE=dabboba_restore_drill_pgmq_source_20260906 \
node ops/database/test-backup.integration.mjs
```

- 단위/실행 경계 **8개 통과**: 암호화 왕복·nonce·변조/절단/잘못된 키, TLS·대상 제한, 경로/권한/심볼릭 링크, DB 호출 전 인증 실패, v2 형식·지원하지 않는 큐/sequence 거부, 큰 정수와 SQL처럼 보이는 메시지의 안전한 직렬화.
- 실제 복원: migration **38개**, `public`과 `pgmq`의 **전체 84개 테이블**에서 정렬된 행 해시/행 수 일치. 대기·보관 메시지, 읽기 횟수, visibility 시각, JSON 큰 정수, 빈 큐의 `is_called=false`와 sequence 속성/카운터/소속도 확인했다.
- **469개 제약조건**의 구조를 비교하고 **196개 CHECK**는 동일 PostgreSQL parser로 다시 해석해 비교했다. 단순 SQL 문자열 차이를 무결성 실패로 오인하지 않는다. trigger/함수 정의, 인덱스 정의·상태, RLS/FORCE RLS, policy, extension 이름/버전도 비교했다. 역할 GRANT/실제 접근 권한 검증을 대체하지 않는다.
- snapshot 확보 후 일반 행과 큐 메시지를 같은 transaction으로 commit하는 동시 쓰기 시험에서, 둘 다 복원 결과에 제외되는 것을 확인했다.
- 쓰기가 멈춘 백업 구간의 원본 행/sequence 불변, 비어 있지 않은 대상과 함수만 있는 대상 거부, 복원 후반부 오류 시 일반 schema와 extension까지 전체 rollback을 확인했다.
- 최종 작은 fixture 실행 약 **2.5초**. 운영 RTO나 대용량 성능 수치가 아니다.

훈련 DB와 암호화 fixture는 자동 삭제하지 않는다. 스크립트는 정확한 훈련 DB명과 테스트 파일 경로만 출력한다. fixture 키가 archive와 같은 임시 폴더에 있는 것은 **실제 고객 데이터가 전혀 없는 테스트에만** 허용한 구성이다.

## 아직 완료가 아닌 항목

실제 Supabase 데이터나 원격 DB로 백업·복원을 검증한 적은 없다. Supabase 관리 schema/extension/Auth 설정을 포함한 전체 플랫폼 복구는 공식 운영 절차로 별도 검증해야 한다. ACL/소유권·글로벌 역할 비밀번호·Storage의 실제 이미지 객체는 이 훈련의 복원 보장 범위가 아니다. 기존 미디어 provider 변경, 자동/예약/오프사이트 백업, PITR, 복구 담당자, RPO/RTO/보존 기간, 정기 훈련과 알림도 완료하지 않았다.

공식 참고: [Supabase 백업 범위](https://supabase.com/docs/guides/platform/backups), [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html), [snapshot 공유](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION), [sequence 동작](https://www.postgresql.org/docs/17/functions-sequence.html).
