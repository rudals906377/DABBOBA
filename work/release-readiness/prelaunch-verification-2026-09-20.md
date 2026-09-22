# DABBOBA PRELAUNCH 출시 검증 보고서

- 검증 기준일: 2026-09-20 (Asia/Seoul)
- 대상: DABBOBA `1.0.0`, iOS build `1`, Android versionCode `1`
- 출시 형태: `PRELAUNCH` 상품 탐색·검색·찜·공지·계정 중심 사전오픈판
- 기준 소스: `feat/dabboba-capsule-gacha`의 본 보고서 포함 제출 커밋
- 최종 판단: **공개 심사 제출 NO-GO**

## 1. 판단 요약

PRELAUNCH 코드 범위와 자동검증은 대부분 완료됐고, 결제·주문·추첨·재고 소비·쿠지 입장·유료 배송 신청을 사전오픈 빌드에서 차단하는 방어선도 마련됐다. 그러나 현재 결과물은 아직 App Store/Google Play에 제출할 수 없다.

차단 사유는 기능 코드보다 외부 운영 준비에 있다. 2026-09-20 초기 기준은 migration `0064`까지였고, 2026-09-22 후속 출시 소스에 공개 정책 도메인을 반영한 `0065`를 추가했다. 현재 제출 범위는 `0065`까지이지만, 운영 DB는 `0051`까지만 적용되어 있으며 검증된 로그인 제공자·최신 PRELAUNCH API/worker 배포·서명된 IPA/AAB·실기기 검증·실제 고객지원 메일함이 없다. 따라서 이 문서의 통과 항목은 **코드와 로컬 검증 통과**를 의미할 뿐, 스토어 승인 가능성을 의미하지 않는다.

## 2. 구현된 PRELAUNCH 범위

### 상거래·상품 안전장치

- 앱의 `EXPO_PUBLIC_COMMERCE_CAPABILITY`와 서버의 `DABBOBA_COMMERCE_MODE`를 함께 사용하며, 둘 중 더 제한적인 권한을 적용한다.
- PRELAUNCH에서는 주문·결제·추첨권 생성·재고 소비·포인트 결제·쿠지 입장·배송비 결제 mutation을 fail-closed 처리한다.
- 상품 판매 상태, 구매 가능 여부, 차단 사유와 가격 표시 계약을 분리했다. 공개 화면에서는 `0원`을 판매가로 사용하지 않고 예정가 또는 가격 공개 예정 상태를 사용한다.
- 쿠지샵은 빈 화면 대신 완성된 오픈예정 화면을 표시하도록 구성했다.

### 홈·상품 카탈로그

- 공지 조건부 노출, 상시 이벤트 영역, 최근 당첨 최대 2개, 관리자 지정 섹션 순서 구조를 반영했다.
- migration `0062_home_catalog_section_sources.sql`에서 관리자 섹션의 `GACHA | KUJI` 레이아웃, `MANUAL | IP | NEW | POPULAR` 소스, 수동 상품 순서, 제목·부제·노출 수를 지원한다.
- 상품 검색·정렬·필터·커서 페이지네이션과 상태별 빈 화면·오류·재시도 UI를 마련했다.
- 보관함·내정보 등은 공지 또는 다른 하위 API 실패가 화면 전체 실패로 번지지 않도록 독립 로딩·오류 경계를 사용한다.
- 영문 고정 경로 `home`, `gacha`, `kuji`, `storage`, `profile`을 Expo Router 탭과 알림 이동 경로에 연결했다.

### 로그인·정책·로그아웃·계정삭제

- 앱과 공개 웹에서 정책 문서별 명시적 동의, 현재 정책 버전과 동의 이력 계약을 사용한다.
- 이메일 OTP와 Kakao·Naver·Google·Apple 기반 웹 탈퇴 본인확인 경로를 구현했다. 탈퇴 전용 세션은 최대 15분으로 제한한다.
- 현재 기기 로그아웃, 다른 기기 세션 폐기, 사용자 전환 시 로컬 캐시 격리를 구현했다.
- 탈퇴는 preview → request → status와 idempotent worker 흐름을 사용하며, 외부 Auth 삭제 실패 시 로컬 identity를 먼저 삭제하지 않고 재시도한다.
- migration `0064_account_deletion_authored_data_cleanup.sql`에서 사용자 작성 데이터와 첨부·개인정보 정리 범위를 보강했다.

