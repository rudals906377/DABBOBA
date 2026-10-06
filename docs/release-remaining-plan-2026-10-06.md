# 출시까지 남은 일 — 누가·어디서·어떻게 (2026-10-06 갱신)

목표: 친구 명의 계정으로 가챠 8종 판매판(LIVE)을 iOS·Android에 출시한다. 쿠지는 첫 출시 범위 밖이다.
명령은 [`launch-operator-checklist.md`](launch-operator-checklist.md), 제출 답안은 [`store-submission-pack.md`](store-submission-pack.md),
법률 확정 항목은 [`legal-drafts/review-questionnaire.md`](legal-drafts/review-questionnaire.md)를 따른다.

## 0. 현재 상태

- **코드**: 출시 차단 코드는 남아 있지 않다. 2026-10-06 기준 main에 병합된 것:
  - 탈퇴 기록 분리 보관(0086)과 포인트 소멸 동의 탈퇴(앱·웹)
  - 포인트 전용 주문 환불, 미사용 뽑기 부분 환불(0087, 소유자 승인 산정식)
  - 보관기한 자동 처리 기본 꺼짐, 만료 상품 보관함 표시
  - 게시 전 글 필터(앱스토어 지침 1.2)
  - LIVE 전환·되돌리기 명령, 스토어 심사자 로그인
- **운영 서버**: 아직 이전 코드다. DB는 0082까지 적용, Edge·관리자 웹은 이전 배포, Cron은 꺼짐, 공개 설정은 PRELAUNCH.
- **외부**: KG이니시스는 PortOne 입점 심사 중. Apple 친구 팀 준비 완료. Google Play 앱 레코드 없음. 법률 검토 전.

## 1. 운영 반영 — 개발·운영자, 운영자 컴퓨터, 1~2일

| 단계 | 어떻게 | 끝난 기준 |
|---|---|---|
| 1-1 | `git pull` → `corepack pnpm install --frozen-lockfile` → `build:all` → `db:release-source:check` | `"blockers": []` |
| 1-2 | `node ops/database/backup.mjs backup …` → `verify` | `archive-authenticated` |
| 1-3 | `corepack pnpm run db:migrate` 두 번 | 첫 번째 `Applied 5 migration(s).`, 두 번째 `Database schema is current.` |
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
- **휴대폰 로그인**: 첫 출시는 끄는 것을 권한다. 켜려면 Twilio를 설정하고 개인정보처리방침에 국외 이전을 적는다.
- 끝난 기준: 실제 고객 계정으로 4종 모두 신규 로그인·재로그인·로그아웃이 된다.

## 5. 법률·정책 — 친구 + 법률 자문

1. [`review-questionnaire.md`](legal-drafts/review-questionnaire.md)의 34개 항목에 답한다. A는 사업자, B는 법률 자문, C는 콘솔 확인 몫이다.
2. 답을 `terms-live-draft.md`·`privacy-live-draft.md`에 반영하고 `[확인 필요]`를 0개로 만든다.
3. 개발: LIVE 직전에 아래를 한 배포로 함께 반영한다.
   - `public/legal/terms`·`privacy` 교체
   - 새 정책 버전 마이그레이션(기존 회원 재동의)
   - 맞춤 추천 토글 제거와 기존 동의 철회
4. **Google Play 정책 문의**: 친구 Play Console에서 [`google-play-paid-draw-inquiry.md`](google-play-paid-draw-inquiry.md)의 본문을 제출하고 서면 회신을 받는다. Play 출시 가능 여부가 걸려 있다.

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
- **관리자 2단계 인증**: 앱 코드에는 없다. 환불 권한 계정이 있으니 `admin.dabboba.net` 앞에 Cloudflare Access 같은 2단계 인증을 두는 것을 권한다(방식 결정 필요).
- **고객센터**: 지원 메일 발신과 응답 담당자를 정한다. 부분 환불·탈퇴 문의를 처리하는 사람이 관리자 화면 사용법을 익혀야 한다.

## 8. LIVE 전환 — 운영자

- 조건:
  - KG이니시스 승인과 테스트 채널 검증 기록
  - 판매판 스토어 승인
  - 법률 검토본 게시와 새 정책 버전
  - 전환 직전 백업과 `verify`
  - 상품 `ON_SALE`, Cron 동작
- 명령: `node scripts/deploy-supabase-live-edge.mjs --confirm=LIVE:rconfxsykttfvznakile`
- 실패하면 자동으로 PRELAUNCH로 돌아간다. 되돌리기는 `--rollback --confirm=PRELAUNCH:rconfxsykttfvznakile`이다.

## 9. 아직 정할 것

| 항목 | 지금 | 권장 |
|---|---|---|
| 보관기한 알림·만료 보류 운영 | 꺼짐 | 판매 시작 후 60일 안에만 정하면 된다. 켜려면 코드 변경(Edge 전달 키) 필요 |
| 거래기록 보존기간 정책 승인 | 승인 전이라 자동 파기 안 함 | 법률 검토와 함께 관리자 화면에서 승인 |
| 탈퇴 시 남은 보관 상품 | 배송·포인트 환급으로 정리해야 탈퇴 가능(쿠지는 환급 불가) | 첫 출시는 가챠만이라 출시 후 결정 |
| 관리자 2단계 인증 방식 | 없음 | Cloudflare Access 등 |
| 글 필터 연락처 차단 범위 | 교환·신청방에서 링크·전화번호 차단 | 유지, 오탐 생기면 조정 |

## 순서 의존성

```
운영 반영(1) → 상품 준비(2) ─────────────────────┐
친구 계정(3) → 로그인 검수(4) → 판매판 빌드(7) ───┤
법률 질문지·자문(5) → 정책 새 버전 ──────────────┼→ LIVE 전환(8)
Google Play 정책 문의(5-4) ──────────────────────┤
KG이니시스 승인 → 테스트 채널 검증(6) ───────────┘
```
가장 오래 걸릴 일은 KG이니시스 승인, 법률 자문, Google Play 회신이다. 셋 다 지금 바로 시작할 수 있으니 먼저 요청해 둔다.
