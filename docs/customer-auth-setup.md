# DABBOBA 고객 로그인 연결 안내

## 현재 코드에 완료된 범위

- 앱의 로그인 선택은 `카카오`, `네이버`, `휴대폰번호` 세 가지로 고정돼 있다.
- 카카오·네이버는 native PKCE callback `dabboba://auth/callback`, 휴대폰은 한국 `010` 번호의 SMS OTP를 사용한다.
- 앱은 Supabase의 public project URL과 publishable key만 사용한다. secret/service-role key는 앱에 들어가지 않는다.
- Fastify API가 Supabase access token의 서명·issuer·audience·만료·인증 상태와 허용 provider를 확인한 뒤 별도의 DABBOBA session을 발급한다.
- 계정은 broker의 `issuer + sub`로 연결한다. 이메일이나 휴대폰 번호가 같다는 이유만으로 카카오·네이버·휴대폰 계정을 자동 병합하지 않는다.
- PostgreSQL migration `0023_customer_broker_auth.sql`에 이메일 없는 계정과 검증된 E.164 휴대폰 번호 저장 구조가 포함돼 있다.

## 사용자가 직접 해야 하는 설정

아래 작업에는 외부 서비스의 소유자 권한, 약관 동의, 결제수단 또는 비밀값이 필요하므로 코드에서 대신 완료할 수 없다. 비밀값은 채팅이나 Git에 붙이지 말고 배포 환경의 secret manager 또는 각 서비스 콘솔에 직접 입력한다.

### 1. Supabase project와 운영 DB 만들기

1. 서울 또는 최종 운영 지역에 Supabase project를 만든다.
2. Dashboard에서 project URL과 publishable key를 확인한다.
3. 운영 API가 사용할 PostgreSQL connection string을 배포 secret manager의 `DATABASE_URL`에 넣는다. 이 값은 모바일 앱에 넣지 않는다.
4. API 환경에는 `SUPABASE_URL`, `SUPABASE_JWT_AUDIENCE=authenticated`를 넣는다.
5. 모바일 build 환경에는 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`만 넣는다.
6. JWT signing key가 공개 JWKS로 검증 가능한 `ES256` 또는 `RS256` 비대칭 키인지 확인한다. 현재 API는 공유 secret 방식의 `HS256` 토큰을 받지 않는다.
7. 값 입력이 끝나면 담당 개발자가 운영 DB migration과 `/readyz`, `/v1/auth/providers`를 다시 검증한다.

### 2. 공통 redirect 등록

- Supabase Auth의 redirect allow list: `dabboba://auth/callback`
- Kakao/Naver에 등록할 Supabase callback: `https://<project-ref>.supabase.co/auth/v1/callback`
- App scheme: `dabboba`

Expo Go는 실제 custom-scheme OAuth 출시 증거로 사용하지 않는다. provider 연결 확인은 development build, TestFlight/내부 테스트 build와 실제 iPhone·Android에서 한다.

### 3. 카카오 로그인

1. Kakao Developers에서 사업자 소유 앱을 만들고 Kakao Login을 활성화한다.
2. 위 Supabase callback URL을 허용 redirect URI로 등록한다.
3. REST API key와 필요한 client secret을 Supabase의 Kakao provider 설정에 직접 입력한다.
4. 이메일 권한은 요청하지 않고, 이메일이 없는 사용자도 로그인할 수 있게 설정한다.
5. 로그인 성공·사용자 취소·동의 철회·재로그인을 실제 테스트 계정으로 확인한다.

### 4. 네이버 로그인

1. Naver Developers에서 사업자 소유 애플리케이션을 만들고 client ID/secret을 발급한다.
2. 위 Supabase callback URL을 Callback URL로 등록한다.
3. Supabase에서 `Auto-discovery (OIDC)` 방식으로 만들고 식별자를 반드시 `custom:naver`, issuer를 `https://nid.naver.com`으로 설정한다. scope는 `openid profile`, `email_optional`은 `true`, PKCE는 활성 상태로 둔다.
4. 이메일 scope는 추가하지 않고, Naver OIDC의 stable `sub`가 Supabase 사용자 식별자에 일관되게 매핑되는지 확인한다.
5. 실제 계정으로 신규 로그인·재로그인·동의 철회·provider 응답 누락을 확인한다.

