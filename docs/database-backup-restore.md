# 무료 단계의 암호화 백업·로컬 복원 훈련

작성일: 2026-09-06, 검증 갱신일: 2026-10-04, 운영 절차 보강: 2026-09-30. 유료 기능이나 주기 실행을 활성화하지 않는 오프라인 운영 도구다.

2026-10-04에는 fixture가 아닌 **실제 운영 snapshot**을 같은 버전의 격리된 로컬 Supabase PostgreSQL에 복원했다. 테이블 138개·migration 83개, 소유권/GRANT/column·default ACL, 구조와 사진 파일 102개의 검증을 통과했다. 아래의 과거 fixture/실패 기록을 이 새 결과와 혼동하지 않는다. 플랫폼 전체 복구·오프사이트·키 분리·정기화는 여전히 미완료다. 최신 범위와 증거는 [실제 운영 복원 결과](production-recovery-evidence-2026-10-04.md)에 있다.

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

## 2026-09-08 로컬 복원 훈련 기록

별도 disposable PostgreSQL 17/pgmq 1.5.1 컨테이너의 전용 clone에서 다음을 실행했다. 통합 스크립트는 **명시한 clone에 테스트 행/큐를 추가**하고 새 복원 대상 DB를 만든다. 아래 두 환경 변수 모두 필요하며 공유 `dabboba_integration` DB를 source로 허용하지 않는다. clone이 준비된 로컬 훈련 환경에서만 실행한다.

```sh
node --test tests/database-backup.test.mjs
DABBOBA_BACKUP_TEST_CONTAINER=dabboba-backend-integration-20260905 \
DABBOBA_BACKUP_TEST_SOURCE_DATABASE=dabboba_restore_drill_pgmq_source_20260908_dbb009 \
node ops/database/test-backup.integration.mjs
```

- 단위/실행 경계 **8개 통과**: 암호화 왕복·nonce·변조/절단/잘못된 키, TLS·대상 제한, 경로/권한/심볼릭 링크, DB 호출 전 인증 실패, v2 형식·지원하지 않는 큐/sequence 거부, 큰 정수와 SQL처럼 보이는 메시지의 안전한 직렬화.
- 실제 복원: migration **40개**, `public`과 `pgmq`의 **전체 84개 테이블**에서 정렬된 행 해시/행 수 일치. 대기·보관 메시지, 읽기 횟수, visibility 시각, JSON 큰 정수, 빈 큐의 `is_called=false`와 sequence 속성/카운터/소속도 확인했다.
- 복원본에서 `0038`의 JSONB 배송 상품 snapshot·NOT NULL·CHECK·불변 trigger를 직접 확인했다. snapshot 생성 뒤 카탈로그 이름·이미지·version을 바꾼 fixture에서도 신청 당시 값이 유지되고, 복원본의 snapshot UPDATE가 `55000`으로 거부됐다. `0039` 결과는 `developmentFixture` 상품과 IP가 삭제되지 않은 채 비활성이고 연결된 inventory·배송 이력이 남은 것으로 확인했다. 이어 rollback-only transaction에서 현재 `0039` source SQL을 복원 schema에 다시 실행해 활성 개발 fixture 상품과 상품이 없는 prototype IP가 모두 비활성화되는 것을 확인했다. 별도 PostgreSQL 통합 검증에서는 의무 없는 개발 판매 확률표의 `ACTIVE`→`RETIRED`, 완료된 draw 이력 보존, `AVAILABLE` 권리·일반 판매 확률표의 개발 경품 참조·후반 갱신 오류 시 전체 rollback을 확인했다. 두 migration의 version과 source SQL의 SHA-256 checksum도 복원본에서 직접 대조했다.
- **470개 제약조건**의 구조를 비교하고 **197개 CHECK**는 동일 PostgreSQL parser로 다시 해석해 비교했다. 단순 SQL 문자열 차이를 무결성 실패로 오인하지 않는다. trigger/함수 정의, 인덱스 정의·상태, RLS/FORCE RLS, policy, extension 이름/버전도 비교했다. 역할 GRANT/실제 접근 권한 검증을 대체하지 않는다.
- snapshot 확보 후 일반 행과 큐 메시지를 같은 transaction으로 commit하는 동시 쓰기 시험에서, 둘 다 복원 결과에 제외되는 것을 확인했다.
- 쓰기가 멈춘 백업 구간의 원본 행/sequence 불변, 비어 있지 않은 대상과 함수만 있는 대상 거부, 복원 후반부 오류 시 일반 schema와 extension까지 전체 rollback을 확인했다.
- 최종 작은 fixture 실행 약 **2.0초**. 운영 RTO나 대용량 성능 수치가 아니다.

