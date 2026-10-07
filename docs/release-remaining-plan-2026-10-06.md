# 출시까지 남은 일 — 누가·어디서·어떻게 (2026-10-07 갱신)

목표: 친구 명의 계정으로 가챠 8종 판매판(LIVE)을 iOS·Android에 출시한다. 쿠지는 첫 출시 범위 밖이다.
명령은 [`launch-operator-checklist.md`](launch-operator-checklist.md), 제출 답안은 [`store-submission-pack.md`](store-submission-pack.md),
법률 확정 항목은 [`legal-drafts/review-questionnaire.md`](legal-drafts/review-questionnaire.md)를 따른다.

## 0. 현재 상태 (2026-10-07)

- **코드**: 출시 차단 코드는 남아 있지 않다. 2026-10-07까지 main에 병합된 것:
  - 출시 전 돈·탈퇴 경로 점검 19건 모두 수정(PR #35·#36). 점검 기록은 [`pre-launch-money-review-2026-10-06.md`](pre-launch-money-review-2026-10-06.md).
  - 판매판 약관·개인정보처리방침과 게시 번들(PR #37): 정책 버전 `2026-10-07` 마이그레이션 `0090`, 맞춤 추천 동의 철회 `0091`, 세션 기록 90일.
  - 그 밖에 탈퇴 기록 분리 보관, 포인트 소멸 동의 탈퇴, 미사용 뽑기 부분 환불, LIVE 전환·되돌리기 명령, 스토어 심사자 로그인.
- **이번 작업 브랜치(병합 전)**: 로그인 동의에 "만 14세 이상" 확인 추가, 첫 화면 문구를 Pages 변수로 판매판 전환, 보존기간 승인 스크립트(`ops/database/commerce-retention-approval.sql`), Edge 워커의 보존 실행 설정 전달.
- **운영 서버(2026-10-07 읽기 전용 확인)**:
  - DB는 `0087`까지 적용(88개). 남은 마이그레이션은 `0088`~`0091` 4개이고, `0090`·`0091`의 사전 조건(현재 2026-09-30 문서 해시, 제약 이름)과 일치한다. 저장된 맞춤 추천 동의는 0건이다.
  - 공개 설정은 PRELAUNCH, 요구 정책 버전은 아직 2026-09-30이다. Edge·관리자 웹은 이전 배포이고 Cron은 꺼져 있다.
  - 보존기간 정책·검토·보류·파기 기록은 모두 0건이다. ACTIVE 관리자는 1명이다.
  - **주의**: PR #37 병합으로 `dabboba.net/terms`·`/privacy`는 이미 2026-10-07 판이다(해시 확인). DB는 아직 이전 판이라 앱 동의 화면의 버전과 공개 문서가 어긋나 있다. 운영 반영(1단계)에서 `0090`·`0091`을 빨리 적용해야 한다.
- **외부**: KG이니시스는 PortOne 입점 심사 중. Apple 친구 팀 준비 완료. Google Play 앱 레코드 없음.

## 1. 운영 반영 — 개발·운영자, 운영자 컴퓨터, 1~2일

| 단계 | 어떻게 | 끝난 기준 |
|---|---|---|
| 1-1 | `git pull` → `corepack pnpm install --frozen-lockfile` → `build:all` → `db:release-source:check` | `"blockers": []` |
| 1-2 | `node ops/database/backup.mjs backup …` → `verify` | `archive-authenticated` |
| 1-3 | `corepack pnpm run db:migrate` 두 번 | 첫 번째 `Applied 4 migration(s).`(0088~0091), 두 번째 `Database schema is current.` 적용 직후 공개 설정의 정책 버전이 `2026-10-07`이 된다 |
| 1-4 | `corepack pnpm --filter @dabboba/db check:release` | `"blockers": []`, `targetHash` 기록 |
| 1-5 | `corepack pnpm run supabase:edge:deploy` → `supabase:edge:public:verify` → `release:edge:worker:verify` | 공개 설정 PRELAUNCH, 워커 GET 405·익명 POST 401 |
| 1-6 | `apps/admin`에서 `build:cloudflare` → `wrangler deploy --dry-run` → `wrangler deploy --keep-vars` | 관리자 결제 상세에 "미사용 뽑기 부분 환불"·"포인트 주문 환불" 패널이 조건에 맞게 표시 |
| 1-7 | `corepack pnpm run supabase:worker:schedule <targetHash>` | Supabase Cron 실행 기록이 성공으로 쌓임 |

Cron을 켜면 결제 대사, 15분 미결제 주문·배송비 신청 자동 취소, 탈퇴 처리, 세션·이벤트 정리가 돈다.
보관기한 알림·만료 보류와 기록 파기는 계속 꺼져 있다.

## 2. 판매 상품 준비 — 운영자, 관리자 웹

1. 가챠 8종마다 경품 구성·수량을 검수한다.
2. 확률표를 ACTIVE로 게시하고 재고를 확인한다.
3. 먼작귀·산리오 구성 명칭과 상품 이미지 판매권을 확인한다.
4. `ON_SALE`로 바꾼다. 결제는 LIVE 전까지 막혀 있으니 미리 열어도 된다.
5. 끝난 기준: 구매 가능한 가챠가 1개 이상이고 판매 중인 쿠지가 0개(LIVE 검증 조건).

## 3. 친구 명의 계정 — 친구, 각 서비스 콘솔

순서와 완료 기준은 [`friend-owned-release-accounts.md`](friend-owned-release-accounts.md)를 따른다.
모든 서비스에서 친구가 최상위 소유자이고, 복구 수단·MFA를 직접 통제하고, 결제 주체가 친구 사업자와 같아야 한다.
개발자는 최소 권한으로 다시 초대한다.

| 서비스 | 지금 | 할 일 |
|---|---|---|
| Apple | 완료(Team `MCZ4884P7F`, 앱 ID 6815146511, TestFlight 1.0.0(1) 검증) | TestFlight 내부 테스터 초대 |
| Google Play | 앱 레코드 없음 | 앱 생성(`com.dabboba.mobile`), 신원·결제 프로필, 개발자 초대 |
| Expo/EAS | 개발자가 Owner | 친구를 Owner·결제 주체로, 개발자 권한 축소 |
| GitHub | 개발자 개인 저장소 | 친구 계정·조직으로 이전, 브랜치 보호·Actions 설정 확인 |
| Supabase·Cloudflare·도메인 | 소유자 미확인 | Owner·결제·복구 주체 확인 |
| 지원 메일 | 수신만 확인 | 발신 설정, DKIM·DMARC |
| 로그인 앱(카카오·네이버·구글) | 친구 소유 증거 없음 | 친구 사업자 계정에서 앱 확인 또는 재생성, redirect 설정 |
| 푸시 키(APNs·FCM) | 없음 | 친구 Apple·Firebase에서 발급, EAS와 서버 비밀값에 연결 |
| PG·정산·세금 | 미확인 | 사업자·PG 계약자·정산계좌·세금 주체 일치 확인 |

## 4. 로그인 검수 — 친구, 각 제공자 콘솔

- **네이버**: 제공 정보에서 이름·성별·생일·전화번호를 빼고 이메일을 선택으로 바꾼다. 테스터로 동의 화면을 캡처한 뒤 검수를 요청한다(체크리스트 7-1).
- **구글**: OAuth 동의 화면을 게시하고 필요하면 검증을 받는다. 범위는 `openid`·`email`·`profile`만.
- **카카오**: 비즈 앱으로 전환하고 검수를 받는다. 이메일 권한은 요청하지 않는다.
- **휴대폰 로그인**: 2026-10-07 결정으로 제공하지 않는다. `PHONE`을 켜지 않으며 Twilio 설정도 하지 않는다.
- 끝난 기준: 실제 고객 계정으로 4종 모두 신규 로그인·재로그인·로그아웃이 된다.

## 5. 법률·정책 — 친구(자문은 선택)

1. 2026-10-06 소유자 결정에 따라 약관·개인정보처리방침·내부관리계획을 업계 표준 기준으로 확정했다(`docs/legal-drafts/`).
   - 기준: 공정위 전자상거래 표준약관, 개인정보위 처리방침 작성지침
   - 34개 항목의 확정 내용: [`review-questionnaire.md`](legal-drafts/review-questionnaire.md)
2. 채울 값 4개(시행일, 택배사 상호, 지원 메일 수신 서비스, Supabase 저장 리전)는 2026-10-07에 모두 채웠다. 네이버 제공 정보 축소는 아직 확인한다(질문지 C1).
3. 대표가 내부관리계획을 승인한다. 법률 자문은 선택이며, 받으면 그 의견을 우선한다.
4. 개발(2026-10-07 코드 완료, 게시는 LIVE 직전 한 배포): 순서는 `docs/live-cutover-runbook.md` "법적 문서 게시 번들".
   - `public/legal/terms`·`privacy` 2026-10-07 판 반영
   - 정책 버전 `2026-10-07` 마이그레이션 `0090`(기존 회원 재동의)
   - 맞춤 추천 토글 제거(앱·API)와 기존 동의 철회 마이그레이션 `0091`
   - 워커 세션 기록 보관 30일 → 90일
   - 보존기간 정책 승인은 운영 절차로 남음. 실행용 스크립트 `ops/database/commerce-retention-approval.sql`(관리자 화면은 아직 없음)
   - 가입 동의 화면의 "만 14세 이상" 확인 추가(2026-10-07)
5. **Google Play 정책 문의**: 친구 Play Console에서 [`google-play-paid-draw-inquiry.md`](google-play-paid-draw-inquiry.md)의 본문을 제출하고 서면 회신을 받는다. Play 출시 가능 여부가 걸려 있다.

## 6. 결제 — KG이니시스 승인 후, 운영자·개발

1. PortOne에서 KG이니시스 LIVE 채널을 연결한다. LIVE MID, 채널키, 웹훅 비밀값, API 비밀값, 정산계좌를 확인한다.
2. 스테이징(`lyzcyrdiazorjaqlgblr`) 테스트 채널에서 체크리스트 9-1을 하나씩 실제로 확인하고 기록한다.
   - 카드 결제 → 뽑기 → 결과
   - 미사용 주문 전액 환불: 카드·혼합·포인트 전용
   - 일부 사용 주문 부분 환불: 카드 부분 취소 금액이 미리보기와 같은지
   - 배송비 결제·환불
   - 15분 방치 자동 취소
3. `../.dabboba-launch/supabase-edge-live.env`(LIVE 프로필)를 준비하고 `corepack pnpm run supabase:edge:live:check`를 통과시킨다.

## 7. 판매판 빌드·제출 — 개발·친구

1. **빌드**: EAS `production-live`로 빌드한다.
   - iOS 빌드 번호는 6으로 올려 두었다. 이후 빌드마다 1씩 올린다.
   - 친구 팀으로 서명하고 `node scripts/verify-ios-artifact-team.mjs <ipa>`로 확인한다.
   - Android는 AAB와 Play 앱 서명 방식을 정한다.
2. **실기기 회귀**: iPhone과 Android 실기기에서 아래를 확인한다.
   - SNS 로그인 4종, 로그아웃, 딥링크
   - 상품 → 결제 직전 화면, 보관함·배송 신청
   - 탈퇴(포인트 소멸 포함), 접근성
3. **심사자 로그인**: Edge 반영 뒤 체크리스트 7단계로 30일 이내 기간을 열고, 앱에서 로그인을 확인한다.
4. **스토어 자료**: [`store-submission-pack.md`](store-submission-pack.md)의 답안을 콘솔에 입력한다.
   - 스크린샷은 실제 설치한 판매판에서 캡처한다.
   - App Store: 설명, 심사 정보와 심사자 계정, 연령 등급, 개인정보 라벨
   - Play: 데이터 보안, 콘텐츠 등급, 앱 액세스
5. **제출 → 심사 대응**: 심사가 끝나면 심사자 로그인을 닫는다(`ENABLED=false`).

## 7-1. 출시 전 운영 준비 (권장)

- **오류 추적·알림**: 도구를 정하고(예: Sentry), API·워커 오류와 결제 대사 실패 알림을 받을 담당자를 정한다.
- **백업**: 운영 DB 시점 복구(PITR) 사용 여부와 외부 백업 보관 위치를 정하고, 복원 훈련을 1회 한다.
- **관리자 2단계 인증(Cloudflare Access, 2026-10-06 결정)**: 체크리스트 4-1을 따른다. LIVE 전에 반드시 끝나야 한다.
  - Cloudflare Zero Trust에서 `admin.dabboba.net` Access 앱을 만들고, 운영자 이메일만 허용한다.
  - 팀 도메인과 AUD 태그를 `apps/admin/wrangler.jsonc`에 넣어 관리자 웹을 재배포한다.
  - 확인 명령은 `corepack pnpm run admin:access:verify`이다. LIVE 전환 명령도 같은 검사를 통과해야 진행한다.
- **고객센터**: 지원 메일 발신과 응답 담당자를 정한다. 부분 환불·탈퇴 문의를 처리하는 사람이 관리자 화면 사용법을 익혀야 한다.

## 8. LIVE 전환 — 운영자

- 조건:
  - KG이니시스 승인과 테스트 채널 검증 기록
  - 관리자 Cloudflare Access(`admin:access:verify` 통과, 전환 명령이 직접 확인)
  - 판매판 스토어 승인
  - 판매판 약관·개인정보처리방침 게시와 새 정책 버전
  - 전환 직전 백업과 `verify`
  - 상품 `ON_SALE`, Cron 동작
  - 전환 성공 직후 Pages 변수 `VITE_DABBOBA_COMMERCE_MODE=LIVE`로 첫 화면 문구 전환(런북 "공개 사이트 문구 전환")
- 명령: `node scripts/deploy-supabase-live-edge.mjs --confirm=LIVE:rconfxsykttfvznakile`
- 실패하면 자동으로 PRELAUNCH로 돌아간다. 되돌리기는 `--rollback --confirm=PRELAUNCH:rconfxsykttfvznakile`이다.

## 9. 정한 것 (2026-10-06 소유자 결정)

| 항목 | 결정 | 할 일 |
|---|---|---|
| 보관기한 알림·만료 보류 운영 | 판매 시작 후 60일 안에 정한다 | 첫 LIVE 판매일 + 60일 전에 운영 여부를 결정한다. 켜기로 하면 고객 안내 문구와 약관 문장을 반영한 뒤 Edge 설정 `WORKER_INVENTORY_STORAGE_EXPIRY_MODE=ENABLED`만 추가한다(전달 연결은 해 두었다). 그 전까지는 꺼져 있고 만료 상품을 자동 폐기하지 않는다. |
| 거래기록 보존기간 승인 | 법률 문서와 함께 승인 | 질문지 B7의 기간(거래 5년, 불만 3년, 광고 6개월, 동의 기록 탈퇴 후 5년)으로 LIVE 직전에 승인한다. 관리자 화면은 아직 없으니 `docs/commerce-retention-components.md`의 운영 절차를 따른다. 그 전까지 자동 파기는 돌지 않는다. |
| 탈퇴 시 남은 보관 상품 | 첫 출시는 가챠만이라 출시 후 결정 | 지금 규칙을 유지한다(보관·교환 예약·배송 중 상품은 배송이나 포인트 환급으로 정리해야 탈퇴). 쿠지 판매 전에 다시 정한다. |
| 관리자 2단계 인증 | Cloudflare Access | 7-1과 체크리스트 4-1. LIVE 전환 명령이 직접 확인한다. |
| 글 필터 연락처 차단 범위 | 지금대로 유지 | 교환·신청방 글의 링크·전화번호·메신저 아이디 요청을 계속 막는다. 오탐 신고가 오면 조정한다. |

## 순서 의존성

```
운영 반영(1) → 상품 준비(2) ─────────────────────┐
친구 계정(3) → 로그인 검수(4) → 판매판 빌드(7) ───┤
법률 문서 채울 값(5) → 정책 새 버전 ────────────┼→ LIVE 전환(8)
Google Play 정책 문의(5-5) ──────────────────────┤
KG이니시스 승인 → 테스트 채널 검증(6) ───────────┤
관리자 Cloudflare Access(7-1) ────────────────────┘
```
가장 오래 걸릴 일은 KG이니시스 승인과 Google Play 회신이다. 둘 다 지금 바로 시작할 수 있으니 먼저 요청해 둔다. 법률 문서는 업계 표준으로 확정했으므로 자문은 선택이다.