네이버 provider가 Supabase의 현재 Custom OAuth/OIDC 요구사항을 충족하지 못하면 중간 인증 adapter가 추가로 필요하다. client secret을 앱에 직접 넣는 방식으로 우회하지 않는다.

### 5. 휴대폰번호 로그인

1. 한국 번호 문자 발송이 가능한 SMS 공급자를 선택하고 계약·결제수단·발신번호 등록을 완료한다.
2. Supabase가 기본 지원하는 공급자를 사용하거나, 국내 공급자가 필요하면 Supabase Send SMS Hook을 통해 server-side 발송 adapter를 연결한다.
3. OTP 길이, 유효시간, 재전송 간격, 일일 한도, CAPTCHA/rate limit과 비용 알림을 설정한다.
4. 정상 번호, 잘못된 번호, 만료 코드, 반복 요청, 통신 장애를 실제 휴대폰으로 확인한다.

SMS OTP는 해당 번호를 현재 받을 수 있다는 확인이다. 성인·실명·CI/DI 확인이 필요한 정책에는 별도의 국내 본인확인 공급자가 필요하다.

### 6. 출시 전 운영 결정

- 카카오·네이버·휴대폰 계정은 자동 병합하지 않는다. 사용자가 로그인된 상태에서 두 수단을 다시 인증하는 별도 계정 연결 기능을 만들기 전에는 고객센터 임의 병합도 하지 않는다.
- 카카오·네이버에서 같은 검증 이메일을 쓰는 테스트 계정으로 각각 로그인해 서로 다른 DABBOBA 계정으로 유지되는지 확인한다.
- provider 또는 Supabase 사용자가 차단·삭제됐을 때 이미 발급된 DABBOBA session을 언제 폐기할지 정책과 webhook/재인증 방식을 확정한다.
- 개인정보 처리방침에 전화번호, provider 식별자, 처리 목적, 보유 기간, SMS/OAuth 처리위탁과 국외 이전 여부를 실제 계약 기준으로 적는다.
- iOS 심사 전에 Apple App Review Guideline 4.8 적용 여부를 확인한다. 적용 대상이면 현재 세 가지 선택을 유지하면서 Sign in with Apple을 추가해야 할 수 있다.

## 연결 뒤 확인할 완료 기준

- 카카오·네이버·휴대폰 각각 신규 가입과 재로그인이 성공한다.
- 외부 access token은 API에서만 검증되고, 앱에는 DABBOBA session만 남는다.
- 잘못된 issuer/audience/signature, 만료 token, 익명 계정, 지원하지 않는 provider, 여러 provider가 합쳐진 token은 모두 거부된다.
- 정지·탈퇴 계정은 로그인할 수 없고, 만료된 DABBOBA session은 앱에서 제거된다.
- OAuth 취소와 앱 cold/warm start callback이 멈춤 없이 로그인 화면으로 복귀한다.
- 실제 iPhone·Android development build에서 딥링크와 SecureStore session 복원이 확인된다.

## 공식 참고 문서

- Supabase Kakao login: <https://supabase.com/docs/guides/auth/social-login/auth-kakao>
- Supabase Custom OAuth providers: <https://supabase.com/docs/guides/auth/custom-oauth-providers>
- Naver login developer guide: <https://developers.naver.com/docs/login/devguide/devguide.md>
- Naver OIDC discovery: <https://nid.naver.com/.well-known/openid-configuration>
- Supabase phone login: <https://supabase.com/docs/guides/auth/phone-login>
- Supabase Send SMS Hook: <https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook>
- Naver Cloud SENS SMS API: <https://api.ncloud-docs.com/docs/sens-sms-send>
- Naver Cloud SENS sender registration: <https://guide.ncloud-docs.com/docs/sens-callingno>
- Supabase native mobile deep linking: <https://supabase.com/docs/guides/auth/native-mobile-deep-linking>
- Supabase JWT signing keys: <https://supabase.com/docs/guides/auth/signing-keys>
- Supabase identity linking: <https://supabase.com/docs/guides/auth/auth-identity-linking>
- Expo authentication: <https://docs.expo.dev/guides/authentication/>
- Apple App Review Guidelines: <https://developer.apple.com/app-store/review/guidelines/>
