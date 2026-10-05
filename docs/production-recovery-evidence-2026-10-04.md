# 2단계 실제 운영 백업·격리 복원 결과 — 2026-10-04

**판정: 실제 운영 데이터의 로컬 복원 검증은 통과. 2단계 전체는 아직 미완료.** 오프사이트 보관·키 분리·관리형 플랫폼 복구·정기 백업 운영을 이 결과로 완료 처리하지 않는다. 3단계 서명 빌드 작업으로 넘어가지 않았다.

## 대상과 안전 경계

- 원본은 친구 소유 `dabboba-production` / `rconfxsykttfvznakile`만 사용했다. 결제 시험 프로젝트와 FINDE는 변경하지 않았다.
- 릴리스 기준 소스는 main의 `3cbe8c8fcdf1d7c9d428391a55b097a839d6e991`이다. 기존 사용자 checkout의 변경을 유지하고 별도 통합 checkout에서 문서만 갱신했다.
- 원본 DB는 인증서·호스트를 검증하는 TLS와 읽기 전용 repeatable-read transaction으로 조회했다. 원본의 역할, 비밀번호, 데이터, extension, 결제 모드, Cron 또는 worker 활성화를 변경하지 않았다.
- 새 빈 `dabboba_restore_drill_actual_20261004_3cbe8c8` DB에 복원했다. 복원 컨테이너는 `--network none`, 공개 포트 없음, 전용 목적 label을 확인하고 사용했다. 매 검증 후 중지했으며 자동 삭제하지 않았다.
- 운영과 같은 PostgreSQL `17.6.1.166`의 공식 Supabase 이미지와 동일 extension 버전을 사용했다. arm64 이미지 digest는 `sha256:f20491444ff7818267e652ced923991fdab24fc07e0eb2bacfba26ab72a45563`이다.
- 평문 DB dump/복원 SQL, 연결 비밀번호, Storage 읽기 credential은 파일·출력에 남기지 않았다. 암호화 archive와 복구 검증 metadata는 Git 밖에 저장했다. 실제 복원 DB와 사진 파일은 로컬에 평문으로 남으므로 이 격리 환경도 개인정보를 포함하는 복구 자료로 취급해야 한다.

## 실제로 통과한 항목

| 항목 | 확인 결과 | 보장 범위 |
| --- | --- | --- |
| 운영 DB snapshot | `2026-10-04T11:28:50.664Z`, 83개 migration, 138개 테이블, 큐 1개 | 일반 dump와 PGMQ 보완 데이터, 행 수·행 지문이 같은 source snapshot을 사용 |
| 암호화 DB archive | 855,075 bytes; AES-256-GCM 인증 및 새 archive 디스크 읽기 검증 | 기존 32-byte 키 재사용, 새 nonce; 키 회전/외부 보관은 아님 |
| 실제 DB 복원 | 138개 테이블 행 수·정렬된 내용 지문, migration 83개 checksum, extension 8개 버전 일치 | `auth` 사용자 데이터, 앱 데이터, `storage` metadata, `vault`, `realtime`, PGMQ 포함 |
| 논리 구조 | 열 1,316개, 제약조건 747개, 사용자 trigger 115개, index 422개, 함수 264개, enum 12개 일치 | 삭제된 열의 물리 slot은 제외하고 보이는 열의 순서를 대조; CHECK 338개는 동일 PG parser로 재해석. 캐스트/논리식을 문자열로 제거하지 않음 |
| 접근 권한 | schema 10개, relation 145개, 함수 264개 소유권·GRANT, column ACL 80개, default ACL 27개 대조 | target extension 설치가 추가한 default grant를 제거한 후 source의 유효 권한과 일치 |
| 앱/worker 역할 | 서로 분리된 로컬 신규 credential로 실제 접속, 금지 접근 11개가 SQLSTATE `42501`로 거절 | 운영 역할 비밀번호를 복사하지 않음. runtime CRUD/worker queue 시험은 로컬에서 rollback |
| 노출 차단 | `anon`, `authenticated`, `service_role`의 public 앱 테이블/열 접근 노출 0개 | RLS/FORCE RLS 일치, 앱/worker 간 역할 membership 0개 |
| 큐 재검증 | queue metadata·행·sequence 값/속성 재대조 일치 | PostgreSQL sequence는 rollback되지 않으므로 로컬 시험 후 원래 snapshot 값으로 돌리고 재검증 |
| 실제 사진 파일 | bucket 1개, object 102개, 총 3,209,128 bytes를 암호화 백업·디스크 복원 후 SHA-256 일치 | DB snapshot의 Storage metadata와 일치, 파일 다운로드 전후 metadata 불변 확인. 운영 Storage에는 쓰지 않음 |
| source 없는 사진 재복원 | 별도 `media-restore-offline` 실행에서도 102개 파일·SHA-256 일치 | source 연결/네트워크 없이 저장된 archive를 새 폴더에 복원. 전체 manifest/hash 검증 후 쓰기 |
| 외부 보관용 묶음 준비 | 14개 파일, 5,319,488 bytes, ZIP에서 모든 파일을 다시 읽어 원래 SHA-256과 비교 | DB·사진·암호화 검증 metadata·통과 결과·복구 도구·안내 포함. 복호화 키/credential 파일/고객 평문 행 제외. 아직 전송하지 않음 |
| 기존 도구의 보호 경계 | `tests/database-backup.test.mjs` 8개 통과 | 잘못된 키/변조/잘못된 대상/TLS/파일 접근 권한/PGMQ bundle 거부 경계 유지 |