훈련 DB와 암호화 fixture는 자동 삭제하지 않는다. 스크립트는 정확한 훈련 DB명과 테스트 파일 경로만 출력한다. fixture 키가 archive와 같은 임시 폴더에 있는 것은 **실제 고객 데이터가 전혀 없는 테스트에만** 허용한 구성이다.

## 2026-09-14 fresh 로컬 복원 훈련 기록

빈 DB에서 현재 migration을 처음부터 적용해 `0050_shipping_fee_policy.sql`까지 **51개**가 기록된 별도 disposable source `dabboba_restore_drill_release_20260914`를 만들었다. 같은 migration 명령을 다시 실행했을 때 schema가 current인 것도 확인한 뒤, 다음 로컬 전용 복원 훈련을 실행했다. 원격 DB나 실제 고객 데이터는 사용하지 않았다.

```sh
DABBOBA_BACKUP_TEST_CONTAINER=dabboba-backend-integration-20260905 \
DABBOBA_BACKUP_TEST_SOURCE_DATABASE=dabboba_restore_drill_release_20260914 \
node ops/database/test-backup.integration.mjs
```

- 결과는 `local-restore-drill-passed`였다. migration **51개**, `public`과 `pgmq`의 **전체 86개 테이블**, **486개 제약조건**이 원본과 일치했고 **210개 CHECK**를 동일 PostgreSQL parser로 다시 해석해 비교했다.
- 복원본의 `0049`·`0050`을 포함한 대상 migration checksum이 현재 source SQL과 일치했다. `inventory_units.storage_expires_at`의 기본값과 CHECK가 취득 시점부터 최소 **60일**을 보장하고, 복원된 fixture도 60일 이상인 것을 확인했다.
- 복원된 배송 정책 snapshot의 CHECK와 채움·불변 trigger를 확인했다. 비쿠지 소계 12,000원/무료배송 기준 24,900원 fixture는 무료배송 미충족 및 배송비 **3,000원**으로 복원됐고, 배송비를 0원으로 바꾸는 UPDATE는 SQLSTATE `55000`으로 거부됐다. schema의 정책 기준은 가챠 포함 24,900원, 쿠지 포함 54,900원이며 기준 미달 배송비는 3,000원이다.
- 이 실행은 작은 로컬 fixture의 논리 백업·복원 증거다. 운영 Supabase 복원, 플랫폼 관리 schema, 역할 GRANT, Storage 객체, 실제 RPO/RTO 또는 PITR을 입증하지 않는다. 전용 컨테이너는 실행 후 다시 중지했으며 훈련 DB와 암호화 fixture는 자동 삭제하지 않았다.

## 원격 백업 실행 기록

2026-09-08에 로컬 `.env`가 가리키는 원격 Supabase DB에서 TLS `verify-full`과 Supabase Root 2021 CA를 사용해 다음 암호화 backup을 생성하고 인증 태그·SHA-256·파일 권한을 확인했다. 연결 문자열과 비밀번호는 기록하지 않았으며 대상 환경 등급은 **UNKNOWN**이다.

| 변경 전 상태 | 보존 archive | SHA-256 |
| --- | --- | --- |
| `0037`까지 38개 migration | `/Users/kyoungmin/Desktop/DBB_BACKUPS/DABBOBA/20260908T082006Z/dabboba-remote-20260908T082006Z.dbbenc` | `9066fab79e2001033e9e45ca5191c98112762356ea01fd5173404683d4d60373` |
| `0038`까지 39개 migration, 수정된 `0039` 적용 직전 | `/Users/kyoungmin/Desktop/DBB_BACKUPS/DABBOBA/20260908T103057Z/dabboba-remote-20260908T103057Z.dbbenc` | `e08c76c1ea83969852defd38d4ac45376ce93864901efd56feadd15438f42153` |
| `0051`까지 52개 migration, `0052`~`0064` 적용 전 | `/Users/kyoungmin/Desktop/DBB_BACKUPS/DABBOBA/20260920T065110Z/dabboba-production-pre-migration-20260920T065110Z.dbbenc` | `7a505a9cb3f46bcac240a68e88a385898d912f84af3b6fd94752485a7a5a96cc` |

