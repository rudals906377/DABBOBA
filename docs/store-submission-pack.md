# 다뽀바 스토어 제출 자료 — 판매판(LIVE) 답안지

> **제출 초안 — 콘솔 입력 전 소유자 확인 필요**
>
> 이 문서는 App Store Connect와 Google Play Console에 입력할 답안을 코드에서 도출한 초안이다.
> 입력·제출·승인 기록이 아니다. 실제 서명 빌드, 운영 서버 설정, 계약과 법률 검토로 다시 대조한다.

- 대상: `production-live` 프로필로 새로 빌드한 1.0.0 판매판. 첫 출시 범위는 가챠 8개이며 쿠지 판매는 열지 않는다.
- 결제 차단 사전오픈판(PRELAUNCH)용 초안은 [`prelaunch-store-submission.md`](prelaunch-store-submission.md)에 따로 있다. 두 문서를 섞어 입력하지 않는다.
- 기준 소스: main `05f59f4`(이후 커밋 `24c1c9c`는 문서 1건 추가). 이후 데이터 흐름이나 SDK가 바뀌면 1절부터 다시 확인한다.
- 표기 규칙: `[확인 필요: …]`는 저장소만으로 알 수 없는 사실이다. `[소유자 판단 필요: …]`는 사실을 근거로 운영 주체가 결정해야 하는 선언이다.
- 비밀번호, 토큰, Secret 원문은 이 파일이나 저장소 어디에도 적지 않는다. 심사용 자격증명은 콘솔의 심사자 전용 입력란에만 넣는다.

---

## 1. 데이터 수집 실태 (코드 기준)

### 1.1 외부 SDK와 추적 여부

- 모바일 직접 의존성(`apps/mobile/package.json`)에는 분석, 오류 추적(crash), 광고, 어트리뷰션 SDK가 **없다**. Sentry, Firebase Analytics/Crashlytics, Amplitude, Mixpanel, AppsFlyer, Adjust, AdMob 같은 SDK는 의존성에도 소스에도 없다.
- 외부로 데이터를 보내는 SDK와 경로는 다음뿐이다.
  - `@supabase/supabase-js`: 로그인 broker(Supabase Auth)에 쓴다.
  - `expo-auth-session`, `expo-web-browser`: OAuth와 정책 페이지를 브라우저로 연다.
  - `@portone/react-native-sdk`: PG 결제창이다. 네이티브 설정 플러그인은 `EXPO_PUBLIC_COMMERCE_CAPABILITY=LIVE`일 때만 들어간다.
  - `expo-notifications`: Expo 푸시 토큰을 발급받는다.
- 기기 안에서만 쓰는 모듈: `expo-sqlite`, `expo-secure-store`, `expo-image-picker`/`expo-image-manipulator`, `expo-audio`(효과음 재생만).
- `react-native-webview`는 `App.tsx`에서만 import한다. 앱 진입점은 `expo-router/entry`이므로 고객 앱 경로에서 이 웹뷰 셸은 쓰이지 않는다.
- 추적(IDFA/ATT) 근거:
  - `expo-tracking-transparency`가 없고, `app.json`에 `NSUserTrackingUsageDescription`가 없다.
  - 광고 식별자를 읽는 코드가 없다.
  - 데이터를 광고 목적으로 제3자 데이터와 연결하거나 데이터 브로커에 넘기는 코드가 없다.
- 홈 상품 클릭은 익명이다. `home_product_click_events`는 상품 ID와 시각만 저장한다. 행 ID는 서버 pepper로 만든 키 해시(상품·시간 단위 중복 방지)이고, 사용자·세션·기기·IP를 저장하지 않는다.
- 서버 요청 로그는 method와 route 템플릿만 남긴다. `authorization`·`cookie`·서명 헤더와 비밀번호·토큰 본문 필드는 마스킹한다. 검색어 쿼리스트링은 이 로그에 들어가지 않는다.

### 1.2 수집·저장 데이터 목록

| # | 데이터 | 언제 / 필수 여부 | 저장·전송 위치 | 목적 | 회원탈퇴 시 처리 |
| --- | --- | --- | --- | --- | --- |
| D1 | 로그인 신원(제공자 + 제공자 subject, Supabase Auth 사용자) | 로그인 시 필수. 카카오·네이버·구글, iPhone은 Apple 추가. 휴대폰 OTP는 `DABBOBA_PHONE_LOGIN_READY=true`일 때만. 기존 EMAIL/PHONE identity는 보존 | Supabase Auth, DB `auth_identities` | 인증, 계정 연결 | `auth_identities` 삭제, Supabase Auth 사용자 삭제 |
| D2 | 이메일 | 제공자가 인증된 이메일을 줄 때만(선택적). 심사 계정은 이메일 로그인 | DB `users.email`, Supabase Auth | 계정 식별, 동일 이메일 자동 연결 | `NULL` 처리 |
| D3 | 휴대폰 번호(로그인용) | 휴대폰 OTP 로그인 사용 시 | DB `users.phone_e164`, Supabase Auth, SMS 공급자 | 로그인, 웹 탈퇴 본인 확인 | `NULL` 처리 |
| D4 | Apple refresh token | Apple 로그인 시 | DB `apple_auth_credentials`(AES-256-GCM 암호문) | 탈퇴 시 Apple 토큰 폐기 | 폐기 후 삭제 |
| D5 | 닉네임, 소개, 선호 IP, 생년월일(선택 입력) | 회원정보 수정 시. 신규 닉네임 기본값은 `다뽀바 회원` | DB `users`, `user_profiles` | 프로필 표시, 회원정보 | 닉네임 `탈퇴한 사용자`, 나머지 `NULL` |
| D6 | 세션: 토큰 digest, IP 주소, User-Agent, 만료·폐기 시각 | 로그인할 때마다 | DB `sessions` | 계정 보호, 부정 이용 방지 | 세션 폐기. worker 기본 보존은 만료·폐기 후 30일 `[확인 필요: 운영 Cron·보존 작업 가동 여부]` |
| D7 | 약관 동의 기록(정책 버전·문서 해시·시각, 동의 시 IP·User-Agent) | 로그인·재동의·웹 탈퇴 시 | DB `user_policy_acceptances`, `user_policy_acceptance_events`(IP 없음, 변경 불가) | 동의 증빙 | IP·User-Agent `NULL`, 이벤트는 보존 |
| D8 | 배송지: 수령인 이름, 휴대폰, 우편번호, 주소, 배송 메모 | 배송 신청 시 필수 | DB `default_shipping_addresses`. 배송 신청 시 `shipping_requests.address_snapshot`과 송장 정보 | 실물 배송 | 기본 배송지 삭제. 신청 스냅샷은 거래기록으로 보존. 탈퇴 완료 시 스냅샷을 소유자 전용 테이블 `deleted_account_retained_records`로 옮기고 서비스 테이블에서는 지움(0086). 보존기간 파기는 승인된 기록 정리 정책을 따름 `[확인 필요: 보존기간 정책 승인]` |
| D9 | 결제자 이름 | 카드 결제 직전 필수(KG이니시스 요구, 30바이트 이내) | 앱 → PortOne SDK → PG(`customer.fullName`, `customerId`=다뽀바 사용자 ID). 다뽀바 DB에 저장하는 코드는 없음 | PG 결제 | 다뽀바 보관 없음. PG 보관은 PG 정책을 따름 `[확인 필요]` |
| D10 | 카드 정보 | PG 결제창에서 고객이 직접 입력 | PortOne/KG이니시스(선택 채널 KCP 포함). **다뽀바 서버는 받지 않음** | 결제 | 해당 없음 |
| D11 | 주문·결제 기록(주문번호, 금액, 상태, PG 결제/거래 ID, 채널) | 구매 시 | DB `orders`, `payments`, `payment_provider_events`(정규화한 상태·금액만), 원장 | 결제 확인, 취소·환불, 중복 방지, 정산 | 법정 보존(개인정보처리방침상 5년). 탈퇴 후에는 이메일·휴대폰·닉네임을 지운 회원 번호로만 연결됨 |
| D12 | 뽑기권, 뽑기 결과, 보관함, 포인트 원장, 배송 신청 | 결제·뽑기·환급·배송 시 | DB(commerce 테이블) | 서비스 제공 | 거래기록으로 보존. 진행 중인 항목이 남아 있으면 탈퇴 접수 전 정리 필요(약관 6조). 남은 포인트는 앱에서 소멸에 동의하면 탈퇴 가능(`EXPIRE` 원장 1건) |
| D13 | 찜(관심 상품) | 선택 | DB `wishlist_items` | 기능 제공 | 삭제 |
| D14 | 1:1 문의 | 선택. 앱은 텍스트만 보냄(`mediaIds: []`) | DB `inquiries`, `inquiry_messages` | 고객지원 | 제목·내용을 `삭제된 문의…`로 대체 |
| D15 | 신청방 글과 사진(선택 1장, 앨범에서 고른 뒤 JPEG로 재인코딩) | 선택. 활성 중에는 닉네임과 함께 다른 회원에게 공개 | DB `wanted_requests`, Supabase Storage `media_assets` | 상품 신청 | 내용 대체, 사진 연결 해제·삭제 표시 |
| D16 | 교환방 게시물(제목·상세)과 제안(상품만, 자유 입력 없음) | 선택(LIVE에서만 열림). 닉네임 공개 | DB `exchange_listings`, `exchange_offers` | 교환 | 제목·상세를 `삭제된…`으로 대체 |
| D17 | 신고, 차단, 커뮤니티 정책 동의 | 선택 | DB `content_reports`, `user_blocks` | 콘텐츠 운영 | 신고 상세 `NULL`, 차단 삭제 |
| D18 | 알림 설정(교환·신청·재입고, 마케팅 SMS/이메일/푸시, 맞춤 추천 동의) | 선택 | DB `notification_preferences`와 이벤트 | 알림 발송 조건 | 삭제 |
| D19 | 푸시: 설치 ID(앱이 만든 UUID, SecureStore 보관), Expo 푸시 토큰, 플랫폼, 앱 버전, 세션 ID | 내정보 설정에서 알림 연결 시 권한 요청. 이미 허용된 기기는 로그인 상태에서 자동 동기화 | DB `push_device_tokens`. 발송 시 worker → Expo Push API(`exp.host`) → APNs/FCM, 알림 제목·본문 포함 | 계정 알림 | 삭제 |
| D20 | 계정 알림함 | 서버 이벤트 발생 시 | DB `notifications` | 알림 | 삭제 |
| D21 | 홈 상품 클릭(익명) | 홈 상품을 누를 때 자동 | DB `home_product_click_events`(상품 ID와 시각만), 30일 후 일별 합계 | BEST 배지 계산 | 개인 식별 불가 |
| D22 | 기기 로컬 전용(전송 안 함) | — | SQLite: 카탈로그·교환 캐시, 최근 검색, 최근 본 상품 50개, 초안, 업로드 대기열, 효과음·교환 규칙 설정. SecureStore: 인증 토큰, 진행 중 OTP·소셜 로그인 상태, 탈퇴 접수증, 푸시 설치 ID | 오프라인 표시, 편의 | 로그아웃이나 다른 계정 로그인 시 사용자 범위 데이터 삭제 |

