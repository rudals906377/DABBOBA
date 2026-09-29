# DABBOBA 고객 로그인 연결 안내

## 2026-09-30 Google 테스트 계정 탈퇴 완료 · Apple 탈퇴 미검증

- 사용자가 2026-09-29 실기기에서 탈퇴 요청·삭제를 승인한 Google 테스트 계정은 운영 DB에서 유일한 `PROCESSING`/`PENDING` 탈퇴 건이었다. 2026-09-30 로컬에서 제한 역할을 사용해 **해당 요청 ID만** 선택·처리했다. 사전 점검에서 Google identity 1개, 작성 미디어 0개, 다른 탈퇴 작업 0개를 확인했고, 실행 후 탈퇴 요청 `COMPLETED`, Auth 삭제 `COMPLETED`, 로컬 사용자 `DELETED`, 이메일 제거, identity 0개, 대기 작업 0개, Supabase Auth 관리자 조회 404를 확인했다. 일반 예약·결제·재고·미디어 worker 작업은 실행하지 않았고 운영 자동 실행 플래그·Cron도 켜지 않았다.
- Apple 로그인 계정은 현재 1개이며 암호화된 refresh token도 1개 저장돼 있다. nonce 12바이트·인증 태그 16바이트·키 버전 1의 저장 형식은 확인했지만, **Apple 계정 탈퇴 요청과 Apple `/auth/revoke` 실제 응답은 시험하지 않았다.** Apple 로그인·유지·로그아웃·재로그인 성공은 이 검증을 대신하지 않는다.
- Git 밖의 옛 `../.dabboba-launch/supabase-edge.env`에는 다른 프로젝트의 Storage endpoint와 S3 키가 남아 있어 이번 탈퇴 실행에 사용하지 않았다. 현재 운영 Edge 비밀 설정의 Storage endpoint는 운영 프로젝트와 일치함을 digest로 확인했지만, 로컬 보관 파일은 그대로 두었다. 향후 미디어가 있는 계정 탈퇴를 실행하기 전에 운영 Storage 키와 버킷을 별도 검증해야 한다.

## 2026-09-30 네이버·Apple 준비 현황

- 대상은 친구 명의 운영 Supabase `dabboba-production` (`rconfxsykttfvznakile`)이다. 네이버 개발자 앱 `DABBOBA`는 아직 **개발 중**이며, 테스터 ID `dhrudals9917`은 멤버관리 저장 후 재방문해도 남았다. Supabase `custom:naver` OIDC 제공자의 callback·Client ID를 맞췄지만, WD iPhone의 초기 세 차례 시도에서는 "로그인 응답 주소를 확인하지 못했습니다"가 보였고 운영 Auth `/callback` 로그는 토큰 교환 `invalid_client`였다. 당시 브라우저 복사 명령은 Mac 클립보드가 비어 있거나 키가 아닌 문장이어서 Client Secret이 제대로 갱신되지 않은 것으로 판단했다. 운영자가 Naver Developers의 실제 Client Secret을 직접 복사해 Supabase 제공자 설정에 저장한 뒤, 2026-09-30 01:47 KST WD iPhone 네이버 로그인이 성공했다고 보고했다. 같은 시각 운영 Auth 로그에서 `Login`, `/callback`, `/token`, `/user` 완료가 확인됐다. 고객 API의 `NAVER` 공개 플래그를 다시 켰다. 앱 재실행 후 로그인 유지와 이후 로그아웃도 사용자가 확인했다. **네이버 계정의 회원탈퇴는 별도 검증이 필요하다.**
- 친구 Apple 팀의 `com.dabboba.mobile` App ID에 Sign in with Apple을 켜고 Services ID `com.dabboba.mobile.web` 및 운영 Supabase callback을 연결했다. 새 서명 키 `659HA2ZNGL`의 개인 키 파일은 Git 밖 `../.dabboba-launch/apple/AuthKey_659HA2ZNGL.p8`에 권한 0600으로 보관한다. 다운로드 폴더 원본도 아직 남아 있으며 별도 안전 보관·복구 검증 전에는 삭제하지 않는다. 파일 내용이나 Client Secret JWT는 이 문서에 기록하지 않는다. 앞서 파일을 확보하지 못한 키 `9XP2BCSRQT`는 폐기했다.
- 운영 Supabase Apple 제공자는 Services ID 우선 Client IDs, 유효한 OAuth JWT, 이메일 없는 사용자 허용으로 저장·재조회했다. 같은 32바이트 암호화 키가 API와 worker 비밀 설정에 등록됐고, worker의 Apple 폐기용 Client ID/Secret도 등록됐다. 새 개인 키로 만든 JWT는 약 2027-02-26에 만료되므로 그 전에 교체해야 한다. 새 키와 API/worker 비밀의 로컬 원본은 Git 밖 `../.dabboba-launch/apple/`에 권한 0600으로 있다. 친구 명의 비밀번호 관리자에 별도 보관하고 실제 복원 확인하는 작업은 남아 있다.
- 제한 역할의 운영 worker DB URL과 전용 호출 비밀을 Supabase Edge 비밀 설정에 등록했다. `dabboba-worker` v1을 배포했고, 무권한 POST는 401·GET은 405를 확인했다. **운영 실행 허용 플래그와 Cron은 켜지 않았으며 인증된 Edge worker 전체 실행·Apple 토큰 폐기는 검증하지 않았다.** Google 테스트 계정 한 건의 별도 제한 실행 결과는 위의 최신 기록에 있다. 결제·뽑기 PRELAUNCH 차단은 그대로다.
- Apple capability 추가 후 기존 iOS Ad Hoc·App Store 서명 프로필이 Apple Developer에서 Invalid로 보였다. 2026-09-30 두 프로필을 같은 팀·App ID·배포 인증서로 재발급했고 Apple Developer에서 Active를 확인했다. EAS의 Ad Hoc 프로필도 App Store Connect API 키로 갱신했고 WD iPhone이 포함됐다. Expo 무료 계정의 이번 달 원격 iOS 빌드 한도 때문에 원격 빌드는 시작되지 않았지만, Mac에서 PRELAUNCH 내부 IPA `../.dabboba-launch/builds/dabboba-apple-login-20260930.ipa`를 로컬 빌드해 친구 팀 `MCZ4884P7F` 서명 검증 후 WD iPhone의 다뽀바 앱 위에 설치했다. 운영 API의 `APPLE` 플래그를 켠 뒤 공개 로그인 목록은 `KAKAO,NAVER,GOOGLE,APPLE`을 반환했다. 2026-09-30 02:02 KST 사용자가 WD iPhone Apple 로그인과 앱 재실행 후 세션 유지를 확인했고, 로그아웃 후 같은 계정 재로그인도 02:06 KST 완료했다고 보고했다. 운영 Auth 로그에는 두 시도의 `Login`, `/callback`, `/token`, `/user` 완료가 있다. **Apple 계정 탈퇴와 공급자 토큰 폐기 worker의 실제 완료는 아직 별개로 검증해야 한다.** 결제·뽑기 PRELAUNCH 차단은 유지된다.