### 배송·보관·포인트

- migration `0063_shipping_quotes.sql`에서 주소 버전에 묶인 10분 배송 quote와 중복 소비 방지 계약을 추가했다.
- 무료배송 기준은 가챠만 포함 시 24,900원, 쿠지 포함 시 54,900원이며 기준 미달 배송비는 3,000원이다.
- PRELAUNCH에서는 기존 기록 조회만 허용하고 새 배송 신청과 배송비 결제를 차단한다.
- 보관 만료 60일과 만료 전 알림, 법률 검토 전 `EXPIRED_HOLD` 전환, 직접 뽑은 가챠만 허용하는 포인트 환급 규칙을 서버 기준으로 유지한다.

## 3. 검증 증거와 한계

### 3.1 코드·정적 검증 — 통과

| 검증 | 결과 |
|---|---:|
| 루트 Node 단위 테스트 | 795/795 통과 |
| 루트 TypeScript 테스트 | 6/6 통과 |
| API 테스트 | 267건 중 243 통과, 24 의도적 skip, 실패 0 |
| Worker 테스트 | 105/105 통과 |
| Admin 테스트 | 41/41 통과 |
| Mobile 구조 테스트 | 38/38 통과 |
| Contracts 테스트 | 25/25 통과 |
| 공개 사이트 테스트 | 19/19 통과 |
| Playwright 상품 소개·runtime 테스트 | 11/11 통과 |
| 전체 build 작업 | 12/12 통과 |
| 전체 typecheck 작업 | 20/20 통과 |
| 전체 package test 작업 | 20/20 통과 |
| Expo Doctor | 21/21 통과 |
| Expo 권장 의존성 검사 | 최신 권장 범위 통과 |
| iOS·Android production bundle 금칙어 검사 | 통과 |
| 운영 의존성 보안 감사 | 알려진 취약점 0건 |
| `git diff --check` | 통과 |

추가로 모바일·API·worker·admin·DB·contracts 타입검사를 통과했다. production bundle에서는 `TEST_PG`, demo session, localhost, preview route가 발견되지 않았다.

이 항목은 소스 코드와 로컬 빌드 산출물의 정적·자동 검증이다. Apple/Google 서명, 실기기 설치, 운영 자격증명, 실제 푸시·OAuth·결제 제공자 검증을 대신하지 않는다.

### 3.2 일회성 DB 통합검증 — 통과

실제 개발 DB나 보존 fixture를 변경하지 않고 새 임시 PostgreSQL에서 검증했다.

- Fresh `0000`→`0064`: 65개 migration 적용, 재실행 no-op 통과
- Upgrade `0061`→`0064`: 신규 3개 적용, 재실행 no-op 통과
- Fresh/upgrade 최종 public schema SHA-256 일치: `19dda43b…b59`
- public table 수: 90개
- DB fresh 테스트: 133/133 통과
- DB upgrade 테스트: 133/133 통과
- 계정삭제 웹 세션 15분 경계 집중 테스트: 1/1 통과
- 전체 실패 0건, skip 0건
- 임시 DB와 컨테이너 제거 완료

이 결과는 migration의 fresh/upgrade/no-op 동작과 로컬 권한 계약을 증명한다. **운영 Supabase/PostgreSQL에 migration이 적용됐다는 증거는 아니다.**

### 3.3 iOS Simulator 오류·빈 상태 검증 — 부분 통과

다음 이미지는 iOS Simulator에서 실제 앱 화면을 확인한 증거다.

- 쿠지 PRELAUNCH 오픈예정 fail-closed 화면: [`current-simulator/13-kuji-final.png`](./current-simulator/13-kuji-final.png)
- 홈 API 오류 상태·이벤트 fallback·최근 당첨 2개: [`current-simulator/14-home-final.png`](./current-simulator/14-home-final.png)
- 가챠 API 오류와 재시도: [`current-simulator/15-gacha-final.png`](./current-simulator/15-gacha-final.png)
- 내정보 독립 오류 경계: [`current-simulator/17-profile-final.png`](./current-simulator/17-profile-final.png)
- 보관함 영문 `/storage` 딥링크와 독립 오류·재시도 상태: [`current-simulator/16-storage-final.png`](./current-simulator/16-storage-final.png)
- 공개 `/home` 딥링크가 네이티브 홈 탭으로 연결되는 상태: [`current-simulator/18-home-deeplink-final.png`](./current-simulator/18-home-deeplink-final.png)

