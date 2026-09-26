# 정식 출시 1·2단계 실행 기록 — 2026-09-27

이 문서는 **출시 승인서가 아니다.** 코드·CI, 운영 대시보드 조회, 복원 가능한 백업, 실제 결제·실기기·스토어 심사는 서로 다른 증거다.

## 1. 유료 실물 뽑기 정책·고객 설명

- 고객 동선은 `상품·가격·가능한 결과/확률 확인 → 서버 확인 결제 → 서버 발급 뽑기 권리 사용 → 확정 결과 확인 → 보관함 → 대상 가챠의 포인트 환급 또는 실물 배송 신청`이다. 결과 화면은 이미 서버에 기록된 결과만 보여준다.
- 실물 상품이 제공되더라도 **정확한 상품 종류는 결제 전에 확정·공개되지 않는다.** 가챠는 남은 수량이 반영된 가중치로 서버에서 선택되고, 쿠지는 사전에 CSPRNG로 섞은 유한 봉인 덱에서 결제 후 티켓 번호를 선택한다. 그러므로 `무작위가 아니다`라는 문구는 코드와 맞지 않는다.
- 포인트 환급은 현금 환불이 아니다. 본인이 직접 뽑은 보관 중 가챠 상품에만 기준가의 50%가 앱 포인트로 적립된다. 쿠지는 환급 대상이 아니다. 배송 기본 기한은 획득일로부터 60일이며, 무료배송 기준은 가챠만 24,900원·쿠지 포함 54,900원, 미달 배송비는 3,000원이다. 유료 배송비 결제가 미검증이면 해당 신청은 계속 차단한다.
- 제출용 사실관계 초안은 [google-play-paid-draw-inquiry.md](google-play-paid-draw-inquiry.md)에 작성했다. 친구 명의 Play Console의 **실제 서면 회신**과 국내 법률 검토 문서가 아직 이 저장소에 없으므로 정책 분류나 판매 허용을 확정할 수 없다. 경쟁 앱의 출시 사실은 다뽀바의 승인 증거가 아니다.
- [Google Play 정책](https://support.google.com/googleplay/android-developer/answer/9877032?hl=ko)은 금전 대가로 실물 경품 획득 기회를 제공하는 게임을 위반 사례로 제시한다. `실물 상품 판매` 또는 외부 PG 이용만으로 예외가 성립한다고 단정하지 않는다. [Apple 심사 지침](https://developer.apple.com/app-store/review/guidelines/)에 제출할 때도 실제 뽑기 방식과 정확한 결과 공개 시점을 숨기지 않는다.

## 2. 릴리스 소스·운영 DB

| 증거 | 2026-09-27 확인 | 결론 |
| --- | --- | --- |
| 깨끗한 릴리스 소스 | `release/live-candidate-hardening`의 `8e2be4938e648fbae1d99e9bb08140173965ebb5`, `node scripts/check-database-release-source.mjs` 통과 | `0075`까지 추적·checksum 검사 통과. 운영 DB 적용 증거는 아님. |
| main 병합 후보 | PR #3 (`release/prelaunch-signing-stage2` → `main`) 열림, CI 4개 성공 | 아직 main 병합이나 서명·설치 증거가 아님. |
| 운영 DB | 친구 소유 `rconfxsykttfvznakile` SQL Editor에서 `max(version)=0067_catalog_media_project_rebase.sql`, `count(*)=68` 조회 | `0068`–`0075`는 미적용. |
| 운영 백업 | 프로젝트 Free Plan의 Backups 화면에서 `Free Plan does not include project backups.` 확인 | 자동 복원 지점 없음. |
| 직접 DB 연결 | 공식 Supabase Root 2021 CA를 내려받아 `verify-full` 연결 성립. 보유 `dabboba_worker` 역할은 `schema_migrations` SELECT 권한 없음 | worker 자격으로 전체 논리 백업이나 마이그레이션을 시도하지 않는다. |
| 운영 API | `/v1/public/config`가 `commerceMode=PRELAUNCH` 반환 | 유료 판매/뽑기 LIVE 전환 안 됨. |
| 집중 회귀 | DB 소스, 결제 후 뽑기 연결, 가챠 전용 포인트 환급, 배송 기준, 유료 쿠지 선택 테스트 22개 통과 | 로컬 코드 검증이며 운영 DB·실제 PG·서명 앱 증거는 아님. |

운영 DB 변경 전 선행 조건:

1. 친구 명의 프로젝트의 **백업용 최소 권한 접근**을 안전하게 연결하고, `verify-full`로 암호화된 전체 논리 백업을 생성한다. 백업 키는 archive와 분리한다. Free Plan의 자동 백업은 없으므로 오프사이트 사본·보존 기간도 결정한다. 서비스용 worker 비밀번호를 백업/DDL 권한으로 승격하지 않는다.
2. 새 빈 **별도** Supabase 프로젝트 또는 동등한 환경에 복원 훈련을 하고 데이터·마이그레이션 checksum·역할/RLS·Storage 객체와 앱 읽기 경로를 확인한다. 일반 PostgreSQL 컨테이너가 Supabase 관리 schema/extension을 복원하지 못했던 과거 실패는 성공 증거로 취급하지 않는다.
3. 운영과 소스 checksum을 비교하고 `0068`–`0075`를 순서대로 적용한다. 각 migration의 잠금/실행 시간·실패 rollback·재실행 no-op을 점검한다. 결제·worker·Cron은 별도 승인 전까지 `PRELAUNCH`에 둔다.
4. 운영 DB 릴리스 체크와 Auth/상품/API 연동 회귀를 수행한 뒤 새 읽기 전용 스냅샷을 남긴다. PR #3 병합, LIVE 배포, 실제 PG 결제, 서명 빌드와 스토어 제출은 각각 별도 게이트다.

이 단계에서 **운영 DDL은 실행하지 않았다.** 임시 전용 백업 계정 생성에 대한 사용자 승인은 받았지만, 그 계정의 새 비밀번호 입력·보관은 계정 소유자가 직접 완료해야 한다. 현 대시보드 로그인 세션만으로 복원 가능한 전체 백업 경로와 DB 관리자 접속을 확보하지 못했다. 기존 앱용 `dabboba_worker`의 권한을 늘리지 않으며, 사용자나 친구가 비밀번호를 채팅에 보내서는 안 된다.