## 2026-09-29 카카오 로그인 진행 현황

친구 명의 Kakao Developers 앱 `1591356`의 Owner는 친구 계정이고 개발자 계정은 Editor다. 비즈앱 등록은 운영자가 나중에 진행하기로 했다. REST API 키에는 운영 Supabase callback `https://rconfxsykttfvznakile.supabase.co/auth/v1/callback`을 등록하고 카카오 로그인 및 OpenID Connect를 켰다. 키와 시크릿 값은 이 문서·Git·앱 번들에 기록하지 않는다.

운영 Supabase의 기본 Kakao 제공자는 `account_email`을 요청해, 비즈앱 권한이 없는 현재 카카오 앱에서 `KOE205`가 재현됐다. `Allow users without an email`만 켜서는 요청 scope가 바뀌지 않는다. 따라서 기본 Kakao 제공자는 다시 **Disabled**로 두고, `openid` scope와 `email_optional` 설정을 가진 별도 OIDC 제공자 `custom:kakao`를 **Enabled**로 만들었다. 브라우저에서 회원번호 제공에 동의한 뒤 운영 Supabase가 토큰을 발급하고 `dabboba.net`으로 복귀한 것까지 확인했다. 이는 웹 OAuth 교환 증거이며, Auth 고객 계정 생성·앱 딥링크 복귀·DABBOBA API 세션·로그아웃·탈퇴의 증거는 아니다. 테스트 복귀 URL에 토큰이 포함돼 브라우저 주소에서는 제거했지만, 해당 세션과 공급자 토큰의 서버 측 무효화는 아직 확인되지 않았다. 토큰 값은 이 문서·Git에 보관하지 않는다. 앱은 `KAKAO` 버튼이 허용될 때 `custom:kakao`를 사용하고, API는 해당 Supabase identity를 기존 `KAKAO` 도메인 제공자로 해석한다.

2026-09-29 내부 실기기 시험을 위해 상품 상세 변경과 카카오 OIDC 해석을 함께 포함한 `dabboba-api` v10을 운영 프로젝트 `rconfxsykttfvznakile`에 **코드만** 배포했다. 기존 Edge 비밀 설정·worker·결제 차단은 변경하지 않았다. 배포 전 운영 DB의 마이그레이션 76/76과 역할 경계가 읽기 전용 검사에서 통과했고, 배포 후 `/healthz`, `/readyz`가 정상이며 공개 로그인 목록은 Google만 유지했다. 친구 Apple 팀 서명의 내부 iOS 1.0.0(4) 빌드 `9222a920-d52c-41cb-a93f-618ae5ef0285`를 WD iPhone에 설치·실행했다. 그 다음 `DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS=GOOGLE,KAKAO`로 바꿔 공개 로그인 목록에 두 방식이 표시됨을 확인했다. WD iPhone에서 사용자가 카카오 로그인 완료를 보고했고, 운영 DB에서 직후 생성된 KAKAO 고객 세션 1건을 읽기 전용 집계로 확인했다. 앱 종료 후 세션 유지·카카오 로그아웃·해당 계정 탈퇴·공급자 토큰 폐기까지 검증한 것은 아니다. PRELAUNCH 결제·뽑기 차단은 유지한다.