홈·가챠·내정보 화면의 오류 표시는 로컬 STAGING API/스키마를 사용할 수 없는 상태에서 fail-closed 동작을 확인한 것이다. 정상 데이터가 있는 운영 환경의 happy path 증거는 아니다.

보관함은 실제 Simulator에서 영문 `/storage` 딥링크의 unmatched route가 재현돼 영어 탭 경로로 소스를 수정했다. 수정 후 모바일 구조 테스트 38/38을 다시 통과했고 `/storage`가 보관함 탭으로 열리며 API 실패를 화면 전체 충돌 없이 재시도 가능한 오류 상태로 표시하는 것을 새 캡처로 확인했다. 공개 `/home` 경로도 네이티브 홈 탭으로 리디렉션되는 것을 별도 캡처로 확인했다. 이로써 `home`, `gacha`, `kuji`, `storage`, `profile` 다섯 영문 루트는 소스와 Simulator 수준에서 연결됐다. 서명 빌드의 콜드스타트 딥링크는 아직 별도로 검증해야 한다.

### 3.4 아직 없는 증거

- 서명된 iOS IPA와 Android AAB
- TestFlight 및 Google Play 내부 테스트 설치·승인 기록
- iOS/Android 실기기의 신규 설치 → 로그인 → 로그아웃 → 계정 전환 → 탈퇴 전체 흐름
- VoiceOver/TalkBack, 동적 글자 200%, Reduced Motion, 키보드, 소형 화면의 서명 빌드 결과
- 실제 Kakao·Naver·Google·Apple·이메일 OTP 운영 계정 검증
- APNs/FCM 권한 허용·거부, 백그라운드·종료 상태 알림 딥링크 검증
- 운영 DB migration 적용, Supabase 관리 영역을 포함한 복구 연습, 관리자 출고·송장 운영 검증
- 운영 PRELAUNCH 서버에서 상거래 mutation이 실제로 0건임을 보여 주는 배포 로그·감사 기록

## 4. 공개 제출 차단 항목

### 해결된 출시 기반

- `7fa57f9`에 migration `0064`까지의 출시 범위를 원자적 PRELAUNCH 기준으로 고정했고, 이후 커밋에서 공개 정책 사이트와 제출 방어선을 보강했다.
- 2026-09-22 현재 전체 build 12/12, typecheck 20/20, package test 20/20, Playwright 11/11, 공개 사이트 19/19를 통과했다.
- 이 보고서가 포함된 제출 커밋에서 `db:release-source:check`와 원격 PR 검사를 다시 확인한다.

### P0 — 제출 전에 반드시 해결

1. **고객지원 최종 수신·공개 발신 검증 미완료**
   - `dabboba.net`과 `www.dabboba.net`, `/privacy`, `/terms`, `/support`, `/account-deletion`의 HTTPS 공개와 `www` 리디렉션은 2026-09-22 외부 스모크 테스트를 통과했다.
   - `support@dabboba.net`은 Cloudflare Email Routing에서 활성화됐고 외부 Gmail 테스트가 전달 로그에서 `Forwarded`로 확인됐다. 다만 최종 Naver 받은편지함 도착과 `support@dabboba.net` 발신 정체성은 아직 별도 확인이 필요하다.
   - Google Play용 웹 계정삭제 요청 페이지는 유지하되, 무료 전달 주소에서 회신하면 개인 Naver 주소가 노출되므로 공개 답변 발신 수단을 정하기 전에는 고객지원 송수신 완료로 판정하지 않는다.

2. **서명 빌드·스토어 등록·실기기 검증 부재**
   - Expo 조직 `dabboba-team`의 기존 프로젝트 ID와 현재 계정의 관리·배포 권한, Android 기본 keystore, EAS Production 변수, GitHub `mobile-production` 환경은 2026-09-22 확인·구성됐다. Apple Bundle ID·배포 인증서·프로비저닝도 생성됐지만, 서명 팀은 `kyoungmin oh (Individual)`이므로 실제 서비스 소유자의 배포 계정이 맞는지 확인해야 한다. App Store Connect/Play Console 앱 레코드·제출 키와 실제 서명 빌드 증거는 아직 없다.
   - 서명 IPA/AAB에서 아이콘·adaptive mask·URL scheme·APNs·권한·Privacy Manifest·export compliance를 확인해야 한다.
   - 보관함 `/storage` 딥링크를 포함해 실기기에서 전 경로를 다시 검증해야 한다.