### 1.3 제3자 수탁·전송처

| 상대방 | 받는 데이터 | 비고 |
| --- | --- | --- |
| Supabase (운영 프로젝트 `rconfxsykttfvznakile`) | D1–D21 전체(DB·Auth·Storage·Edge Functions) | 처리 수탁. 공식 개인정보처리방침에 이미 고지됨 |
| 소셜 로그인 제공자(카카오, 네이버, 구글, Apple) | 고객이 직접 고른 제공자와의 인증 | Supabase Auth가 제공자 프로필(이름·이메일 등)을 메타데이터로 보관하는지 `[확인 필요: 운영 auth.users 메타데이터]`. 네이버 콘솔은 현재 이름·이메일·성별·생일·전화번호를 필수로 설정해 둔 상태로 기록됨. 서버는 이 값을 읽지 않으며, 검수 전 콘솔을 식별자+이메일(선택)로 줄이는 절차가 `docs/customer-auth-setup.md` 4절에 있음 `[확인 필요: 콘솔 변경 후 동의 화면 캡처]` |
| SMS 공급자 | 휴대폰 번호, 인증번호 문자 | 휴대폰 로그인을 켤 때만 해당. Supabase에서 Twilio가 선택돼 있으나 자격증명은 비어 있는 상태로 기록됨 `[확인 필요]` |
| PortOne / KG이니시스(선택적 KCP 채널) | 결제자 이름, 다뽀바 사용자 ID, 주문 ID, 금액, 상품명, 카드 정보(PG 화면에서 직접 입력) | 결제 대행 |
| Expo Push Service → APNs/FCM | Expo 푸시 토큰, 알림 제목·본문, 알림 ID | 발송은 worker의 `EXPO_PUSH_ACCESS_TOKEN`이 설정됐을 때만 동작 `[확인 필요: 운영 설정 여부]`. `app.json`에 Android FCM 설정 파일 지정이 없음 `[확인 필요: Android 푸시 토큰 발급 가능 여부]` |
| 택배사 | 수령인, 연락처, 주소, 메모 | 코드에 택배 API 연동은 없고 송장 정보만 기록함 `[확인 필요: 실제 배송 위탁 방식과 계약]` |
| Cloudflare(dabboba.net) | 공개 웹페이지와 웹 탈퇴 요청 중계 | 앱 바깥 웹 경로 |

### 1.4 추적과 판매

- 추적: **없음**. 광고 SDK, 광고 식별자, ATT 요청, 광고 목적의 데이터 연결이나 브로커 제공 코드가 없다.
- 맞춤 추천과 마케팅 발송: 동의 저장 열(`personalized_recommendations`, `marketing_*`)과 worker의 발송 조건 검사만 있다. 이런 알림을 만드는 코드는 없다. 실제 발송을 시작하면 2절과 3절의 목적 답변을 바꿔야 한다.

### 근거