카카오 로그인 사용 전에는 계정 연결 해제 웹훅과 회원탈퇴 처리 경계도 확인해야 한다. 향후 비즈앱 등록 후 기본 제공자로 전환하려면 동일 카카오 회원번호가 새 Supabase identity로 생길 수 있으므로 기존 고객 계정 자동 병합을 가정하지 말고 별도 마이그레이션·재로그인 검증을 먼저 한다.

## 최신 승인 방향 · 2026-09-25

첫 공개판의 고객 로그인 선택지는 **휴대폰 문자 인증, 카카오, 네이버, 구글**이며 **iPhone에는 Apple 로그인도 추가**한다. 이메일 OTP는 새 로그인 화면에서 제외한다. 기존 EMAIL/PHONE identity와 연결된 계정·거래 기록은 삭제하거나 임의 병합하지 않는다. 휴대폰 번호는 한국 010 형식을 E.164로 정규화하고 Supabase Auth의 실제 인증 완료 시각을 확인한다. 문자 인증은 CI/DI 본인확인이 아니다.

서버 환경 `CUSTOMER_AUTH_ENABLED_PROVIDERS`에는 운영 콘솔 설정과 실제 기기 검증을 통과한 방식만 넣는다. 현재 운영 프로젝트에서 공개 provider 목록이 비어 있으면 앱은 로그인 선택지를 숨긴다. SMS 공급자, Kakao/Naver/Google 개발자 앱, Apple 설정, 탈퇴 worker가 준비되지 않은 상태를 코드 테스트만으로 완료 처리하지 않는다. PRELAUNCH에서 결제·뽑기는 계속 차단한다.

웹 계정 삭제는 가입한 휴대폰 또는 기존 소셜 계정으로 재인증한다. 문자 요청은 `create_user:false`로 기존 Auth 사용자만 대상으로 하고, 계정 존재 여부와 관계없이 같은 공개 응답을 반환한다. 확인된 계정에만 단기 DABBOBA 탈퇴 세션을 발급한다. 실제 Supabase Auth 사용자 삭제와 worker 완료 상태를 조회하기 전까지 탈퇴 완료로 보고하지 않는다.

### 새 운영 프로젝트 현황과 친구 명의 계정에서 필요한 작업

2026-09-25 확인 대상은 `rconfxsykttfvznakile`이다. Supabase Auth 공개 설정에서 phone/Kakao/Google/Apple은 꺼져 있고 Naver는 제공자 목록에 없으며 `/v1/auth/providers`는 `methods: []`이다. `sms_provider`에는 Twilio가 선택돼 있지만 사용자가 확인한 Twilio Account SID·Auth Token·Message Service SID 입력란은 비어 있다. Phone 로그인과 실제 문자 발송은 불가능하며 활성화하지 않았다. Supabase의 Email 인증은 켜져 있으며 Auth identity 집계상 email 1건이 존재한다. 새 앱 로그인 선택지에서 EMAIL을 숨기는 결정은 유지하되, 해당 계정의 소유자와 대체 로그인·삭제 경로를 확인하기 전에는 Email 제공자를 전역 비활성화하거나 identity를 삭제하지 않는다. 공개 API는 `PRELAUNCH`다. CLI 기본 연결에서 이 친구 명의 프로젝트가 조회됐으며 운영 DB는 `0067_catalog_media_project_rebase.sql`까지 적용돼 있다. 탈퇴 완료에 필요한 `0068_worker_account_deletion_privileges.sql`은 아직 운영에 적용하지 않았고, 해당 두 열 권한도 없다. Edge Function 목록에는 `dabboba-api`만 있으며 탈퇴를 처리할 `dabboba-worker`와 관련 worker secret은 없다. 웹 탈퇴 화면은 HTTPS 200이지만 자동 인증 설정은 503이다. 현재 Auth 사용자 1명은 소유권이 확인되지 않았으므로 탈퇴 검증 대상으로 사용하거나 삭제하지 않는다. 명시적 승인 후 `dabboba_worker` 비밀번호만 새로 발급·교체했고, 친구 명의 DB의 제한 역할로 재접속을 확인했다. 새 자격증명은 로컬 0600 `../.dabboba-launch/supabase-production-worker.env`에 있으며 Edge에는 아직 배포하지 않았다. 과거 QA Edge profile은 보존하고 새 production profile과 분리했다.

Google Cloud `DABBOBA` 프로젝트에는 `DABBOBA Supabase Auth` 웹 OAuth 클라이언트가 생성돼 있다. 승인된 원본 `https://dabboba.net`과 Supabase callback `https://rconfxsykttfvznakile.supabase.co/auth/v1/callback`을 화면에서 확인했다. 브랜딩의 홈페이지·개인정보처리방침·약관 URL도 각각 공개 HTTPS 페이지로 저장됐다. 단, Google 앱은 아직 **외부·테스트 중**이며 테스트 사용자 0명이다. 친구 명의 운영 Supabase 설정 화면을 2026-09-25 재확인했으나 Google provider는 여전히 Disabled이고, `Client IDs` 칸에는 OAuth ID가 아닌 이메일 형식의 문자열이 입력돼 저장이 비활성화돼 있으며 Client Secret도 비어 있다. 현재 앱 내 브라우저의 Google Cloud 세션은 친구 명의 프로젝트에 접근 권한이 없는 다른 계정으로 열려 있어 자격증명을 옮기지 않았다. 친구 명의 계정으로 콘솔에 로그인한 뒤 실제 Client ID/Secret을 Supabase에 직접 저장해야 한다. 실제 로그인은 수행하지 않았으며 API의 `GOOGLE` 공개 플래그도 켜지 않았다.