3. **운영 DB 및 운영 제공자 검증 부재**
   - 읽기 전용 release check 당시 운영 DB는 65개 중 52개가 일치했고 `0052`~`0064` 13개가 대기 중이었다. 이후 `0065_legal_policy_dabboba_net.sql`이 출시 소스에 추가됐으므로 현재 적용 전 기준은 66개 중 52개 일치, `0052`~`0065` 14개 대기다. 역할 분리·TLS·RLS·공개 역할 차단은 당시 통과했다.
   - 변경 전 AES-256-GCM 논리 백업을 생성해 인증 태그와 SHA-256, 파일·디렉터리 권한을 확인했다. 단, Supabase 관리 schema/extension까지 포함한 플랫폼 복원 증거는 아니다.
   - `0056`·`0057`이 참조하는 공개 정책 URL은 후속 migration에서 `dabboba.net`으로 전환했지만, 운영 DB 적용 전 최신 migration 연속성과 정책 버전을 다시 확인해야 한다.
   - 출시 Edge 프로필에 외부에서 검증된 로그인 제공자 목록과 공개 Supabase 키가 없어 배포 gate가 의도대로 차단된다.
   - 현재 운영 API의 `/healthz`와 `/readyz`는 200이지만 최신 계약인 `/v1/public/config`는 404이므로 구버전이다.
   - 실제 운영 설정이 확인된 로그인 제공자만 첫 빌드에 노출해야 한다.
   - 이메일 OTP 송수신, OAuth 취소·재진입, 세션 복구, Apple 탈퇴 토큰 폐기와 Supabase Auth 사용자 삭제를 실제 계정에서 확인해야 한다.

4. **법률·정책·IP 권리 외부 확인 미완료**
   - 개인정보·약관·거래 기록 보관 기간과 계정삭제 문구는 국내 법률 담당자의 최종 확인이 필요하다.
   - 실제 IP 상품 이미지·판매 사용권 증빙이 필요하다.
   - 확률형 물리 경품 구조는 Google Play 정책지원의 서면 분류와 국내 법률 검토를 LIVE 전 필수 게이트로 둬야 한다.

### P1 — 공개 제출 전에 완료

- 현재 등록된 휴대전화가 실제 서비스 운영 책임자의 공개 연락처인지 확인하고 실제 연결을 검증해야 한다. 결제가 없는 PRELAUNCH 스토어 연락처로는 검증된 번호를 사용할 수 있지만, 이후 PG·카드사 심사 및 LIVE 전환 전에는 요구 조건에 맞는 사업자 유선 또는 대표번호로 교체해야 한다.
- 보관함 `/storage` 콜드스타트 딥링크를 iOS/Android 서명 실기기에서 재검증해야 한다.
- 신규 설치부터 탈퇴까지 정상·빈·오류·오프라인·느린 네트워크 흐름을 iOS와 Android에서 완료해야 한다.
- App Store Privacy와 Google Data Safety를 이메일·주소·연락처·주문·사진·UGC·알림 토큰·구조화 로그의 실제 흐름과 맞춰 제출해야 한다.

### P2 — 출시 영향이 없는 범위에서만 허용

- 웹 build의 약 1.15 MB chunk 경고는 성능 최적화 대상으로 남아 있다.
- 일부 Node 테스트의 module type 경고는 사용자 기능에 영향이 없지만 이후 설정 정리가 필요하다.

## 5. 출시 게이트 결정

현재 공개 제출 판정은 **NO-GO**다. 내부 코드와 일회성 DB 검증의 통과만으로 공개 심사에 제출해서는 안 된다.

다음 조건을 모두 충족한 뒤에만 `GO`로 전환한다.

1. **완료:** 출시 범위를 선별 커밋하고 Git 상태를 깨끗하게 유지하며 release source gate를 통과한다.
2. 공개 정책 사이트와 검증된 로그인 제공자를 준비한 뒤 migration `0052`~`0065`를 운영 DB에 반영하고 DB release check 66/66을 통과한다.
3. `dabboba.net` 네 정책 경로의 공개 상태를 유지하고 `support@dabboba.net` 송수신을 외부에서 검증한다.
4. 대표 유선번호, 실제 로그인 제공자, APNs/FCM, 탈퇴 외부 연동을 운영 계정으로 검증한다.
5. `production-prelaunch` 서명 IPA/AAB를 생성하고 iOS·Android 실기기 전체 흐름을 통과한다.
6. PRELAUNCH 배포 환경에서 주문·결제·추첨·재고·배송 mutation 0건을 로그로 확인한다.
7. TestFlight와 Play 내부 테스트 승인 후 열린 P0/P1 결함이 0건인지 다시 확인한다.