- `apps/mobile/package.json`, `apps/mobile/app.json`, `apps/mobile/app.config.js`, `apps/mobile/App.tsx`
- `apps/mobile/src/features/notifications/push-device.ts`, `apps/mobile/src/features/notifications/AccountNotificationObserver.tsx`, `apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx:422-433`
- `apps/api/src/modules/account.ts:1039-1175`(프로필·기본정보·배송지), `:1607-1665`(푸시 기기), `:2039-2056`(약관 동의 IP·UA)
- `apps/api/src/modules/customer-auth.ts:119-130`(검증된 이메일), `:298-317`(신규 사용자), `:392-404`(동의·세션 IP·UA), `:417-418`(심사 로그인)
- `apps/api/src/modules/auth.ts:237-246`(세션 IP·UA)
- `apps/mobile/src/features/checkout/PortOnePaymentScreen.tsx:409-433, 441-460`, `apps/mobile/src/features/checkout/payment-customer.ts`
- `apps/api/src/modules/portone-payments.ts:360-412`(정규화한 결제 이벤트)
- `packages/db/migrations/0001_foundation.sql`(users, sessions), `0003_commerce.sql`(payments, shipping_requests), `0004_user_account.sql`, `0023_customer_broker_auth.sql`, `0045_home_product_click_events.sql`, `0053_account_policy_and_auth_deletion.sql`, `0056_legal_acceptance_and_automatic_account_deletion.sql`, `0058_active_policy_gate_and_apple_revocation.sql`, `0059_expo_push_delivery.sql`, `0084_portone_card_channel_binding.sql`
- `apps/api/src/modules/home-catalog.ts:379-401, 603-656`, `apps/api/src/lib/rate-limit-key.ts:119-121`
- `apps/api/src/app-core.ts:118-130`, `apps/api/src/lib/logging.ts:7-16`
- `apps/mobile/src/lib/local-database.ts`, `apps/mobile/src/lib/session-store.ts`, `apps/mobile/src/features/auth/supabase-broker.ts`
- `apps/mobile/src/features/profile/wanted-request-api.ts:38-58`, `apps/mobile/src/features/profile/inquiry-api.ts:49`, `apps/mobile/src/features/profile/InquiryCreateScreen.tsx:88`
- `apps/api/src/modules/exchange.ts:303, 335, 1089-1096`, `apps/api/src/modules/wanted.ts:32`, `apps/api/src/modules/community.ts:380, 424`
- `apps/worker/src/expo-push.ts:5-6, 169-180`, `apps/worker/src/config.ts:48-50, 254-267`, `apps/worker/src/notifications.ts:105-128`
- `apps/worker/src/supabase-auth-deletion.ts:252-378`(탈퇴 시 삭제·익명화)
- `docs/customer-auth-setup.md`(제공자 설정, SMS 상태), `docs/production-release-progress-2026-10-01.md`(네이버 필수 항목), `docs/portone-multi-card-channel.md`
- `public/legal/privacy/index.html`(공개 고지 범위)

---

## 2. App Store Connect — 앱 개인정보 보호(App Privacy) 답안

전제: Apple 정의상 '수집'은 기기 밖으로 보내 실시간 처리보다 오래 접근할 수 있게 하는 것이다. 결제 서비스 화면에서 입력되고 개발자가 접근하지 못하는 결제 정보는 수집에 해당하지 않는다.

**추적(Data Used to Track You): 없음.** 아래 모든 항목의 '추적에 사용'은 `아니요`다.

| Apple 데이터 유형 | 수집 | 사용자와 연결 | 목적 | 근거·메모 |
| --- | --- | --- | --- | --- |
| 연락처 정보 — 이름 | 예 | 예 | 앱 기능 | D8 배송 수령인, D9 결제자 이름(PG 전달) |
| 연락처 정보 — 이메일 주소 | 예 | 예 | 앱 기능 | D2. 제공자가 이메일을 줄 때만 저장 |
| 연락처 정보 — 전화번호 | 예 | 예 | 앱 기능 | D8 배송 연락처, D3 휴대폰 로그인(활성 시) |
| 연락처 정보 — 물리적 주소 | 예 | 예 | 앱 기능 | D8 |
| 연락처 정보 — 기타 | 아니요 | — | — | |
| 건강 및 피트니스 | 아니요 | — | — | |
| 금융 정보 — 결제 정보 | 아니요 `[소유자 판단 필요: PG 예외 적용 확인]` | — | — | D10. 카드는 PG 화면에서 입력하며 다뽀바 서버는 받지 않음 |
| 금융 정보 — 신용 정보 | 아니요 | — | — | |
| 금융 정보 — 기타 | 아니요 `[소유자 판단 필요: 현금화 불가 앱 포인트를 이 유형으로 볼지]` | — | — | D12 포인트 원장 |
| 위치(정밀·대략) | 아니요 | — | — | 위치 권한과 IP 기반 위치 추정 코드 없음 |
| 민감한 정보 | 아니요 | — | — | |
| 연락처(주소록) | 아니요 | — | — | |
| 사용자 콘텐츠 — 이메일 또는 문자 메시지 | 아니요 | — | — | |
| 사용자 콘텐츠 — 사진 또는 비디오 | 예 | 예 | 앱 기능 | D15 신청방 사진(선택) |
| 사용자 콘텐츠 — 오디오 | 아니요 | — | — | 마이크 권한 비활성 |
| 사용자 콘텐츠 — 게임플레이 콘텐츠 | 아니요 | — | — | |
| 사용자 콘텐츠 — 고객 지원 | 예 | 예 | 앱 기능 | D14 1:1 문의 |
| 사용자 콘텐츠 — 기타 | 예 | 예 | 앱 기능 | D5 소개, D15 신청 글, D16 교환 게시물, D17 신고 사유 |
| 검색 기록 | 아니요 `[확인 필요: Supabase 플랫폼 로그가 요청 URL의 검색어를 보관하는지]` | — | — | 최근 검색은 기기 SQLite에만 있음 |
| 방문 기록 | 아니요 | — | — | 최근 본 상품은 기기에만 있음 |
| 식별자 — 사용자 ID | 예 | 예 | 앱 기능 | 다뽀바 사용자 UUID, 제공자 subject |
| 식별자 — 기기 ID | `[소유자 판단 필요]` 예 권장 | 예 | 앱 기능 | D19 설치 UUID와 Expo 푸시 토큰이 계정·세션에 연결됨 |
| 구입 항목 — 구입 내역 | 예 | 예 | 앱 기능 | D11, D12 |
| 사용 데이터 — 제품 상호작용 | 예 | 예 | 앱 기능 | D13 찜, 신청방 좋아요(연결), D21 홈 클릭(익명). 하나라도 연결되면 '연결'로 답함 |
| 사용 데이터 — 광고 데이터 | 아니요 | — | — | |
| 사용 데이터 — 기타 | 아니요 | — | — | |
| 진단 — 충돌 데이터 | 아니요 | — | — | 충돌 SDK 없음. App Store Connect 기본 충돌 보고는 Apple이 수집 |
| 진단 — 성능 데이터 | 아니요 | — | — | |
| 진단 — 기타 | 아니요 `[소유자 판단 필요]` | — | — | 앱이 진단 데이터를 보내는 코드는 없음. 서버 보안 기록은 아래 '기타 데이터 유형'에서 판단 |
| 주변 환경 / 신체 | 아니요 | — | — | |
| 기타 데이터 유형 | 예 | 예 | 앱 기능 | D5 생년월일(선택). D6·D7 IP 주소·User-Agent 보안 기록을 여기에 포함할지 `[소유자 판단 필요]` |

목적은 모두 '앱 기능(App Functionality)'이다. Apple 정의상 인증, 기능 제공, 부정 방지, 보안, 고객지원이 여기에 포함된다. 현재 코드에는 분석, 개발자 광고·마케팅, 제품 개인화, 제3자 광고 용도가 없다. 마케팅 알림이나 맞춤 추천을 실제로 시작하면 해당 데이터 유형에 '개발자 광고 또는 마케팅'이나 '제품 개인화'를 추가한다.

### 근거

- 1절 D1–D22와 그 근거 목록
- `apps/mobile/app.json`(권한: `cameraPermission:false`, `microphonePermission:false`, 사진 보관함 설명 문구, ATT 관련 키 없음)
- [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)(수집·추적·결제 정보 예외·목적 정의)
- `docs/mobile-store-release.md` "Policy, support, deletion, and operational blockers"(분석·광고 SDK를 추가하지 않는 첫 출시 방침)

---

## 3. Google Play — 데이터 보안(Data safety) 답안

Google 기준 공유 예외는 서비스 제공자(수탁), 법적 요청, 사용자가 시작한 전송, 완전 익명화 데이터다. 결제 서비스가 금융 정보를 직접 수집하고 앱이 접근하지 않으면 공개 대상이 아니다.

### 개요 문항