두 번째 archive는 593,250바이트이며 기존 32바이트 키를 회전 없이 재사용했다. 백업마다 새 nonce를 사용하는 형식이며 기존 archive를 덮어쓰지 않았다. archive·키 파일은 `0600`, 각각의 보관 디렉터리는 `0700`이다. 키는 저장소 밖 별도 로컬 디렉터리에 있으나 **같은 컴퓨터이므로 오프사이트 또는 별도 장애 도메인 백업은 아니다**. 최신 백업 인증 검증 후 `0039`를 한 번 적용했으며, 원격은 총 40개 migration과 로컬 checksum 일치까지 확인했다.

2026-09-20 archive는 1,092,787바이트이며 새 32바이트 키를 archive와 다른 저장소 밖 디렉터리에 생성했다. TLS `verify-full`, Supabase Root 2021 CA, PostgreSQL 18.6 client, 읽기 전용 repeatable-read snapshot을 사용했고 인증 태그와 v2 bundle 구조를 확인했다. 운영 DB에는 쓰지 않았다. 일반 PostgreSQL/pgmq 로컬 컨테이너의 빈 전용 DB에 전체 복원을 시도했으나, dump에 포함된 Supabase 관리 schema·역할과 `pg_cron`·`pg_net`·`supabase_vault`가 로컬 환경에 없어 실패했다. 단일 transaction은 완전히 rollback됐고 빈 임시 DB는 확인 후 삭제했다. 따라서 이 archive는 인증된 논리 백업이지만 Supabase 플랫폼 전체 복원 증거로 간주하지 않는다.

## 아직 완료가 아닌 항목

위 원격 archive들을 실제로 복원하지는 않았다. 2026-09-08의 84-table 및 2026-09-14의 86-table 복원 증거는 모두 고객 데이터가 없는 별도 로컬 fixture 훈련 결과다. Supabase 관리 schema/extension/Auth 설정을 포함한 전체 플랫폼 복구는 공식 운영 절차로 별도 검증해야 한다. ACL/소유권·글로벌 역할 비밀번호·Storage의 실제 이미지 객체는 이 훈련의 복원 보장 범위가 아니다. 기존 미디어 provider 변경, 자동/예약/오프사이트 백업, PITR, 복구 담당자, RPO/RTO/보존 기간, 정기 훈련과 알림도 완료하지 않았다.

## 2026-10-01 최신 소스의 로컬 복원 훈련

별도 빈 로컬 DB에 `0081`까지 migration 82개를 적용한 뒤 전용 fixture로 훈련했다. `local-restore-drill-passed`: 전체 98개 테이블·578개 제약조건·262개 CHECK 재해석, 큐/보관 메시지·sequence·RLS/policy·trigger/index 비교 및 동시 snapshot·오류 rollback 검증 통과. 운영 Supabase나 고객 데이터는 사용하지 않았고 역할 GRANT·플랫폼 전체 복구는 포함하지 않는다. 자세한 증거와 사용자 작업은 `docs/no-login-launch-preparation-2026-10-01.md`에 있다.

`ops/database/test-backup.integration.mjs`는 더 이상 migration 51개를 가정하지 않고 현재 소스 전체의 version/checksum을 요구한다. 신규 훈련 컨테이너는 `dabboba-launch-ci-YYYYMMDD-<7자리 SHA>` 이름, CI와 같은 pinned 이미지, `dabboba.purpose=disposable-launch-qa` label과 루프백 단일 포트가 필요하다. `DABBOBA_BACKUP_TEST_APPROVE_DISPOSABLE=YES`, clone용 source DB 및 **테스트 전용** user/password도 명시해야 한다. 운영·공유 DB는 source로 사용하지 않는다. 과거 훈련 기록은 당시 증거로 남기되 그 DB를 최신 소스 훈련으로 재해석하지 않는다.

## 0068~0081 적용 전후 운영 절차 (2026-09-30, 원격 미실행)

이 절은 **아직 실행하지 않은 필수 절차**다. 당시 기록의 운영 DB는 `0067`까지 적용돼 있었으며, 실제 이력도 그 상태라면 `0068`~`0081` 14개가 순서대로 적용 대상이 된다. 현재 운영 상태는 적용 직전에 다시 조회한다. `0076`은 사업자 유선번호를 반영한 새 약관·개인정보처리방침 버전(2026-09-30)을 필수 버전으로 만들므로, 적용 후 다음 로그인에서 고객에게 재동의를 받고 공개 정책 페이지도 같은 버전이 배포돼 있어야 한다. `0081`은 미게시(DRAFT) 뽑기 초안에 남은 옛 이미지 주소만 새 프로젝트 주소로 고치며 공개·종료된 확률표는 바꾸지 않는다. 클라우드 작업 환경은 운영 DB(5432)에 접속할 수 없으므로 아래 절차는 운영 DB 접속 정보가 있는 운영자 컴퓨터에서 실행한다. 이 저장소 변경은 원격 DB·백업·PITR 설정을 전혀 바꾸지 않았다. 아래 단계는 승인된 운영자가 승인된 friend 소유 프로젝트(`rconfxsykttfvznakile`)에서만 수행한다.

