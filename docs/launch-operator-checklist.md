# 출시 운영자 실행 순서 (KG이니시스 승인 제외)

운영자 컴퓨터(운영 DB·Supabase CLI·Cloudflare·Expo 계정 접근이 있는 곳)에서 위에서부터 차례로
실행한다. 각 단계의 "확인"이 통과하지 않으면 다음 단계로 넘어가지 않는다. 비밀값은 출력·공유하지 않는다.

2026-10-06 공개 API로 확인한 운영 상태: `PRELAUNCH`, 정책 버전 `2026-09-30`, 로그인
KAKAO·NAVER·GOOGLE·APPLE, 가챠 8개 모두 `COMING_SOON`, `/v1/auth/store-review` 404(새 코드 미배포).
운영 DB는 기록상 `0082_commerce_retention_components`까지 적용되어 있다.

## 1. 최신 main 준비

```
git pull
corepack pnpm install --frozen-lockfile
corepack pnpm run build:all
corepack pnpm run db:release-source:check      # 확인: "blockers": []
```

## 2. 운영 DB 백업 → 마이그레이션 0083~0087

```
node ops/database/backup.mjs backup /절대경로/archive.dbbenc /절대경로/key-file
node ops/database/backup.mjs verify /절대경로/archive.dbbenc /절대경로/key-file   # 확인: archive-authenticated
corepack pnpm run db:migrate     # 확인: Applied 5 migration(s).
corepack pnpm run db:migrate     # 확인: Database schema is current.
corepack pnpm --filter @dabboba/db check:release   # 확인: "blockers": [] — 출력의 targetHash를 기록
```

- 0083은 기록 정리 평가 함수만 바꾼다. 0084는 `payments`에 결제 채널 기록 컬럼·불변 트리거를, 0085는 `sessions`에 심사 마감 컬럼을 추가한다.
- 0086은 `account_deletion_requests`에 포인트 소멸 동의 금액 컬럼을, 탈퇴 회원의 배송지·문의 내용을 따로 두는 소유자 전용 테이블과 분리 함수를 추가한다. 이 테이블은 API·관리자·워커 어느 역할도 읽을 수 없다.
- 0087은 미사용 뽑기 부분 환불 요청·계획 테이블(`partial_unused_draw_refunds`)을 추가한다.
- 다섯 마이그레이션 모두 기존 데이터를 바꾸지 않는다. API·워커가 0084~0087을 사용하므로 반드시 이 단계 다음에 배포한다.

## 3. 서버(Edge) 배포 — PRELAUNCH 유지

```
corepack pnpm run supabase:edge:deploy          # 사전검사·빌드·배포·공개 API 검사까지 수행
corepack pnpm run supabase:edge:public:verify   # 확인: commerceMode PRELAUNCH
corepack pnpm run release:edge:worker:verify    # 확인: GET 405, 익명 POST 401
```

- 프로젝트에 LIVE 결제 비밀값이 남아 있으면 이 명령은 거부한다(정상). 그때는 `docs/live-cutover-runbook.md`를 따른다.

## 4. 관리자 웹(admin.dabboba.net) 재배포

```
cd apps/admin
corepack pnpm run build:cloudflare     # 비밀값 혼입·금지 대상 검사 포함
corepack pnpm exec wrangler deploy --dry-run        # 확인 후 (apps/admin/wrangler.jsonc 사용)
corepack pnpm exec wrangler deploy --keep-vars      # 기존 Secret/환경값 유지
```

- 공개 웹(dabboba.net, `/review` 포함)은 main 병합 시 Cloudflare Pages가 자동 배포한다. Pages 대시보드에서 최신 커밋 배포 성공을 확인한다.

## 5. 워커 자동 실행(Cron) 켜기

```
corepack pnpm run supabase:worker:schedule <2단계 check:release의 targetHash>
```

- 1분마다 `dabboba-worker`를 호출하는 `dabboba-worker-every-minute` 작업과 Vault 비밀값을 설정한다.
- 확인: Supabase 대시보드 → Cron 작업 실행 기록이 성공으로 쌓이는지, 워커 로그에 탈퇴 처리·대사·만료 정리가 도는지.
- 기록 정리(retention)는 `WORKER_COMMERCE_RETENTION_MODE` 기본값 `DISABLED`로 계속 꺼져 있다. 보존기간 정책 승인 전에는 켜지 않는다.
- 보관기한 알림·만료 보류·만료 교환 정리도 `WORKER_INVENTORY_STORAGE_EXPIRY_MODE` 기본값 `DISABLED`로 꺼져 있다. Edge 워커는 이 값을 전달하지 않으므로 Cron을 켜도 돌지 않는다. 정책을 승인한 뒤 코드 변경(전달 키 추가)으로만 켠다.
- Cron이 켜져야 15분 넘게 결제하지 않은 주문·배송비 신청이 자동 취소되고 재고·포인트·보관함이 돌아온다. LIVE 전에 반드시 켠다.

## 6. 판매 준비 (관리자 화면)

