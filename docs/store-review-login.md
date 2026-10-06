# 스토어 심사자 로그인 (App Store / Google Play)

고객 로그인은 SNS(카카오·네이버·구글·Apple)와 조건부 휴대폰 인증만 제공한다. 스토어 심사자에게
줄 계정이 없어서, 운영 프로젝트(`rconfxsykttfvznakile`)에 **심사 기간에만 열리는 전용 계정 하나**의
비밀번호 로그인을 둔다. 일반 고객용 로그인 방식이 아니며 관리자 계정을 인증하지 않는다.

## 동작

- 앱 로그인 화면은 `GET /v1/auth/store-review`가 `enabled: true`일 때만 맨 아래에
  "앱 심사용 계정으로 로그인"을 보여준다. 숨은 제스처가 아니라 보이는 항목이며, 심사 기간이
  아니면 고객에게 나타나지 않는다. 확인 요청이 실패해도 항목은 숨겨진다.
- 심사자는 아이디(이메일)와 비밀번호를 입력하고, 일반 로그인과 같은 약관 동의를 한다.
  `POST /v1/auth/store-review`가 운영 Supabase Auth의 비밀번호 확인을 거친다. 확인된 사용자의
  subject·이메일이 설정과 같고, 로그인 수단이 EMAIL 하나뿐일 때만 일반 고객(USER) 세션을 발급한다.
- 세션은 한 번에 최대 1일이고 심사 종료 시각을 넘지 않는다. 종료 시각은 세션에 저장되므로
  설정을 끄거나 기간이 끝난 뒤 세션을 갱신하려 하면 세션이 폐기된다(`REVIEW_ACCESS_ENDED`).
- 시도 제한은 IP당 15분 5회다. 앱에는 어떤 심사용 아이디나 비밀번호도 들어 있지 않다.
- API는 운영 프로젝트(PRODUCTION 등급, 고정된 Supabase URL과 DB 호스트)에서만 이 설정을 읽는다.
  스테이징의 PG 심사 로그인(`/v1/auth/payment-review`)은 운영에서 계속 닫혀 있다.

## 준비 (운영자)

1. Supabase 운영 프로젝트 → Authentication → Users에서 심사 전용 사용자를 만든다.
   - 소유자가 통제하는 전용 메일 주소를 쓰고, 이메일 확인 완료 상태로 둔다.
   - 비밀번호는 길고 무작위로 만든다. 친구의 개인 계정이나 관리자 계정을 쓰지 않는다.
   - Email 로그인 제공자가 꺼져 있으면 비밀번호 확인이 실패한다. 공개 가입은 꺼 둔 채로 둔다.
2. 그 사용자의 UUID(subject)를 확인한다.
3. 운영 Edge 프로필(`../.dabboba-launch/supabase-edge-production.env`, LIVE 중이면
   `supabase-edge-live.env`)에 넣는다:

   ```
   DABBOBA_API_STORE_REVIEW_LOGIN_ENABLED=true
   DABBOBA_API_STORE_REVIEW_LOGIN_EMAIL=<심사 전용 이메일>
   DABBOBA_API_STORE_REVIEW_LOGIN_SUBJECT=<사용자 UUID>
   DABBOBA_API_STORE_REVIEW_LOGIN_EXPIRES_AT=<30일 이내 종료 시각, 예: 2026-10-31T14:59:00Z>
   ```

   `DABBOBA_API_SUPABASE_PUBLISHABLE_KEY`도 있어야 한다. 프로필 도구는 값이 빠졌거나,
   종료 시각이 지났거나 30일보다 멀면 배포 전에 거부한다.
4. 일반 배포 명령(PRELAUNCH는 `supabase:edge:deploy`, LIVE는 `docs/live-cutover-runbook.md`)으로 반영한다.
5. 새로 설치한 제출 빌드에서 직접 확인한다: 로그인 → 상품 탐색 → (판매판이면) 결제 직전 화면 → 로그아웃.

## 스토어 제출 정보

- App Store Connect → 앱 심사 정보 → "로그인 필요"에 아이디·비밀번호를 입력한다.
- Google Play Console → 앱 액세스 → 사용자 인증 정보에 같은 정보를 입력한다.
- 심사 메모에 "로그인 화면 아래의 '앱 심사용 계정으로 로그인'을 사용"한다고 적는다.
- 비밀번호는 콘솔의 심사자 전용 입력란에만 넣는다. 저장소·채팅·문서에 남기지 않는다.
- 심사자에게 개인 카드 결제를 요구하지 않는다. 결제 시연 방법은 PG와 합의한 절차만 안내한다.

## 심사 후

- `DABBOBA_API_STORE_REVIEW_LOGIN_ENABLED=false`로 바꿔 다시 배포하거나, 종료 시각이 지나기를 기다린다.
  이후 갱신은 폐기되고 로그인 항목은 사라진다.
- 다음 심사 때는 비밀번호를 바꾸고 새 종료 시각으로 다시 연다.
- 심사 계정으로 생긴 주문·문의가 있으면 일반 고객 데이터와 같은 절차로 처리한다.