결제 로직은 보존하되 PRELAUNCH에서 접근 불가능하게 유지한다. 결제 제공자 등록 이후의 LIVE 전환은 이 보고서의 승인 범위가 아니며, PortOne V2·KG이니시스·웹훅·취소·환불·중복 콜백·대사와 Google 정책 분류를 별도 출시 게이트에서 검증해야 한다.

## 6. 2026-09-20 후속 준비 기록

- 기존에 설정된 사업자 연락처는 앱 사업자정보·공개 약관·개인정보처리방침에서 동일하게 유지한다. 소유자 검증을 마친 연락처로 간주하지 않으며, PG 심사용 유선 또는 대표번호는 계정 소유자가 실제 번호를 확인하기 전까지 출시 게이트를 통과시키지 않는다.
- iOS 앱 설정에 Sign in with Apple capability 선언을 추가했다. Apple Developer Team ID와 서명 자격 증명은 계정 소유자가 확인한 값만 사용한다.
- 공개 사전오픈 랜딩과 정책 문서를 `dist/public-site`로 분리해 내부 앱 프로토타입이 운영 사이트에 함께 배포되지 않도록 했다. 임시 검수용 `https://dabboba.pages.dev`는 친구 계정의 최종 운영 배포가 아니며, 공개 사이트 Worker 테스트는 19/19 통과했다.
- 모바일 출시 구조 검사, 모바일 타입검사, Expo Doctor 21/21, Expo 의존성 검사, production 의존성 보안 감사, PRELAUNCH iOS·Android 번들 금칙어 검사가 통과했다.
- 당시 전체 workspace 검증은 build 11/11, typecheck 19/19, package test 19/19, Playwright 9/9, 사이트 테스트 17/17로 통과했다. 테스트 단계는 생성 디렉터리 경합과 고부하 타임아웃을 피하도록 순차화했고, 제품의 실제 미디어 타임아웃 경계는 별도 16/16 테스트로 확인했다.
- EAS `production-prelaunch`와 `production-live` 설정은 고정된 Node·pnpm 버전과 각 commerce capability를 사용하며, EAS lifecycle hook이 출시 설정 및 실제 iOS·Android 번들 검사를 자동 실행한다. EAS Production 환경의 PRELAUNCH 공개 값과 iOS·Android 빌드 자격증명은 등록됐지만, 현재 Apple 개인 팀이 실제 서비스 소유자의 배포 계정인지 확인하고 스토어 제출 자격증명을 별도로 연결해야 한다.
- 2026-09-22 EAS Production 및 GitHub `mobile-production`에는 PRELAUNCH API 대상, Supabase 공개 값, 네 정책 URL, `DABBOBA_COMMERCE_MODE=PRELAUNCH`, `PAYMENT_PROVIDER=UNCONFIGURED`를 등록했다. 공개 Supabase key 외의 서버 비밀과 PortOne 값은 넣지 않았다. `api.dabboba.net` DNS와 최신 API 배포가 없으므로 이 구성은 아직 서명 빌드 시작 승인이 아니다.
- Android 기본 keystore와 iOS distribution certificate·provisioning profile은 `production-prelaunch`에 연결돼 있다. APNs/FCM 및 스토어 제출 키, App Store Connect/Play Console 앱 레코드는 아직 연결되지 않았다.
- PRELAUNCH Expo config에서는 PortOne native plugin이 제거되어 결제 앱 URL scheme과 package query가 들어가지 않고, LIVE config에만 포함되는 것을 구조 테스트와 Expo config introspection으로 확인했다.
- `dabboba.net`과 `www.dabboba.net`은 HTTPS로 열리고 네 정책 경로도 200 응답을 확인했다. 다만 `support@dabboba.net`의 최종 수신·공개 발신과 자동 웹 탈퇴 연동은 아직 검증되지 않았다. Apple 배포 계정 소유자 결정과 App Store Connect 앱 레코드, Google Play 계정 확인도 외부 계정 단계로 남아 있으므로 공개 제출 판정은 계속 **NO-GO**다.