태현 iPhone 16 Pro에는 2026-09-25 PRELAUNCH 내부 빌드 `1.0.0 (3)`을 등록·재서명해 설치했고, 실기기 화면에서 홈이 실행되는 것을 확인했다. 이 빌드의 커밋은 `9bd52fe`로 현재 미커밋 인증 변경은 포함되지 않는다. 설치·실행은 Google 등 고객 로그인이나 운영 탈퇴 검증의 증거가 아니다.

격리된 loopback PostgreSQL TEST DB에 `0068`까지 적용·재실행 no-op를 확인했고, 필수 통합검사 `test:integration:required`의 빌드 12/12·테스트 작업 20/20을 통과했다. DB 공유 fixture의 잠금·잔여 작업으로 인해 테스트가 서로 간섭하던 부분은 필수 검사 순차 실행과 각 테스트의 대상 범위 제한으로 수정했다. 이는 운영 migration·Edge worker 배포·실제 Auth 사용자 삭제의 증거가 아니다.

1. 친구 명의 Supabase 프로젝트의 **Authentication → Providers → Phone**에서 이미 선택된 Twilio 계정·발신번호·전송 가능 국가·비용 및 실제 전달 준비를 먼저 확인한다. 이를 모른 채 새 SMS 서비스를 중복 계약하거나 Phone을 공개 활성화하지 않는다. 준비가 확인되면 SMS OTP 길이 6자리, 유효기간 600초, 재전송 제한 60초와 요금 방지 제한/CAPTCHA를 앱·운영 설정에 맞춘다. 발송 서비스의 이름·위탁 및 국외 이전 여부를 법률 담당자에게 확인하고, 개인정보처리방침 새 버전·해시·DB 문서 증거를 먼저 게시한다. 전화번호만으로 CI/DI 실명 본인확인을 했다고 표시하지 않는다.
2. 친구 명의 Kakao Developers, Naver Developers, Google Cloud, Apple Developer에서 각각 앱/클라이언트를 만들고 Supabase callback `https://rconfxsykttfvznakile.supabase.co/auth/v1/callback`을 등록한다. Naver는 `custom:naver`/issuer `https://nid.naver.com`; iPhone Apple은 `com.dabboba.mobile`과 Apple 삭제 시 토큰 폐기 설정까지 필요하다. 각 client secret은 Supabase/서버 secret 설정 화면에만 넣고 채팅·Git에는 보내지 않는다.
3. 앱 OAuth allow list `dabboba://auth/callback**`와 웹 탈퇴 callback `https://dabboba.net/account-deletion/auth/social/callback**`을 Supabase에서 확인한다. 제공자마다 실제 기기에서 신규 로그인·재로그인·취소·앱 종료 후 복구를 통과한 뒤에만 서버의 `DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS`에 추가한다. Android는 PHONE/KAKAO/NAVER/GOOGLE, iPhone은 이에 APPLE을 더한다. EMAIL은 새 로그인 선택지에 넣지 않는다.
4. 승인받은 `dabboba_worker` 비밀번호 회전과 새 제한 역할 접속 검증은 완료했다. 검증된 로컬 전용 값만 production Edge profile에 연결하고, 새 프로젝트의 `DABBOBA_WORKER_DATABASE_URL`, `DABBOBA_WORKER_INVOKE_SECRET`, Apple 폐기 비밀을 Edge secret manager에 설정한 뒤 `dabboba-worker` 배포·1분 스케줄·인증된 유한 실행을 확인한다. 과거 QA 프로젝트의 비밀번호·secret은 재사용하지 않는다.
   - 탈퇴 worker가 실제 완료 기록을 남기려면 `0068_worker_account_deletion_privileges.sql`까지 운영 DB migration을 적용해야 한다. 로컬 PostgreSQL 통합검사에서 이 권한이 없을 때 완료 대신 재시도 상태로 남는 문제를 재현했고, 최소 열 권한을 추가한 뒤 재시도·완료·중복 실행을 통과했다. 이 로컬 검사는 운영 Supabase Auth 삭제의 증거가 아니다.
5. Cloudflare Pages의 `dabboba.net`에 새 웹 탈퇴 코드와 공개 값만 배포한다. 실제 본인 소유의 삭제 검증용 고객 계정을 명시적으로 지정한 뒤 로그인 → 서버 로그아웃 → 재로그인 → 앱/웹 탈퇴 접수 → worker 실행 → Supabase Auth 사용자 404 또는 목록 부재 → DB 탈퇴 완료·접수증 조회까지 확인한다. 소유권이 불분명한 기존 Auth 사용자를 삭제하지 않는다.