| 문항 | 답 | 근거 |
| --- | --- | --- |
| 필수 사용자 데이터 유형을 수집하거나 공유하나요? | 예(수집). 공유는 아니요 — 모든 전송처가 서비스 제공자 예외 `[소유자 판단 필요: 택배사·PG를 수탁자로 계약했는지]` | 1.3 |
| 전송 중 암호화 | 예 | 운영 빌드는 API·Supabase·정책 URL에 HTTPS를 강제하고 `http:`는 개발 모드에서만 허용. Expo 푸시와 PortOne도 HTTPS |
| 데이터 삭제 요청 방법 제공 | 예 — 앱: 내정보 → 설정 → 로그아웃·회원탈퇴 / 웹: `https://dabboba.net/account-deletion` | 2절 근거, 약관 6조 |
| 계정 생성 지원 | 예(카카오·네이버·구글·Apple. 휴대폰은 조건부) | D1 |
| 독립 보안 검토 | 아니요 `[소유자 판단 필요]` | 근거 자료 없음 |

### 데이터 유형별 답안

| Play 데이터 유형 | 수집 | 공유 | 필수/선택 | 목적 |
| --- | --- | --- | --- | --- |
| 개인 정보 — 이름 | 예 | 아니요 | 필수(구매·배송 시) | 앱 기능 |
| 개인 정보 — 이메일 주소 | 예 | 아니요 | 선택(제공자가 제공할 때) `[소유자 판단 필요]` | 계정 관리, 앱 기능 |
| 개인 정보 — 사용자 ID | 예 | 아니요 | 필수 | 계정 관리, 앱 기능, 사기 방지·보안·규정 준수 |
| 개인 정보 — 주소 | 예 | 아니요 | 필수(배송 신청 시) | 앱 기능 |
| 개인 정보 — 전화번호 | 예 | 아니요 | 필수(배송 신청 시), 로그인 시 선택 | 앱 기능, 계정 관리 |
| 개인 정보 — 인종·정치·성적 지향 | 아니요 | — | — | — |
| 개인 정보 — 기타 정보(생년월일 등) | 예 | 아니요 | 선택 | 계정 관리 |
| 금융 정보 — 사용자 결제 정보 | 아니요(PG가 직접 수집) `[소유자 판단 필요]` | — | — | — |
| 금융 정보 — 구매 내역 | 예 | 아니요 | 필수(구매 시) | 앱 기능, 사기 방지·보안·규정 준수 |
| 금융 정보 — 신용 점수 / 기타 | 아니요 `[소유자 판단 필요: 앱 포인트]` | — | — | — |
| 위치 | 아니요 | — | — | — |
| 건강·피트니스 | 아니요 | — | — | — |
| 메시지 — 이메일 / SMS·MMS | 아니요 | — | — | — |
| 메시지 — 기타 인앱 메시지 | 예(1:1 문의) | 아니요 | 선택 | 앱 기능 |
| 사진 및 동영상 — 사진 | 예(신청방 첨부) | 아니요 | 선택 | 앱 기능 |
| 사진 및 동영상 — 동영상 | 아니요 | — | — | — |
| 오디오, 파일·문서, 캘린더, 주소록 | 아니요 | — | — | — |
| 앱 활동 — 앱 상호작용 | 예(찜, 좋아요, 익명 홈 클릭) | 아니요 | 찜·좋아요는 선택, 홈 클릭은 자동 | 앱 기능 |
| 앱 활동 — 인앱 검색 기록 | 아니요(기기 로컬만) `[확인 필요: 플랫폼 로그]` | — | — | — |
| 앱 활동 — 설치된 앱 | 아니요 | — | — | PortOne 플러그인은 특정 결제 앱 패키지만 `<queries>`로 기기 안에서 확인하고 전송하지 않음 |
| 앱 활동 — 기타 사용자 생성 콘텐츠 | 예(교환 게시물, 신청 글, 소개, 신고 사유) | 아니요(다른 회원 공개는 사용자 시작 전송) | 선택 | 앱 기능 |
| 앱 활동 — 기타 작업 | 아니요 | — | — | — |
| 웹 탐색 기록 | 아니요 | — | — | — |
| 앱 정보 및 성능 — 비정상 종료 로그 / 진단 / 기타 | 아니요 `[소유자 판단 필요: 서버 보안 기록(IP·UA) 분류]` | — | — | — |
| 기기 또는 기타 ID | 예(설치 UUID, Expo 푸시 토큰) | 아니요 | 선택(알림 연결 시) | 앱 기능 |

### 삭제 범위 안내 문안(콘솔 '데이터 삭제' 설명란 후보)

> 회원탈퇴를 완료하면 로그인 연결, 프로필(닉네임·소개·생년월일), 이메일·휴대폰 번호, 기본 배송지, 찜, 알림 설정, 푸시 기기 정보와 Apple 로그인 토큰을 삭제하거나 익명화합니다. 문의·교환·신청 글은 내용을 삭제 표시로 바꿉니다. 결제·주문·배송 등 법령상 보존 의무가 있는 거래기록은 계정과 분리해 정해진 기간 보관 후 파기하며, 배송지와 문의 내용은 서비스 데이터에서 지우고 별도 보관 영역으로 옮깁니다. 진행 중인 주문·배송·교환이나 보관 상품이 남아 있으면 정리 후 탈퇴를 요청할 수 있고, 남은 포인트는 앱에서 소멸에 동의하면 함께 정리됩니다.

- 웹 탈퇴 페이지는 정적 화면이 응답하지만, 자동 접수 설정이 준비되지 않으면 이메일 요청으로 안내한다. 2026-09-25 기록에서는 자동 인증 설정이 503이었다. `[확인 필요: 운영 웹 탈퇴의 실제 접수·완료 동작]`

### 근거