1. **대상·실제 이력 확인.** 위 `0067` 상태와 14개 적용 목록은 당시 관측에 기반한 계획이지 현재 운영 상태의 증거가 아니다. 친구 소유 프로젝트 ID를 대시보드에서 확인하고 `ops/database/launch-history-readonly.sql`로 실제 version/checksum을 조회해 현재 소스와 대조한다. `DATABASE_MIGRATION_URL`이 승인 프로젝트의 Session pooler(5432) 또는 direct 주소인지도 확인한다. 폐기된 QA 프로젝트 `yxkmvgfruphgghowzvmo`에는 `0067` 이상 migration이 적용될 수 없다. `packages/db/src/migrate.ts`는 대기 중인 `0067`+ migration이 있으면 아무것도 적용하기 전에 실패하고, `scripts/supabase-integration-profile.mjs`의 `assertMigrationTargetAllowed`도 같은 대상·하한을 거부한다.
2. **PITR·플랫폼 백업 확인.** Supabase 대시보드에서 해당 프로젝트의 플랜, 일일 백업 보존 기간, PITR 활성 여부와 보존 창을 확인하고 기록한다. PITR은 유료 add-on이므로 활성화·비용 결정은 소유자 승인 사항이며 이 작업에서 켜지 않았다. PITR이 없으면 일일 백업 시점과 아래 논리 백업만이 복구 지점이다.
3. **적용 직전 암호화 논리 백업.** 위 `backup` → `verify` 명령으로 새 archive를 만들고, SHA-256·크기·migration 개수를 위 표에 추가한다. 키는 archive와 다른 장애 도메인에 둔다(현재 같은 컴퓨터 보관은 오프사이트 백업이 아니다).
4. **적용.** `0078`과 `0080`은 첫 줄 `-- dabboba:no-transaction` 헤더로 트랜잭션 밖에서 `CREATE INDEX CONCURRENTLY IF NOT EXISTS`를 한 문장씩 실행한다. 중단된 빌드가 남긴 INVALID 인덱스는 다음 실행에서 `DROP INDEX CONCURRENTLY` 후 재생성하며, 모든 인덱스가 valid일 때만 checksum을 기록한다. 트랜잭션 migration은 `lock_timeout=5s`로 대기하고 `55P03`이면 최대 3회 재시도한다. `0079`는 retention 권한·일일 집계 테이블·service_role 권한 회수를 한 트랜잭션으로 적용하고 자체 검증한다. 적용 후 `db:migrate`를 한 번 더 실행해 "Database schema is current."를 확인한다.
5. **적용 후 검증.** `check:release`가 `service_role_table_grants_exposed` 없이 통과하고, `pg_index.indisvalid`가 새 인덱스 13개 모두 `true`인지 확인한다. worker의 retention 작업은 게시 후 30일 지난 outbox, 만료된 비-`CREATE_ORDER` 멱등 키, 30일 지난 폐기·만료 세션, 35일 지난 Home 클릭(일일 집계로 이관)을 실행당 최대 500행씩만 지운다. 삭제는 되돌릴 수 없으므로 첫 적용 전 3단계 백업이 필수다.
6. **복원 훈련(RPO/RTO 측정).** Supabase 관리 schema와 `pg_cron`·`pg_net`·`supabase_vault`가 있는 **별도 disposable Supabase 프로젝트 또는 branch**에 PITR 또는 플랫폼 백업 복원을 수행하고, 복원 시점·소요 시간·migration checksum 일치·역할 재provisioning(`provision:runtime-role`/`provision:worker-role`)·`check:release` 통과를 기록한다. 일반 PostgreSQL 컨테이너 복원은 위 2026-09-20 기록처럼 플랫폼 전체 복원 증거가 되지 않는다.
7. **정기화.** 복구 담당자, 목표 RPO/RTO, 백업·PITR 보존 기간, 분기별 복원 훈련 일정, 실패 알림 경로를 소유자가 정하고 이 문서에 기록한다. 이 항목들이 기록되기 전에는 공개 출시 조건을 충족하지 않는다.

공식 참고: [Supabase 백업 범위](https://supabase.com/docs/guides/platform/backups), [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html), [snapshot 공유](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION), [sequence 동작](https://www.postgresql.org/docs/17/functions-sequence.html).