1. 가챠 8개 각각: 경품 구성·수량 검수 → 확률표 초안 게시(ACTIVE) → 재고 확인.
2. 먼작귀·산리오 구성 명칭 확인(`docs/prelaunch-five-track-readiness-2026-09-30.md`).
3. PRELAUNCH 동안에도 `ON_SALE`로 열어 둘 수 있지만 결제는 LIVE 전까지 막혀 있다. LIVE 검증은 구매 가능한 가챠 1개 이상, 판매 중 쿠지 0개를 요구한다.

## 7. 스토어 심사자 로그인 열기 (`docs/store-review-login.md`)

1. Supabase 운영 Auth에 심사 전용 사용자(전용 이메일·긴 무작위 비밀번호·이메일 확인 완료) 생성, UUID 기록.
2. 운영 Edge 프로필에 `DABBOBA_API_STORE_REVIEW_LOGIN_ENABLED/EMAIL/SUBJECT/EXPIRES_AT`(30일 이내) 추가.
3. `corepack pnpm run supabase:edge:deploy` → 확인: `GET /v1/auth/store-review`가 `{"enabled":true,…}`.
4. 새로 설치한 앱에서 "앱 심사용 계정으로 로그인" 로그인·로그아웃 확인.
5. App Store Connect 앱 심사 정보, Play Console 앱 액세스에 아이디·비밀번호 입력. 심사 후 `ENABLED=false`로 닫는다.

## 7-1. 네이버 로그인 제공 정보 줄이기 (검수 요청 전)

`docs/customer-auth-setup.md` 4절. 네이버 개발자센터 → 내 애플리케이션 → API 설정 → 제공 정보 선택에서
이름·성별·생일·휴대전화번호를 해제하고 이메일은 추가(선택)로 둔다. 테스터 계정으로 동의 화면을 다시
캡처한 뒤에 검수를 요청한다.

## 8. 앱 빌드·스토어 제출

- 제출 자료(개인정보 라벨·Data safety·연령 등급·설명·심사 메모): `docs/store-submission-pack.md`.
- iOS: 빌드 번호는 현재 `app.json`의 5보다 커야 한다. 친구 팀으로 서명 후
  `node scripts/verify-ios-artifact-team.mjs <경로.ipa>` (Team `MCZ4884P7F`)와
  `node scripts/verify-mobile-artifact-config.mjs`로 확인.
- Android: Play Console 앱 생성, 업로드 키·Play 앱 서명 결정, 친구 계정으로 AAB 서명.
- PRELAUNCH 바이너리로는 판매할 수 없다. 판매판은 `production-live` 설정으로 새로 빌드한다
  (`scripts/check-mobile-release-config.mjs`의 LIVE 조건).
- 실기기 회귀: iPhone(TestFlight)·Android 실기기에서 SNS 로그인 4종 유지·로그아웃, 딥링크,
  상품·보관함·배송 신청, 접근성, 심사자 로그인.

## 9. 법률·정책 (`docs/legal-drafts/`)

- 정식 판매용 약관·개인정보처리방침 초안의 `[확인 필요]` 항목을 채우고 법률 검토를 받는다.
- 검토본을 `public/legal/terms`·`privacy`에 반영하고 새 정책 버전 마이그레이션을 추가하면 기존 회원에게
  재동의가 표시된다. 이 단계는 LIVE 전환 직전에 한다(현재 공개 문서는 사전오픈판 문구 때문에 LIVE 검사에 걸린다).

## 9-1. KG이니시스 테스트 채널 검증 (LIVE 전)

스테이징(`lyzcyrdiazorjaqlgblr`) 테스트 채널에서 다음을 실제로 한 번씩 확인하고 기록한다.

- 카드 결제 → 뽑기 → 결과, 미사용 주문 전액 환불(관리자) → 카드 취소·재고·포인트 복구
- 포인트+카드 혼합 주문 전액 환불 → 사용 포인트 복구
- 포인트만으로 결제한 주문 환불(관리자 포인트 주문 환불)
- 일부 뽑기를 사용한 주문의 미사용 뽑기 부분 환불: 카드 부분 취소 금액이 관리자 화면 미리보기와 같은지, 반영 후 주문이 결제 완료로 돌아오고 고객 구매 내역에 "미사용 뽑기 N장 환불"이 보이는지, 포인트 전용 주문도 포인트로만 돌아오는지
- 무료배송 미달 배송 신청 → 배송비 3,000원 결제 → 출고 가능 상태, 배송비 환불
- 결제창을 닫거나 15분 방치 → 주문·배송 신청 자동 취소(Cron 필요)

## 10. KG이니시스 승인 후 — LIVE 전환

`docs/live-cutover-runbook.md`: LIVE 프로필 작성 → `supabase:edge:live:check` →
`node scripts/deploy-supabase-live-edge.mjs --confirm=LIVE:rconfxsykttfvznakile`.
실패하면 자동으로 PRELAUNCH로 되돌아간다.

## 이 문서가 다루지 않는 것

친구 명의 계정 이전(Expo/EAS·GitHub·푸시 키·Supabase·Cloudflare·도메인·메일 소유 확인),
SNS 콘솔 검수(네이버 공개 전환, 구글·카카오 검수), 오류 추적·알림 도구 선정, 백업 외부 보관·PITR.
각 항목의 현재 상태는 `docs/friend-owned-release-accounts.md`와 `docs/dabboba-operations-runbook.md`를 따른다.