- 1절 전체, `apps/worker/src/supabase-auth-deletion.ts:252-378`
- `apps/mobile/src/lib/runtime-config.ts:105-125`, `scripts/check-mobile-release-config.mjs:7-38`(HTTPS 필수 변수)
- `public/legal/terms/index.html` 6조, `public/legal/privacy/index.html` 2조(보존기간), `public/legal/account-deletion/index.html`
- `worker/index.js:16-35`(공개 경로 `/privacy`·`/terms`·`/support`·`/account-deletion`·`/community-operations`)
- `docs/customer-auth-setup.md`(웹 탈퇴 상태), `docs/mobile-store-release.md`(Google 계정 삭제 요건)
- `apps/mobile/node_modules/@portone/react-native-sdk/src/plugin.ts`(패키지 `<queries>`. 설치 경로 기준)
- [Google Play 데이터 보안 섹션 안내](https://support.google.com/googleplay/android-developer/answer/10787469)

---

## 4. 연령 등급 설문 제안

### 사실 정리 (판단 전 고정)

1. 고객은 실제 돈(카드, PortOne → KG이니시스)으로 가챠 1회를 산다. 결제 후 **공개된 구성 중 실물 상품 1개가 무작위로** 정해진다. 특정 종류를 고를 수 없고, 같은 상품이 중복될 수 있다.
2. 판매판(LIVE) 상품 상세는 서버가 계산한 확률과 구성 목록을 보여준다. 확률은 남은 수량에 따라 바뀐다. 결과는 서버가 확정·기록하고, 앱은 애니메이션으로 보여주기만 한다.
3. 획득 상품은 보관함에 기록되고 실물 배송을 신청할 수 있다. 본인이 직접 뽑아 보관 중인 적격 가챠 상품만 기준가의 50%를 **현금화할 수 없는 앱 포인트**로 환급받을 수 있다. 현금 재베팅 기능은 없다.
4. 앱에 연령 확인이나 연령 제한이 없다. 생년월일은 선택 입력이며 연령 제한에 쓰지 않는다. 약관에도 연령 조항이 없다.
5. 교환방·신청방에 사용자 생성 콘텐츠가 있다(닉네임 공개, 신고·차단 가능). 사용자끼리 대화하는 기능과 광고는 없다.
6. 첫 판매 상품의 IP는 치이카와, 데스노트, 귀멸의 칼날(3종), 하츠네 미쿠, 산리오, 실바니안 패밀리다. 화면에는 캐릭터 상품 사진만 나온다.

이 앱을 "무작위가 아니다", "확정 상품 판매"라고 설명하지 않는다. 결과를 결제 뒤에 보여준다고 해서 고정 상품 판매가 되지 않는다.

### Apple 연령 등급

| 항목 | 제안 답 | 메모 |
| --- | --- | --- |
| 자녀 보호 기능 | 아니요 | |
| 연령 확인(Age Assurance) | 아니요 | 사실 4 |
| 무제한 웹 접근 | 아니요 `[확인 필요: 정책 페이지·OAuth·PG 창 외 임의 웹 이동이 없는지 서명 빌드에서 확인]` | |
| 사용자 생성 콘텐츠 | 예 | 사실 5 |
| 소셜 미디어 | 아니요 `[소유자 판단 필요]` | 닉네임 공개 게시판형 기능을 소셜로 볼지 |
| 메시지 및 채팅 | 아니요 | 1:1 문의는 운영자와의 고객지원 |
| 광고 | 아니요 | |
| 욕설·저속한 유머 / 음주·흡연·약물 | 없음 | |
| 공포·두려움 테마 | 없음 `[소유자 판단 필요: 데스노트 상품 이미지]` | |
| 의료·건강 | 없음 | |
| 성적 콘텐츠·노출 | 없음 `[확인 필요: 46종 상품 이미지 검수]` | |
| 만화·판타지 폭력 등 폭력 | 없음 `[소유자 판단 필요: 귀멸의 칼날 캐릭터 상품 이미지]` | |
| **도박(Gambling)** | `[소유자 판단 필요]` | Apple 정의: "실제 돈 … 을 사용한 베팅·내기. 복권·추첨(lotteries and raffles) 포함 가능". 사실 1과 3을 국내 법률 의견과 함께 판단한다. '예'이면 18+가 되고, 지침 5.3.4(복권·실제 금전 게임의 지역 허가·지역 제한)와의 관계도 검토해야 한다 |
| 모의 도박 | 아니요 | 돈 없이 거는 내기 기능은 없다 |
| 경연(Contests) | 아니요 | |
| 루트박스(Loot Boxes) | `[소유자 판단 필요]` | Apple 정의는 "구매용 무작위 **가상** 아이템"이고 다뽀바는 실물 상품이다. 결제 전 확률 공개(지침 3.1.1의 취지)는 LIVE에서 충족한다 |
| 예상 결과 | `[확인 필요: 콘솔이 계산하는 등급]` | 도박이 '예'이면 18+ |

### Google Play 콘텐츠 등급(IARC)

| 항목 | 제안 답 | 메모 |
| --- | --- | --- |
| 앱 카테고리 | 게임 아님. 쇼핑을 포함하는 '기타 앱 유형' `[확인 필요: 콘솔 분류 명칭]` | |
| 폭력·성·언어·약물·저속한 유머 | 없음 | Apple과 같은 판단 메모 적용 |
| 실제 금전 도박 관련 문항 | `[소유자 판단 필요]` | 사실 1·3을 그대로 답한다 |
| 모의 도박 | 아니요 | |
| 무작위 아이템 구매 관련 문항 | `[소유자 판단 필요]` | 실물 무작위 상품이라는 점을 그대로 적용 |
| 사용자 상호작용 | 예 | 교환방·신청방 |
| 위치 공유 | 아니요 | |
| 디지털 구매 | 아니요(실물 상품) `[확인 필요: 문항 정의]` | |
| 무제한 인터넷 | 아니요 | |

- **Google Play 정책 위험**: Play의 실제 금전 도박·게임·콘테스트 정책은 "실물 상품 획득 기회의 대가로 돈을 받는 유료 게임"을 위반 예시로 든다. 연령 등급 설문과 별개로 배포 가능 여부가 정해지지 않았다. 소유자는 서면 회신을 기다리지 않고 정확한 설명으로 실제 심사를 준비하기로 결정했다. 문의 초안은 `docs/google-play-paid-draw-inquiry.md`에 있다. 승인 전까지 Android 판매 가능 여부는 미확정이다.
- **대상 연령(Target audience)**: `[소유자 판단 필요]`. 앱에 연령 확인이 없다(사실 4). 13세 미만을 대상 연령에 넣으면 가족 정책 요건이 붙으므로, 실제 연령 제한 운영과 법률 의견에 맞춰 고른다.

### 근거

- `docs/gacha-sales-store-preparation-2026-10-01.md` "첫 판매 범위", "심사 담당자 안내 초안"
- `docs/google-play-paid-draw-inquiry.md`, `docs/mobile-store-release.md` "2026-09-26 launch decision — LIVE first"
- `docs/launch-step1-2026-10-01.md` "확정된 첫 판매 준비 자료"(8개 상품 ID)
- `apps/mobile/src/features/shop/ProductDetailScreen.tsx:537-545`(확률·중복 고지)
- `public/legal/terms/index.html` 3·4조, `public/legal/community-operations/index.html`
- `apps/api/src/modules/account.ts:790-802`(생년월일 선택 입력)
- [Apple 연령 등급 값과 정의](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/), [App Review Guidelines 3.1.1·5.3.4](https://developer.apple.com/app-store/review/guidelines/)

---

## 5. 심사 메모와 앱 액세스

### 제출 전 선행 조건

- 운영 Edge에 심사 로그인을 켠다: `DABBOBA_API_STORE_REVIEW_LOGIN_ENABLED/EMAIL/SUBJECT/EXPIRES_AT`. 종료 시각은 30일 이내로, 심사 기간을 덮도록 정한다.
- `GET /v1/auth/store-review`가 `enabled: true`인지 확인한다. 2026-10-06 운영 확인에서는 새 코드가 배포되지 않아 404였다.
- 새로 설치한 **제출 빌드**에서 로그인 → 탐색 → 결제 직전 → 로그아웃을 직접 확인한다.
- 심사 세션은 한 번에 최대 1일이며 종료 시각을 넘지 않는다. 시도 제한은 IP당 15분 5회다. 앱에는 심사용 아이디·비밀번호가 들어 있지 않다.
- 심사자 결제 방식: `[소유자 판단 필요: PG와 합의한 심사 결제 절차, 실제 청구 발생 여부, 취소 방법]`. 심사자에게 개인 카드 결제를 요구하지 않는다. 숨은 우회 경로를 만들지 않는다. 스테이징 PG 심사 웹(`dabboba.net/review`)은 TEST 백엔드용이므로 스토어 심사 경로로 쓰지 않는다.

### App Store Connect → 앱 심사 정보

| 필드 | 입력값 |
| --- | --- |
| 로그인 필요 | 예 |
| 사용자 이름 | `<심사용 이메일>` |
| 암호 | `<비밀번호>` — 콘솔 입력란에만 입력 |
| 연락처 이름·전화·이메일 | `[소유자 판단 필요]`. 앱 내 사업자 대표전화는 `031-947-9996`, 지원 메일은 `support@dabboba.net`. 실제 연락 가능한 담당자로 정한다 |
| 메모 | 아래 영문 메모 |
| 첨부 | 선택. 결제 → 뽑기 → 보관함 실제 흐름의 화면 녹화 `[소유자 판단 필요]` |

### Google Play Console → 앱 액세스

- '일부 기능이 제한됨'을 선택하고 사용자 인증 정보를 추가한다.
  - 이름: `App review account`
  - 사용자 이름: `<심사용 이메일>`
  - 비밀번호: `<비밀번호>`
  - 기타 안내: 아래 메모의 "How to sign in" 단락
- 정기적으로 바뀌는 인증 정보(OTP 등)는 쓰지 않는다. 심사 기간이 끝나면 `ENABLED=false`로 닫고, 다음 심사 때 비밀번호를 바꾼다.

### 심사 메모 (영문, 판매판용 갱신본)

```
App overview
DABBOBA (다뽀바) is a shopping app for physical character merchandise, operated
by 다뽀바 in the Republic of Korea. This first sales release offers eight gacha
products only. Kuji sales are not enabled; the Kuji Shop tab shows no
purchasable products.

Paid random physical items (disclosure)
A paid gacha purchase gives the buyer one physical item that is randomly
determined from the product lineup shown before purchase. It is not a
fixed-choice purchase, and duplicate items are possible. Each product page
lists the included items and the server-calculated odds, which change as the
remaining inventory changes. Our server determines and records the result
after the payment is verified; the capsule animation only presents that
recorded result ("바로 열기" skips the animation). The app never generates or
changes results locally. We disclose this paid random-result nature for your
review and do not claim that the shopping category alone settles policy
eligibility.

Payments
The items are physical goods delivered outside the app, so payment uses a
Korean card payment gateway (PortOne with KG INICIS) instead of In-App
Purchase (Guideline 3.1.3(e)). Card details are entered in the payment
gateway's window; we do not receive or store card numbers.
Review payment procedure: [OWNER TO FILL: PG-approved procedure and whether
a real charge occurs]. Please do not use a personal card.

After purchase
Obtained items appear in 보관함 (Storage). Customers can request shipping
under the shipping fee and free-shipping conditions shown in the app. For
eligible items they drew themselves and still store, they can instead return
the item for non-cash in-app points (50% of the item's reference price,
rounded down). Points cannot be exchanged for cash.

How to sign in
1. Open the 내정보 (Profile) tab and tap 로그인 (Log in).
2. At the bottom of the login screen, tap "앱 심사용 계정으로 로그인"
   (App review account login). This entry appears only during our review
   window.
3. Enter the user name and password from the review information fields,
   check the two required consent boxes (Terms of Service and Privacy
   Policy), and tap "심사용 계정으로 로그인".
This is an ordinary customer account, not an administrator account. Kakao,
Naver, Google and Sign in with Apple are offered on the same screen.

Where to look
- 가챠샵 (Gacha Shop) tab -> product -> lineup and odds -> "뽑으러 가기" ->
  checkout -> "구매하기" -> card payment window.
- 보관함 (Storage) -> obtained items, shipping request, point return, and the
  교환방 (Exchange Room) entry.
- Account deletion: 내정보 -> 설정 -> 로그아웃·회원탈퇴.
  Web: https://dabboba.net/account-deletion

User-generated content
The Exchange Room (product-for-product listings) and the Request Room
(product requests with an optional photo) contain user content. Users accept
the community policy (https://dabboba.net/community-operations) before
posting, can report content and block users from the detail screens, and
operators review reports and can hide content or restrict accounts.

Support: support@dabboba.net / https://dabboba.net/support
```

- 메모의 마지막 UGC 단락은 지침 1.2를 염두에 둔 것이다. 지침 1.2는 신고·차단·연락처와 함께 **부적절한 콘텐츠 게시를 거르는 방법**을 요구한다. 코드에는 정책 동의, 신고, 차단, 운영자 숨김·제재만 있고 자동 필터는 찾지 못했다. `[확인 필요: 사전 필터링 방식 — 없으면 운영 검토 절차를 메모에 정확히 적거나 기능 보완]`

### 근거

- `docs/store-review-login.md`(동작·준비·제출 정보·심사 후 처리), `docs/launch-operator-checklist.md` 7단계와 서두의 2026-10-06 확인 상태
- `apps/mobile/src/features/auth/LoginScreen.tsx:532-600`(심사 로그인 항목·필수 동의), `apps/mobile/src/features/profile/ProfileSessionGate.tsx`, `apps/mobile/src/components/RootFloatingTabBar.tsx:72-78`(탭 이름)
- `apps/api/src/modules/customer-auth.ts:417-418`, `apps/api/src/lib/rate-limit-key.ts`(IP 기준 제한 경로), `packages/db/migrations/0085_session_review_access_deadline.sql`
- `docs/gacha-sales-store-preparation-2026-10-01.md` "심사 담당자 안내 초안", "리뷰 계정 준비 서식"
- `apps/mobile/src/features/profile/ProfileMemberDetailScreen.tsx`(회원탈퇴 경로 문구), `public/legal/terms/index.html` 4·6조
- `apps/api/src/modules/exchange.ts:1089-1110`(정책 동의 확인), `apps/api/src/modules/community.ts:380, 424, 471`(차단·신고·운영 조치)
- `apps/mobile/src/features/profile/business-information.ts`, `worker/index.js`(`/review`는 TEST 백엔드 고정)

---

## 6. 스토어 등록 정보 초안

| 항목 | 초안 | 메모 |
| --- | --- | --- |
| 앱 이름 | `DABBOBA` | ASC 앱 `6815146511`에 이미 등록된 이름과 대조 `[확인 필요]`. 대안 `다뽀바 DABBOBA` `[소유자 판단 필요]` |
| iOS 부제 후보 | ① `캐릭터 실물 굿즈 쇼핑`(12자) ② `캐릭터 가챠 실물 굿즈 쇼핑`(15자) ③ `좋아하는 캐릭터 가챠 굿즈`(14자) | 사전오픈판 부제 `가챠·쿠지 상품을 한곳에서`는 쿠지 미판매라 쓰지 않음 |
| iOS 프로모션 텍스트 | `좋아하는 캐릭터의 실물 가챠 상품을 살펴보고, 상품 구성과 확률 안내를 확인한 뒤 구매해 보세요. 획득한 상품은 보관함에 모아 배송을 신청할 수 있어요.`(85자) | |
| Play 짧은 설명 | `캐릭터 가챠 상품을 살펴보고, 실물 굿즈 구매부터 보관·배송 신청까지 다뽀바에서`(44자, Play 한도 80자) | |
| 키워드(iOS) | `가챠,캐릭터,굿즈,피규어,애니메이션,컬렉션,쇼핑`(26자) | ASC에 이미 저장된 키워드와 대조 `[확인 필요]`. 앱의 피규어 카테고리는 숨김 상태이므로 '피규어'를 상품 형태 키워드로 둘지 `[소유자 판단 필요]` |
| 기본 언어 | 한국어 | |
| 카테고리 | 기본: 쇼핑(게임으로 제출하지 않음). iOS 보조: 없음 또는 엔터테인먼트 `[소유자 판단 필요]`. Play: 쇼핑, 앱 | |
| 가격 | 무료. 상품은 별도 카드 결제 | |
| 광고 포함(Play) | 아니요 | 광고 SDK 없음 |
| 지원 URL / 이메일 | `https://dabboba.net/support` / `support@dabboba.net` | 메일 수신·발신 소유권 검증 `[확인 필요]` |
| 마케팅 URL | 비워 둠 | 별도 제품 페이지 승인 전. 루트 `https://dabboba.net/`의 용도 `[소유자 판단 필요]` |
| 개인정보처리방침 URL | `https://dabboba.net/privacy` | 현재 공개본은 사전오픈판 문구라 LIVE 전 갱신 필수(8절) |
| 약관 URL | `https://dabboba.net/terms` | Apple 표준 EULA 대신 쓸지 `[소유자 판단 필요]` |
| 계정 삭제 URL(Play) | `https://dabboba.net/account-deletion` | |
| 커뮤니티 운영정책 | `https://dabboba.net/community-operations` | 심사 메모에 사용 |
| 저작권 | `2026 다뽀바` | |
| 판매자·사업자 정보 | 상호 다뽀바 · 대표 김정미 · 사업자등록번호 508-33-01724 · 통신판매업 2026-경기파주-3579 · 경기도 파주시 한빛로 67, 208-501 · 대표전화 031-947-9996 | 앱 내 표시값. Apple 개인 Team `MCZ4884P7F`의 판매자 표시명, Play 판매자 프로필, PG 가맹 주체와 같은 사람·사업자인지 `[확인 필요]` |
| 출시 국가 | 대한민국 `[소유자 판단 필요]` | 국내 PG·배송 전제 |
| 지원 기기 | iPhone 전용(`supportsTablet:false`) | |
| 제3자 콘텐츠(Content Rights) | 예 — 캐릭터 IP 상품 사진 | 사진·판매 권한 자료 `[소유자 판단 필요]` |

### 전체 설명 (한국어, 판매판 전용)

```
DABBOBA(다뽀바)는 좋아하는 캐릭터의 실물 가챠 상품을 살펴보고 구매할 수 있는 쇼핑 앱입니다.
상품 사진과 구성 목록, 판매 안내를 확인하고 관심 상품을 찜해 보세요.

가챠 상품은 구성 목록에 포함된 실물 상품 중 하나가 무작위로 제공되는 방식입니다.
같은 상품이 중복될 수 있으며, 원하는 종류를 선택하거나 특정 결과를 보장받을 수는 없습니다.
확률은 남은 수량에 따라 달라질 수 있으니, 구매 전 상품 상세의 구성 및 확률 안내를 확인해 주세요.
결제는 카드 결제(결제대행사)로 진행되며, 결과는 결제 확인 후 서버에서 확정됩니다.

구매 후 획득한 상품은 보관함에서 확인하고 배송을 신청할 수 있습니다.
직접 뽑아 보관 중인 대상 가챠 상품은 현금이 아닌 앱 포인트 환급을 선택할 수도 있습니다.
보관 기간, 배송비와 무료배송 조건, 교환·환불 조건은 상품 안내와 약관에서 확인해 주세요.

첫 판매 버전은 가챠 상품을 제공합니다. 쿠지 판매는 준비 후 별도로 안내합니다.

고객지원: support@dabboba.net
```

- 결제·뽑기·보관·배송이 실제로 작동하는 서명 판매판에만 쓴다. PRELAUNCH 빌드에 붙이지 않는다.
- 교환방을 첫 판매판 설명에서 홍보할지 `[소유자 판단 필요]`. LIVE에서는 열려 있다.
- 글자 수 한도는 Play 짧은 설명 80자만 공식 문서로 확인했다. 앱 이름·부제·키워드·설명 한도는 콘솔 표시값으로 확인한다 `[확인 필요]`.

### 근거

- `docs/gacha-sales-store-preparation-2026-10-01.md` "콘솔 입력 초안", "판매판 설명 초안"
- `docs/prelaunch-store-submission.md`(사전오픈판 값과 저작권 표기 `2026 다뽀바`)
- `apps/mobile/src/features/profile/business-information.ts`, `scripts/check-mobile-release-config.mjs:432-462`(대표전화 일치 검사)
- `worker/index.js:16-35`, `public/legal/*/index.html`, `apps/mobile/.env.example`(공개 URL 값)
- `apps/mobile/app.json`(`supportsTablet:false`), `apps/mobile/eas.json`(`ascAppId` `6815146511`)
- `docs/production-release-progress-2026-10-01.md`(ASC 저장 상태, Play 앱 레코드 없음)
- `AGENTS.md` "Release Account Ownership — 2026-09-22", "First Launch Scope And Product Gallery — 2026-10-01"

---

## 7. 스크린샷 목록

### 캡처할 화면 (실제 설치한 판매판에서만)

1. 홈: 실제 운영 상품과 실제 공지. 허구의 구매·당첨 기록 없음.
2. 가챠샵: 실제 상품 2열 목록, 찜·검색, 서버 수량과 판매 상태.
3. 상품 상세: 대표 슬라이드, 구성, 가격, 실제 확률·판매 안내.
4. 구매 흐름: 검증된 결제 수단, 최종 금액, 고객 동의. 실제 개인정보와 카드 정보는 가림.
5. 결과·보관함: 승인된 실증 주문의 결과만 사용. 가짜 당첨 화면 금지.
6. 배송 신청 / 내정보: 실제 제공하는 동작만. 테스트 고객 주소 노출 금지.

- 쿠지샵은 구매 가능한 것처럼 보이게 찍지 않는다. PRELAUNCH 화면, 임시 UI, `테스트`·`DEMO` 표시가 있는 화면은 쓰지 않는다.
- 아직 네이티브 판매판 실기기 캡처는 없다.

### 규격

| 스토어 | 크기·형식 | 메모 |
| --- | --- | --- |
| App Store — iPhone 6.9" | 세로 1260×2736, 1290×2796, 1320×2868 px. JPEG/PNG, 크기별 1–10장 | iPhone 앱에 필수 |
| App Store — iPhone 6.5" | 세로 1242×2688, 1284×2778 px | 6.9"를 제공하면 필수 아님. 콘솔이 다른 크기를 추가로 요구하는지 `[확인 필요]` |
| App Store — iPad | 해당 없음 | `supportsTablet:false` |
| Google Play — 휴대전화 | 9:16 세로, 각 변 320–3840 px, JPEG 또는 알파 없는 24비트 PNG, 2–8장. 추천 노출 자격은 1080 px 이상 4장 이상 | |
| Google Play — 그래픽 이미지 | 1024×500, JPEG 또는 알파 없는 24비트 PNG(필수) | 저장소에 파일 없음 `[확인 필요: 제작]` |
| Google Play — 앱 아이콘 | 512×512, 32비트 PNG, 1024KB 이하 | 승인 원본 `design-assets/app-icons/dabboba-wordmark-capsule-horizontal-final-source.png`(1254×1254)에서 만든다. 512 파일은 저장소에 없음 `[확인 필요]`. `dabboba-developer-icon-256.png`는 SNS 개발자 콘솔용이다 |

### 근거

- `docs/gacha-sales-store-preparation-2026-10-01.md` "실제 설치 후 캡처 목록"
- `apps/mobile/app.json`, `design-assets/app-icons/README-launcher-icon.md`
- [Apple 스크린샷 규격](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/), [Google Play 미리보기 애셋 안내](https://support.google.com/googleplay/android-developer/answer/9866151)

---

## 8. 제출 전 체크리스트

### 빌드 식별자

- [ ] iOS: `apps/mobile/app.json`의 `ios.buildNumber`는 현재 `"5"`이고, `1.0.0 (5)`는 이미 ASC에 업로드됐다. 판매판은 **6 이상**으로 올린 뒤 커밋한다. `eas.json`이 `appVersionSource: "local"`, `requireCommit: true`라서 커밋되지 않은 번호로는 빌드할 수 없다.
- [ ] Android: `versionCode`는 `1`이다. Play 앱 레코드는 아직 없다. 같은 Play 앱에 올린 적 있는 값보다 커야 한다 `[확인 필요: 첫 업로드 전 기존 업로드 여부]`.

### 판매판 빌드와 설정 검사

- [ ] 빌드 프로필은 `production-live`(`EXPO_PUBLIC_COMMERCE_CAPABILITY=LIVE`)만 쓴다.
  - PRELAUNCH 바이너리로는 판매할 수 없다. `app.config.js`가 LIVE가 아닐 때 PortOne 네이티브 플러그인을 빼고, 서버 설정만 바꿔서는 PRELAUNCH 바이너리가 결제 가능해지지 않는다.
- [ ] LIVE 환경값으로 `corepack pnpm run release:mobile:check`를 통과한다(`scripts/check-mobile-release-config.mjs`).
  - 필수 공개 변수 8개와 `EXPO_PUBLIC_PORTONE_STORE_ID`·`EXPO_PUBLIC_PORTONE_CHANNEL_KEY`
  - `DABBOBA_COMMERCE_MODE=LIVE`, `PAYMENT_PROVIDER=PORTONE_V2_INICIS`, `PORTONE_CHANNEL_ENVIRONMENT=LIVE`
  - 승인된 API 호스트, 약관·개인정보처리방침에 사전오픈 문구 없음, 사업자 유선 대표전화 일치
- [ ] `corepack pnpm run release:mobile:api:verify`를 통과한다. LIVE는 소셜 4종 로그인, 구매 가능한 가챠 1개 이상, 판매 중 쿠지 0개를 요구한다. PHONE은 `DABBOBA_PHONE_LOGIN_READY=true`일 때만 요구한다.
- [ ] LIVE 서버 사전검사는 `docs/live-cutover-runbook.md`를 따른다(`supabase:edge:live:check`).

### 서명 산출물 검사

- [ ] iOS: `node scripts/verify-ios-artifact-team.mjs <경로.ipa>`. Team `MCZ4884P7F`, `MCZ4884P7F.com.dabboba.mobile`, `get-task-allow` false, App Store 프로필인지 확인하고 Team `52HC8BV2BL`이면 거부한다.
- [ ] 공통: `node scripts/verify-mobile-artifact-config.mjs <ipa|apk|aab|export 디렉터리> [--platform ios|android]`로 컴파일된 공개 설정과 금지 표식을 확인한다.
- [ ] 생성된 네이티브 매니페스트·entitlement·`PrivacyInfo.xcprivacy`를 검토한다(URL scheme, 결제 앱 `<queries>`, 권한, Apple 로그인 entitlement) `[확인 필요]`.
- [ ] 수출 규정: `usesNonExemptEncryption:false` → '면제 대상 암호화만 사용'으로 답한다.

### 정책 문서·데이터 선언 정합

- [ ] `public/legal/privacy`와 `public/legal/terms`를 판매판 기준으로 갱신하고 새 정책 버전 마이그레이션을 추가한다. 현재 문서는 "사전오픈판에는 결제와 배송 신청이 제공되지 않습니다"라고 적고 있어 LIVE 검사에 걸린다. 갱신본에는 1.3의 수탁처(PortOne·KG이니시스, Expo 푸시, 택배), 결제자 이름, 생년월일, 신청방 사진, 푸시 기기 정보 고지가 필요한지 법률 검토로 정한다.
- [ ] 2·3절 답안을 서명 빌드와 운영 설정(푸시 발송 활성, 휴대폰 로그인, 네이버 동의 항목)으로 다시 대조한다.
- [ ] 심사 로그인 열기(5절)와 실기기 회귀를 끝낸다: iPhone·Android에서 SNS 4종 로그인·유지·로그아웃, 결제 복귀, 보관함·배송 신청, 회원탈퇴.

### 근거

- `apps/mobile/app.json`, `apps/mobile/eas.json`, `apps/mobile/app.config.js`
- `scripts/check-mobile-release-config.mjs:7-21, 375-396, 588-648`, `scripts/verify-mobile-public-api.mjs:40-75`, `scripts/verify-mobile-artifact-config.mjs:318-323`, `scripts/verify-ios-artifact-team.mjs`, 루트 `package.json`(`release:*` 스크립트)
- `docs/mobile-store-release.md` "2026-10-01 current preparation boundary", "Explicit automated gates", "Signed artifact and device QA"
- `docs/production-release-progress-2026-10-01.md`(`1.0.0 (5)` 업로드), `docs/launch-operator-checklist.md` 8–10단계
- `AGENTS.md` "Release Account Ownership — 2026-09-22"

---

## 부록 — 저장소 안에서 발견한 불일치

1. 공개 개인정보처리방침·약관은 사전오픈판 문구다. 결제·배송 위탁(PortOne·KG이니시스·택배)과 Expo 푸시, 결제자 이름, 생년월일, 신청방 사진, 푸시 기기 정보를 고지하지 않는다. LIVE 설정 검사는 이 상태를 거부한다(`public/legal/privacy/index.html`, `scripts/check-mobile-release-config.mjs:375-396`).
2. 개인정보처리방침은 "맞춤 추천 동의"를 처리 항목으로 적지만, 코드는 동의 값만 저장하고 맞춤 추천을 만드는 기능이 없다(`apps/worker/src/notifications.ts`).
3. 판매판 약관·개인정보처리방침 초안은 `docs/legal-drafts/`에 있으며 법률 검토 전이다. 1번의 누락 항목은 초안에 반영되어 있으나 `[확인 필요]` 항목이 남아 있다.
4. (2026-10-06 문서 정리) 네이버 콘솔은 이름·이메일·성별·생일·전화번호를 필수로 둔 상태다. `docs/customer-auth-setup.md` 4절은 이제 이 사실과, 검수 전 콘솔을 식별자+이메일(선택)로 줄이는 절차를 적는다. 콘솔 변경은 아직 하지 않았다.
5. `docs/prelaunch-store-submission.md`의 부제·짧은 설명·키워드는 쿠지를 전면에 둔다. 첫 판매 범위(가챠만, 쿠지 미판매)와 맞지 않으므로 판매판에 재사용하지 않는다.
6. `docs/google-play-paid-draw-inquiry.md`는 가챠를 "게시된 확률표에 따라" 정한다고 쓴다. 판매 준비 문서는 실제 추첨이 서버의 남은 종류별 수량에 비례하고 잔여 수량에 따라 확률이 바뀐다고 쓴다. 문의를 보낼 때는 후자 표현으로 맞춘다.
7. Apple 지침 1.2가 요구하는 '부적절한 콘텐츠 사전 필터링'에 해당하는 코드를 찾지 못했다. 신고·차단·운영자 숨김은 있다.
8. (2026-10-06 해결) 공개 약관·개인정보처리방침은 탈퇴 후 거래기록을 "계정과 분리해 보관"한다고 쓰지만, 실제로는 회원 행만 익명화하고 배송지 스냅샷을 그대로 두었으며 3년 보존 대상인 문의 내용은 덮어썼다. 0086과 워커 변경으로 탈퇴 시 배송지·문의 내용을 소유자 전용 테이블로 옮긴 뒤 서비스 테이블에서 지운다.
9. (2026-10-06 해결) 남은 포인트가 있으면 탈퇴가 영구히 막혔다. 앱 탈퇴 화면에서 잔액 전액 소멸에 동의하면 탈퇴할 수 있다. 웹 계정 삭제 페이지는 보호 파일 `worker/index.js`가 요청 본문을 `{}`로 고정해 보내므로 아직 이 동의를 보낼 수 없다(승인 필요).
10. (2026-10-06 일부 해결) 결제 화면의 취소·환불 안내는 법정 청약철회(7일)와 환급 기한(3영업일)을 고지한다. 미사용 주문 전액 환불(카드·포인트 전용·혼합)은 관리자 화면에서 가능해졌다. 일부 뽑기를 사용한 주문의 미사용분 환불은 금액 산정 기준이 정해지지 않아 아직 처리 수단이 없다.
11. (2026-10-06 해결) AGENTS.md의 "배송비 결제 검증 전 무료배송만 접수" 규칙은 이미 구현된 배송비 결제(검증 후에만 출고 가능)에 맞게 고쳤다.
12. (2026-10-06 해결) 승인되지 않은 보관기한 알림·만료 보류 자동 처리가 Cron을 켜면 바로 돌게 되어 있었다. 이제 기본 꺼짐이며 Edge 워커에서는 켤 수 없다. 만료된 상품은 보관함에 선택 불가 상태로 남는다.