이 항목들은 **설정 절차**이지 완료 증거가 아니다. 공식 참고: [Phone Login](https://supabase.com/docs/guides/auth/phone-login), [Kakao](https://supabase.com/docs/guides/auth/social-login/auth-kakao), [Custom OAuth](https://supabase.com/docs/guides/auth/custom-oauth-providers), [Google](https://supabase.com/docs/guides/auth/social-login/auth-google), [Auth Admin 삭제](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser).

## 이전 승인 방향 · 2026-09-09 (2026-09-25에 로그인 선택지 변경됨)

당시 사용자 결정은 **카카오·네이버·구글·애플·이메일** 다섯 가지였다. 이메일은 **비밀번호 없는 인증번호 방식**이었다. 당시 휴대폰 로그인은 고객 선택지에서 제외했지만, 2026-09-25 새 결정으로 다시 포함됐다. 기존 PHONE identity, 전화번호 및 연결된 계정·주문 데이터는 삭제하지 않는다.

사용자는 **본인확인도 제외하고 SNS·이메일 연결만** 하기로 명시했다. 국내 본인확인, CI/DI 수집, 본인확인 업체 계약과 1인1계정 강제는 이번 범위에서 제외한다. SNS·이메일만으로 동일인의 여러 가입을 확실히 막을 수는 없다. 사용자가 명시적으로 연결한 수단은 동일한 DABBOBA 계정으로 사용하게 한다.

개발 순서는 기존 계정·자동 연결 안전 경계 확인 → 로그인 및 명시적 연결 DB/API·앱 구현 → 로컬 검증 → 승인된 외부 설정 → 실제 로그인/복구/취소/기기 검증이다. 외부 작업은 해당 단계에 필요한 것만 함께 확인하며 마지막에 일괄 숙제로 넘기지 않는다. 요구 확정과 구현·운영 검증 완료를 구분한다.

사용자는 후속 메시지 **“자동연결해줘”**로 Supabase의 인증된 동일 이메일 자동 연결을 승인했다. 이는 이전 수동 연결 전용·모든 다중 identity 거부 검토안을 대체한다. API는 Supabase가 같은 주체(`issuer + sub`)로 인증한 연결을 받아 기존 canonical user ID와 주문·포인트·보관함을 유지한다. 앱이 보낸 이메일 문자열이나 서로 다른 broker 주체의 이메일이 같다는 이유로 별도 DABBOBA 계정을 합치지는 않는다. 이메일이 다르거나 제공되지 않으면 로그인 상태에서 직접 연결하는 경로를 사용한다. [공식 identity linking 설명](https://supabase.com/docs/guides/auth/auth-identity-linking)

Supabase 변경 기록에서 신규 Free 프로젝트의 기본 SMTP 이메일 템플릿 제한을 확인했다. 2026-09-10 운영 프로젝트의 이메일 OTP 길이는 앱과 같은 6자리로 반영했고 실제 메일 발송도 확인했지만, 기본 발송기의 Free 제한 때문에 확인·Magic Link 템플릿 변경은 거절됐다. 코드와 `supabase/templates`에는 두 흐름 모두 `{{ .Token }}`을 표시하는 동일한 한국어 OTP 템플릿을 준비했다. 실제 적용에는 Supabase Pro 전환 또는 custom SMTP 설정이 먼저 필요하며, 적용 전까지 이메일 OTP는 출시 완료로 보지 않는다. [이메일 템플릿 변경](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)

## DBB022 · SNS·이메일 및 명시적 계정 연결 계약

이전 국내 본인확인 adapter 계획은 사용자 요청으로 **파일 생성 전 중단**했다. 해당 모듈·테스트·DB 변경은 생성되지 않았다. PortOne 결제 연동은 별도 범위이며 이 취소로 삭제하거나 변경하지 않는다.

### 사진 참고 화면과 동작

- 기존 회원정보 상세에 계정 정보와 카카오·네이버·구글·애플 연결 상태를 표시한다. 참고 사진의 실제 이름·번호는 코드나 테스트 자료에 복사하지 않는다. 기존 닉네임을 본인확인된 실명으로 표시하지 않는다.
- 스위치 켜기: 현재 계정 재인증 → 선택한 SNS 인증 → 서버 승인 저장 → 목록 재조회. 로컬 스위치만 켜서 성공으로 표시하지 않는다.
- 스위치 끄기: 확인 → 재인증 → 실제 연결 해제 → 서버 확인. 마지막 사용 가능한 로그인 수단 해제는 차단한다.
- 이메일 인증번호는 SNS OAuth 스위치와 별도 경로로 취급한다. 휴대폰 번호가 표시돼도 전화 로그인이나 국내 본인확인이 도입됐다는 의미는 아니다.
- 취소·중복 탭·인증 만료·통신 오류·부분 성공은 별도 처리하고 주문·포인트·보관함과 canonical user ID를 보존한다.

### 서버 승인 경계와 운영 활성화 조건

자동 연결 승인으로 구현을 재개한다. 먼저 다섯 로그인 방법과 broker가 연결한 동일 주체의 기존 계정 재사용을 구현·검증하고, 직접 연결·해제 화면을 뒤이어 연결한다. 실제 배포·공급자 로그인 검증과 로컬 구현 상태는 별도로 기록한다.

- 일반 로그인은 서명·issuer·audience·만료·비익명 인증 상태와 허용 공급자를 검증하고 Auth 서버의 사용자 조회로 같은 주체인지 확인한다. 여러 허용 identity가 있다는 이유만으로 거부하지 않는다. JWT의 provider 문자열·AMR이나 사용자가 수정 가능한 metadata로 현재 사용한 SNS를 추측하지 않는다.
- 동일 broker 주체의 동시 로그인도 하나의 DABBOBA 계정만 만들도록 기존 트랜잭션 잠금을 유지한다. 다른 계정에 연결된 주체, 관리자, 정지·탈퇴 계정은 거부하며 기존 주문·잔액은 이동하지 않는다.
- 직접 연결·해제는 현재 USER 세션과 같은 broker 주체의 재인증, Supabase의 실제 인증·연결·해제 및 서버 재조회를 사용한다. 로컬 상태만 바꾸거나 다른 broker 주체의 토큰으로 현재 계정 상태를 덮어쓰지 않는다.
- Supabase 자동 연결을 별도 DABBOBA 승인 identity 목록과 비교해 다시 막는 검토안은 폐기한다. 원격 연결 성공 후 앱 종료·통신 실패가 발생해도 다음 인증 시 동일 broker 주체로 안전하게 상태를 복구해야 한다.
- Supabase manual linking, Google·Apple·Naver·Kakao 설정, 이메일 인증번호 템플릿과 발송 공급자, 실제 기기 callback 검증은 코드 구현과 별도의 운영 단계다. 비용·실제 발송·운영 설정 변경은 그 단계에서 확인한다.

통합 완료 증거는 다섯 방식의 신규/재로그인, 기존 계정으로의 명시적 연결, 다른 계정 연결 거부, 마지막 수단 보호, callback 위조/재사용/만료, 동시 변경과 부분 실패, 정지·탈퇴·관리자 경계, 기존 거래 보존 및 실제 기기 복구를 포함한다. 아직 실행하지 않은 항목은 통과로 기록하지 않는다.

### 배포 순서와 기존 데이터 보존

- `0040_customer_auth_providers.sql`은 기존 공급자 제약에 APPLE·EMAIL만 추가한다. PHONE·LOCAL_ADMIN·DEV와 기존 identity/사용자/거래 데이터는 삭제하지 않는다. 운영 반영은 승인된 migration 연결로 별도 수행한다.
- `0041_customer_auth_runtime_grant.sql`은 기존 로그인 upsert에 누락된 `auth_identities.verified_at` 열 UPDATE 권한만 제한 API 역할에 추가한다. 사용자 소유권·provider·provider_subject 변경 권한은 주지 않는다. `ON CONFLICT DO UPDATE`는 최초 삽입에서도 해당 권한을 요구하므로 두 migration을 API 배포 전에 적용한다.
- 운영 DB 제약 확장 → API의 공개 키·다중 공급자 검증 준비 → 실제 공급자 시험 → 앱 배포 순서다. 개발 UI용 로컬 실행기는 의도적으로 외부 Supabase 설정을 전달하지 않으므로 그 화면의 미설정 상태가 운영 인증 완료 증거는 아니다.
- 다중 identity가 생긴 뒤 과거 세 방식 API로 되돌리면 정상 계정도 거부될 수 있다. 복구 시 호환 API를 유지하고 신규 경로 노출을 조절해야 한다. 기존 APPLE·EMAIL identity를 삭제하거나 제약을 무조건 축소하는 rollback은 하지 않는다.

## 자동 연결 1차 구현 · 2026-09-09 검증 결과

- 다섯 로그인 선택지, 이메일 인증번호 흐름, 서명 JWT와 실시간 Auth 사용자 조회를 조합한 동일 broker 주체 재사용을 로컬 코드에 반영했다. 휴대폰 로그인 UI는 제외했으며 기존 PHONE identity는 보존한다. 사진의 SNS 직접 연결·해제 스위치는 다음 구현 단계이며 아직 제공하지 않는다.
- 최종 focused 검사 53개 통과·실패 0·skip 0: config/모바일 소스 검사 28개, Auth/API Edge 16개, DB migration/runtime 권한 3개, Edge bundle/Sites 패키징 6개. 서로 중복되는 재실행은 합산하지 않았다.
- API 통합검사는 **실제 로컬 PostgreSQL + 제한 runtime 역할 + 합성 verified-broker 경계**로 실행했다. 동일 주체 동시 로그인, 카카오 계정에 구글·이메일 추가 후 동일 user ID와 1,250 포인트 보존, 이메일이 같아도 다른 주체는 별도 계정, 기존 PHONE 보존, 관리자·정지·차단·탈퇴 계정 거부를 확인했다. JWT 검사는 실제 서명과 합성 Auth HTTP 응답을 사용했으며 hosted OAuth 성공 증거가 아니다.
- 테스트 전용 `127.0.0.1:55441/dabboba_edge_test`에 0040·0041을 적용하고 각각 재실행 no-op를 확인했다. 기존 0026의 verified_at UPDATE 누락을 통합검사에서 발견해 0041로 보완했다. identity 소유권/subject UPDATE 거부와 기존 제한 역할 경계도 통과했다.
- 통합검사 fixture의 nickname 길이와 정리 절차 오류도 수정했다. 합성 사용자 ID에 한해 로컬 owner 트랜잭션으로 자동생성 기록까지 정리하며 append-only 제품 정책은 유지한다. 테스트 후 기존 사용자 수 390명으로 복구됐고 운영 데이터는 변경하지 않았다.
- config/contracts/API 빌드, 모바일 TypeScript, 보호 runtime 28개 파일 검사, 웹 빌드, Supabase API bundle 빌드가 통과했다. 웹 chunk 크기 및 기존 Fastify logging deprecation 경고는 남아 있다. 환경 파일·API/모바일 package 파일·lockfile은 이번 작업 전과 동일하다.
- SDK57 iPhone Simulator에서 다섯 선택지의 **서비스 미설정 상태 화면**을 확인했다: `output/auth-auto-link-2026-09-09/login-five-methods.png`. 실제 OAuth/OTP 발송, 개발 서명 앱·실물 기기 callback/세션 복원, hosted Auth 설정, 운영 migration/배포, 직접 연결·해제 및 계정 복구는 아직 완료 증거가 없다.

## 변경 전 구현 기준선

- 변경 전 로그인 선택은 `카카오`, `네이버`, `휴대폰번호` 세 가지였다. 최신 승인 목표는 다섯 가지이며 아래는 과거 기준선이다.
- 카카오·네이버는 native PKCE callback `dabboba://auth/callback`, 휴대폰은 한국 `010` 번호의 SMS OTP를 사용한다.
- 앱은 Supabase의 public project URL과 publishable key만 사용한다. secret/service-role key는 앱에 들어가지 않는다.
- Fastify API가 Supabase access token의 서명·issuer·audience·만료·인증 상태와 허용 provider를 확인한 뒤 별도의 DABBOBA session을 발급한다.
- 계정은 broker의 `issuer + sub`로 연결한다. 이메일이나 휴대폰 번호가 같다는 이유만으로 카카오·네이버·휴대폰 계정을 자동 병합하지 않는다.
- PostgreSQL migration `0023_customer_broker_auth.sql`에 이메일 없는 계정과 검증된 E.164 휴대폰 번호 저장 구조가 포함돼 있다.

## 사용자가 직접 해야 하는 설정

아래는 친구 명의 운영 계정에서 제공자별로 진행할 설정 안내다. 이미 존재하는 Supabase 프로젝트를 중복 생성하지 않는다. 실제 해당 단계에 도달하면 필요한 작업만 사용자와 함께 확인한다. 외부 서비스의 소유자 권한, 약관 동의, 결제수단 또는 비밀값이 필요한 부분을 코드 완료로 대신 표시하지 않는다. 비밀값은 채팅이나 Git에 붙이지 말고 배포 환경의 secret manager 또는 각 서비스 콘솔에 직접 입력한다.

### 1. Supabase project와 운영 DB 만들기

1. 서울 또는 최종 운영 지역에 Supabase project를 만든다.
2. Dashboard에서 project URL과 publishable key를 확인한다.
3. 운영 API가 사용할 제한 계정 `dabboba_runtime`의 PostgreSQL connection string을 배포 secret manager의 `DATABASE_URL`에 넣는다. worker는 별도 `dabboba_worker` 연결을 `WORKER_DATABASE_URL`로 받고, schema owner인 `postgres` 연결은 `DATABASE_MIGRATION_URL`에 별도로 보관해 단일 migration job에만 주입한다. 세 값 모두 모바일 앱에 넣지 않는다.
4. Node API 환경에는 `SUPABASE_URL`, `SUPABASE_JWT_AUDIENCE=authenticated`, `SUPABASE_PUBLISHABLE_KEY`를 넣고, 실제 콘솔 설정과 실기기 검증을 끝낸 방식만 `CUSTOMER_AUTH_ENABLED_PROVIDERS`에 쉼표로 나열한다(예: 검증된 경우 `GOOGLE`). 값이 없으면 `/v1/auth/providers`는 로그인 방식을 하나도 노출하지 않는 fail-closed 상태다. 이 public key는 사용자 JWT로 Auth 서버를 재조회하는 데 사용하며 service-role/secret key로 대체하지 않는다. Apple을 노출하려면 API와 탈퇴 worker 양쪽에 같은 `APPLE_TOKEN_ENCRYPTION_KEY`(무작위 32바이트 base64/base64url)와 `APPLE_TOKEN_ENCRYPTION_KEY_VERSION`을 넣고, worker에만 `APPLE_CLIENT_ID`와 `APPLE_CLIENT_SECRET`을 추가한다. Apple refresh token은 로그인 직후 API에서 AES-256-GCM으로 암호화되며 탈퇴 worker가 Apple revoke 성공을 확인한 뒤에만 Supabase 사용자 삭제를 진행한다. 네 값 중 일부가 없거나 복호화/폐기가 실패하면 worker는 로컬 identity와 PII를 유지한 채 재시도한다. Supabase Edge에서는 예약된 사용자 정의 이름 대신 `DABBOBA_API_SUPABASE_PUBLISHABLE_KEY`, `DABBOBA_API_CUSTOMER_AUTH_ENABLED_PROVIDERS`, `DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY`, `DABBOBA_API_APPLE_TOKEN_ENCRYPTION_KEY_VERSION`을 사용하거나 플랫폼의 기본 `SUPABASE_ANON_KEY`를 사용한다.
5. 모바일 build 환경에는 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`만 넣는다.
6. JWT signing key가 공개 JWKS로 검증 가능한 `ES256` 또는 `RS256` 비대칭 키인지 확인한다. 현재 API는 공유 secret 방식의 `HS256` 토큰을 받지 않는다.
7. 값 입력이 끝나면 담당 개발자가 Session pooler(5432)의 migration 재실행이 no-op인지, runtime 역할의 허용·차단 권한, `/readyz`, `/v1/auth/providers`를 다시 검증한다.

### 2. 공통 redirect 등록

- Supabase Auth의 redirect allow list: `dabboba://auth/callback**` (PKCE 재개용 `state`와 `sb_flow_id` query를 포함한다.)
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

카카오·네이버의 위 이메일 최소수집 설정은 기존 설정 참고다. 자동 연결은 공급자가 실제로 제공하고 인증한 이메일이 같은 경우에만 가능하다. 해당 공급자의 이메일 동의·제공 설정을 실제 연결 단계에서 확인하며, 이메일이 없거나 다르면 같은 사람이라고 추측하지 않고 직접 연결을 사용한다. 이번 로컬 코드 변경으로 공급자 콘솔의 동의 항목을 변경하지 않았다.

네이버 provider가 Supabase의 현재 Custom OAuth/OIDC 요구사항을 충족하지 못하면 중간 인증 adapter가 추가로 필요하다. client secret을 앱에 직접 넣는 방식으로 우회하지 않는다.

### 5. 구글 로그인

1. 친구 명의 Google Cloud 프로젝트를 선택하거나 새로 만든다. Google Auth Platform의 Branding·Audience·Data Access를 설정하고 `openid`, `userinfo.email`, `userinfo.profile`만 요청한다.
2. OAuth client 유형을 **Web application**으로 만들고 승인된 리디렉션 URI에 `https://rconfxsykttfvznakile.supabase.co/auth/v1/callback`을 등록한다. 웹 탈퇴 로그인에 쓸 승인된 JavaScript origin은 `https://dabboba.net`이다. 모바일 `dabboba://auth/callback`은 Google Cloud가 아니라 Supabase Auth의 Redirect URLs 허용 목록에 등록한다.
3. 발급된 Client ID와 Client Secret을 친구 명의 Supabase 프로젝트의 **Authentication → Providers → Google**에 직접 입력한다. 비밀값을 채팅·Git·Expo 앱에 넣지 않는다. 설정과 Google 심사/게시 상태를 확인한 뒤 실제 고객 소유 계정으로 로그인·앱 재실행·로그아웃·재로그인을 검증한다. 검증 전 API의 공개 `GOOGLE` 플래그는 켜지 않는다.

### 6. 휴대폰번호 로그인

Twilio 입력란은 현재 비어 있다. 친구 명의 문자 발송 서비스 계정, 대한민국 수신 가능 여부, 발신 수단과 요금을 확인한 뒤 Supabase Phone 설정에 연결한다. 실제 번호로 OTP 발송·만료·재전송·로그아웃 후 복구를 확인하기 전 Phone 로그인과 공개 API 플래그는 켜지 않는다. 문자 인증을 CI/DI 본인확인으로 표시하지 않는다.

### 7. 출시 전 운영 결정

- Supabase의 인증된 동일 이메일 자동 연결은 승인됐다. 별도 DABBOBA 계정 간의 주문·잔액 병합이나 고객센터 임의 병합은 승인되지 않았다.
- 같은 이메일이라는 이유만으로 DABBOBA 계정을 합치지 않는다. 본인확인을 제외했으므로 사람 단위 중복 가입 방지는 보장하지 않고, 로그인 상태에서 소유권을 확인한 명시적 연결을 제공한다.
- provider 또는 Supabase 사용자가 차단·삭제됐을 때 이미 발급된 DABBOBA session을 언제 폐기할지 정책과 webhook/재인증 방식을 확정한다.
- 개인정보 처리방침에 전화번호, provider 식별자, 처리 목적, 보유 기간, SMS/OAuth 처리위탁과 국외 이전 여부를 실제 계약 기준으로 적는다.
- Apple 로그인 추가는 이제 사용자 승인 목표에 포함된다. iOS 심사 기준 4.8을 충족하는 동등한 선택지와 실제 로그인·탈퇴 동작을 검증한다.

## 연결 뒤 확인할 완료 기준

- 휴대폰 문자·카카오·네이버·구글, 그리고 iPhone의 Apple 로그인으로 신규 가입과 재로그인이 성공한다. 이메일 OTP는 새 로그인 선택지에 없고 기존 계정 데이터는 보존된다.
- 외부 access token은 API에서만 검증되고, 앱에는 DABBOBA session만 남는다.
- 잘못된 issuer/audience/signature, 만료 token, 익명 계정, 지원하지 않는 provider 및 broker 조회의 주체 불일치는 거부된다. Supabase가 같은 주체로 인증한 허용 다중 identity는 같은 계정을 사용한다.
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