함수/제약조건/권한의 source 구조는 후속 읽기 전용 snapshot으로 다시 수집했다. migration/extension과 원래 권한의 불변을 확인했지만, DB archive와 사진 bytes가 전 서비스의 하나의 원자적 snapshot이라고 주장하지 않는다. Storage metadata의 전후 일치로 이번 복구 자료의 object 정합성을 확인했다. PGMQ sequence 자체도 MVCC 원자 snapshot 대상이 아니다.

### 보존 파일 지문

- DB archive SHA-256: `2cf99d899db0f48624eddab6f0f43273ffacbd26cc7769d38ed9c8055f4b3d82`.
- 사진 archive SHA-256: `4603cdb7a03c2b53701eb45f59d51c4f11d16f07d67321023552e6ec7f765f81`.
- `production-recovery-package-20261004.zip` SHA-256: `97e5f4cc59102a4f00f504a73b491cc7cbba3aef4ed8c8a46eff7091f87587c4`. 이 값은 준비된 로컬 묶음의 지문이지 오프사이트 전송 증거가 아니다.
- 로컬 운영자 증거는 Git 밖의 `.dabboba-launch/evidence/actual-recovery-20261004/`에 있다. 최초 실패 시도도 보존하며 최종 `status=passed`와 원본·복원 비교가 끝난 결과만 통과 증거로 사용한다.
- DB archive만 옮겨서는 소유권/GRANT와 사진 파일을 복구할 수 없다. 암호화된 snapshot 검증 metadata, 추가 column/default ACL, 구조 metadata, 사진 archive와 복구 도구의 동일 소스를 함께 보존해야 한다. **키는 이 묶음에 포함하지 않는다.**

## 이번 결과가 입증하지 않는 것

1. **관리형 Supabase 전체 복구.** CLI에서 기존 전용 `dabboba-restore-drill-20260927` / `avayraweljlypsonbyxi`는 `INACTIVE`였다. 재개·유료 전환·다른 프로젝트 중지는 하지 않았다. Auth 사용자 테이블이 복원된 것과 실제 OAuth 로그인·JWT/키·GoTrue/Storage API/Edge Functions 설정이 복구된 것은 다르다. 관리형 cluster 역할 membership/비밀번호는 source 그대로 적용하지 않았다.
2. **오프사이트 및 키의 별도 장애 도메인.** 새 archive와 기존 키는 아직 같은 Mac에 있다. 둘을 다른 로컬 폴더에 두는 것으로 Mac 분실/디스크 고장에 대비할 수 없다. 사진의 로컬 파일 복원은 클라우드 Storage API 업로드·다운로드 복구 시험이 아니다.
3. **정기 백업/알림/보존 정책.** 자동 실행, 실패 알림 수신, 새 백업의 자연 발생, 보존 기간에 따른 폐기는 실행하지 않았다. RPO/RTO 목표를 정하지 않았고 작은 현재 데이터의 실행 시간을 재해 복구 RTO로 간주하지 않는다.
4. **삭제 이후 상태 재반영과 업무 복구.** 백업 이후의 탈퇴·삭제 및 결제/배송 변경을 재반영하고 PG 원장과 대조해야 한다. 이번 로컬 clone은 외부 통신이 차단돼 복원한 queue를 소비하거나 결제/알림을 보내지 않았다. 자동 재개가 승인된 것은 아니다.

## 이어서 진행할 순서

1. Codex 브라우저의 Supabase/Cloudflare를 친구 명의 다뽀바 계정으로 준비한다. 이번 읽기 전용 조회에서는 Supabase에 FINDE 조직만, Cloudflare에 개발자 개인 계정만 보여 다뽀바 설정에 접근하지 않았다. 이들 계정에는 쓰지 않았다.
2. 다뽀바의 현재 플랜, 플랫폼 백업/PITR 상태, 전용 복구 프로젝트 재개 가능 여부를 확인한다. 2026-09-27 Free Plan 관측은 과거 기록이며 현재 플랜으로 단정하지 않는다. 새 비용·다른 프로젝트 중지·운영 복원은 따로 승인받는다.
3. 친구 소유의 비공개 오프사이트 목적지와 별도 키 보관 위치를 정한다. 암호화 자료만 전송하고 다시 내려받아 묶음/각 파일 hash와 복호화를 확인한다. 키를 같은 bucket이나 자료 ZIP에 넣지 않는다.
4. 격리된 플랫폼 복구 대상에서 Auth/Storage/API 읽기·권한을 검증한다. 운영 hostname을 복구용으로 덮어쓰거나 운영 worker/Cron/결제를 켜지 않는다. snapshot 이후 삭제 기록을 재반영하기 전에는 복원 데이터를 서비스에 공개하지 않는다.
5. 소유자가 주기·보존·복구 담당자·실패 알림 경로·RPO/RTO 목표를 확정한 뒤 정기화를 적용하고 실제 실행/알림/복구를 확인한다. 이 항목들이 남아 있으면 2단계 전체를 완료로 부르지 않는다.

검증 과정은 code-work/code-verification의 원본/검증 대상 분리와 제한된 증거 원칙을 적용했다. 운영 변경과 새 권한 확대를 실제 복원 시험에 섞지 않았으며, 로컬 통과를 플랫폼 전체 복구로 확대 해석하지 않았다.

공식 범위 참고: [Supabase 백업](https://supabase.com/docs/guides/platform/backups), [관리형 플랫폼에서 self-hosted로 복원](https://supabase.com/docs/guides/self-hosting/restore-from-platform), [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).
