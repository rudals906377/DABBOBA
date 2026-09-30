# 로그인 없이 진행한 출시 준비 — 2026-10-01

작업 위치는 `/Users/kyoungmin/Desktop/DBB/.dabboba-launch-step1`이다. 다른 앱의 로그인·백엔드·컨테이너는 변경하지 않았다. 운영 배포·원격 푸시·스토어 제출·결제 활성화는 하지 않았다.

## 완료한 작업과 증거

1. **최신 코드 통합.** 최신 main `20f7160`, 갤러리 준비 `c899300`, 상품 상세·관리자 사진 자르기 병합 `703d251`. 상세/갤러리·찜·최근 기록·전체/오픈 수량·60일 보관·가챠 수량 비례 추첨을 통합했고 최신 인증·보안과 PRELAUNCH 차단은 유지했다. GitHub PR #9가 원격에서 병합된 것은 아니다.
2. **격리 DB 검증.** 다른 앱 DB를 재사용하지 않고 전용 컨테이너 `dabboba-launch-ci-20261001-703d251`을 만들었다. 저장소 CI와 동일한 PostgreSQL 17/pgmq 이미지 digest를 사용했다. 빈 DB에 마이그레이션 82개 적용 → 재실행 no-op → 전용 API·worker 역할 provisioning → 읽기 전용 release 검사 통과. DB 152개·API 353개·worker 129개 테스트가 모두 통과했고 건너뛴 검사는 0개다. 첫 worker 실행은 테스트 DB 이름 보호 장치 때문에 거부됐으며, 보호 장치를 바꾸지 않고 이 전용 DB 이름을 CI 규칙의 `dabboba_ci`로 변경해 통과했다.
3. **iOS·Android 번들 확인.** PRELAUNCH 설정으로 두 플랫폼의 새 Expo production export를 만들고 테스트 결제·데모 세션·테스트 회원·고객 API 루프백 주소 등 금지 표식을 검사했다. 통과했다. 서명된 설치 파일·실기기 동작·스토어 업로드 증거는 아니다.
4. **최신 구조의 암호화 복원 훈련.** 예전 훈련 도구의 고정 migration 51개 가정을 제거하고 현재 소스의 모든 version/checksum을 검증하도록 수정했다. 새 컨테이너 사용은 전용 이름·명시적 승인·정확한 이미지 digest·전용 label·단일 루프백 포트를 모두 요구한다. 관련 경계/백업 단위 검사 10개 통과.
5. **실제 로컬 복원 결과.** 새 빈 DB에 최신 migration을 적용하고 전용 복원 fixture만 넣어 훈련했다. 마이그레이션 82개, 테이블 98개, 제약조건 578개, CHECK 재해석 262개를 비교했다. 행·큐/보관 메시지·sequence·RLS/policy·trigger·index 일치, 같은 snapshot에서 동시 commit 제외, 원본 불변, 비어 있지 않거나 함수만 있는 대상 거부, 복원 후반 오류의 전체 rollback이 모두 통과했다. 작은 fixture 실행 6.2초는 운영 RTO가 아니다. 역할 GRANT, Supabase Auth/Storage/관리 schema 및 실제 운영 백업의 복원은 별도다.
6. **최종 로컬 회귀.** 훈련 도구 수정 후 루트 검사 1,023개와 TypeScript 검사 8개가 모두 통과했다. 준비한 읽기 전용 이력 SQL도 전용 로컬 DB에서 `transaction_read_only=on`으로 실행해 성공했다. 운영 SQL 실행 증거는 아니다.
7. **네이티브 설정 누락 수정.** 격리 복사본에서 SDK 57 iOS·Android prebuild를 실제 실행했다. `usesAppleSignIn: true`만으로 Apple 네이티브 entitlement가 생성되지 않는 것을 확인해, 기존 브라우저 OAuth 구현은 바꾸지 않고 `com.apple.developer.applesignin=[Default]`를 app.json에 명시했다. 누락·빈 배열·문자열·다른 값·추가 값은 출시 구조 검사에서 거부한다. 수정 후 Expo introspection에 실제 entitlement가 표시됐고, 관련 70개 및 전체 단위 1,025개·TypeScript 8개가 통과했다. 친구 팀·앱 식별자·iPhone 전용·사진 권한 설명·딥링크도 생성 설정에서 확인했다. 최종 서명 프로파일과 실기기 재검증은 별도다.
8. **판매판 심사 자료.** `gacha-sales-store-preparation-2026-10-01.md`에 가챠-only 판매 설명, 정확한 유료 무작위 실물 제공 방식, 심사 안내, 일반 리뷰 계정 준비 서식, 실제 설치 후 캡처 목록과 데이터 선언 대조표를 작성했다. 사전오픈판 초안은 따로 보존하고 최신 iOS build 3과 실제 Google Play 제출 방식 결정을 반영했다. 콘솔 입력·제출·승인이나 법률 검토 완료를 의미하지 않는다.
9. **의존성 재조회 및 후속 수정.** 최초 조회에서 production 의존성 audit의 high/critical은 0개, moderate는 `@fastify/rate-limit` 경유 `ip-address@10.5.0`의 4건이었다. 이 최초 증거는 `/tmp/dabboba-native-launch-qa.AMIG6I/dependency-audit.json`에 보존했다. 이후 기존 허용 범위 안의 `10.7.2`로 해당 전이 의존성만 갱신했고, 회귀 재현·수정 검사, API 356개 및 루트 1,028개·TypeScript 8개가 최종 통과했다. 새로운 production audit는 모든 심각도 0개다. 자세한 범위와 첫 시험 DB 로그인 실패를 포함한 증거는 `dependency-patch-2026-10-01.md`에 있다. 이는 로컬 준비 결과이며 운영 배포·전체 보안 무결함을 뜻하지 않는다.

10. **실제 Deno 실행 환경 검사.** 최신 번들을 격리 Deno 2.9.6과 전용 루프백 DB로 실행했다. 고객·worker·실제 Fastify/제한 DB·이미지 WASM 검사 5개와 진입 파일 검사 3곳이 통과했다. 관리자 진입 파일의 실제 타입 오류를 발견해 정상 응답 보존/무응답 503 처리로 수정했고 회귀 검사 4개도 통과했다. 다른 앱·운영 계정·호스팅 함수는 사용하지 않았다. 최초 실패와 증거 경계는 `edge-runtime-preparation-2026-10-01.md`에 정리했다.

11. **공개 운영 반영 대조.** 공개 GET으로 기본 7개 경로·대표 이미지 8장을 확인했다. 가챠 8개는 여전히 COMING_SOON이고 쿠지는 0개다. 새 구성 경로는 8개 모두 Route not found 404, 실바니안 gallery는 미등록 상태다. 웹 약관/개인정보는 소스와 같은 9/30판인데 API 필수 동의는 9/22판이라 운영 반영의 우선순위를 확정했다. 로컬 사진 8개 폴더·상세 46장·실바니안 대표 3장도 다시 확인했다. `public-production-readiness-2026-10-01.md`에 조회 시각·증거·안전한 다음 순서를 남겼다. 별도로 실제 Deno HTTP 루프백 요청/응답·HMAC·권한 경계 검사를 추가해 통과했으며 운영 ingress 시험은 아니다.

### 네이티브 컴파일의 현재 증거 경계

임시 복사본 `/tmp/dabboba-native-launch-qa.AMIG6I`는 커밋 `dcf4143`의 모바일 소스로 생성했으며 비밀 환경 파일을 복사하지 않았다. 원본 node_modules를 의존성 참조 경로로 재사용했고 원본 package/lock 파일은 보존했다. 처음 pnpm exec가 임시 경로의 모듈 재설치를 거부하자 보호 장치를 우회하지 않고 기존 Expo CLI로 prebuild를 실행했다. iOS CocoaPods 준비는 성공했다.

빌드 대상은 다뽀바 전용 `DABBOBA SDK57`이며 Release/PRELAUNCH·코드 서명 제외·동시 작업 2개로 **컴파일만** 실행했다. 기기/시뮬레이터 실행·설치·삭제는 하지 않았다. iOS 지침에 따라 꺼진 전용 시뮬레이터를 임의로 켜거나 실행 중인 FINDE 환경을 재사용하지 않았다.

첫 빌드는 XcodeBuildMCP의 300초 응답 대기를 넘겨도 실제 프로세스가 계속 동작해 종료까지 기다렸다. 최종적으로 네이티브 컴파일·링크 이후 JS 번들 단계에서 실패했다. 임시 프로젝트의 node_modules 참조가 원본 작업 폴더 밖으로 이어져 Metro가 엔트리와 글꼴을 찾지 못한 검증 환경 문제였으며, 실패를 성공으로 기록하지 않았다. 원본 Metro 설정·의존성 보호 장치는 변경하지 않았다.

Apple entitlement 수정 후 격리 iOS 프로젝트를 다시 생성하고 Pods 준비를 마쳤다. 임시 `.xcode.env.local`에만 JS 소스 루트를 원본 모바일 작업 폴더로 명시해 정상 의존성 그래프를 사용하고, 네이티브 생성물·빌드 결과는 계속 임시 폴더에 뒀다. 번들 생략 없이 원본 소스로 2,197개 모듈·73개 asset을 먼저 확인한 뒤 Release/PRELAUNCH arm64 최종 빌드를 실행했다. 두 번째 도구 응답 대기도 만료됐으나 실제 빌드를 재시작하지 않고 종료 결과를 확인했다.

**최종 iOS 시뮬레이터 컴파일은 성공했다.** `final-build.xcresult`의 상태는 `succeeded`, 오류 0개, 경고 531개, 실행 시간 약 342초다. 경고에는 React Native/외부 라이브러리와 Hermes 번들 경고가 포함되며 경고 0개라고 주장하지 않는다. 생성 앱은 arm64, Bundle ID `com.dabboba.mobile`, build `3`이고 생성 entitlement에 Apple `Default`가 있다. 결과는 `/tmp/dabboba-native-launch-qa.AMIG6I/final-build.xcresult`, 앱은 같은 폴더의 `DerivedData/Build/Products/Release-iphonesimulator/DABBOBA.app`에 보관했다. 코드 서명 제외 빌드로, App Store IPA·친구 팀 서명·실행 화면·실기기 로그인/탈퇴/결제 검증을 대신하지 않는다. 시뮬레이터를 켜거나 앱을 설치·실행하지 않았다.

Android 네이티브 프로젝트는 생성됐지만 이 Mac의 SDK 경로·환경 설정이 없어 APK/AAB 컴파일은 실행하지 않았다. 생성 manifest에 `allowBackup=false`, `dabboba` 복귀 scheme, 카메라·마이크·외부 저장소·오버레이 권한 제거 선언을 확인했다. 이것은 최종 merged manifest 검사나 서명 AAB가 아니다. SDK 설치/약관 또는 친구 소유 원격 빌드 환경과 실기기 확인을 통해 마쳐야 한다.

처음에는 통합 테스트가 끝난 DB를 clone했으나 테스트 정리 뒤 남은 `notification_preference_events` 외래키 불일치로 복원이 거부됐다. 이 실패를 성공으로 재분류하지 않았다. 깨끗한 migration-only DB와 전용 fixture를 새로 만들어 위 훈련을 통과시켰다. 기존 테스트 DB의 데이터는 운영 데이터가 아니며, 이 문제를 운영 장애라고 단정하지 않는다.

실행 로그: `/tmp/dabboba-no-login-qa.VGutaP/`의 `migration.log`, `migration-reentry.log`, `release-check.log`, `db-tests.log`, `api-tests.log`, `worker-tests.log`, `mobile-bundles.log`, `restore-clean.log`. 실패 원인은 `restore.log`에 별도로 남겼다. 이 경로는 임시 실행 증거이며 정기 보관소가 아니다.

복원 fixture archive와 테스트 키는 `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/dabboba-encrypted-restore-drill-HBUxDl`에 있다. 실제 고객 데이터가 없는 테스트만 같은 폴더에 키를 두었으며 운영 키 보관 규칙을 대체하지 않는다. 전용 컨테이너는 검증 후 중지하고 DB·fixture는 삭제하지 않아 재검사가 가능하다.

## 다음 운영 단계 준비

- `ops/database/launch-history-readonly.sql`은 migration version/checksum과 비정상 index만 읽는다. 실행 전에 대시보드에서 친구 소유 운영 프로젝트 ID를 확인한다. SQL에 프로젝트 이름을 하드코딩한다고 실제 접속 대상이 증명되는 것은 아니다.
- 운영 DB가 현재 `0067`이라는 과거 기록을 그대로 믿고 14개를 일괄 적용하지 않는다. 실제 이력을 최신 소스와 대조하고, 미적용 목록·checksum·암호화 백업 및 복원 근거를 확인한 뒤에만 승인된 범위로 진행한다.
- 최초 판매 범위는 **가챠 8개·392개·상세 46종**, 쿠지는 판매하지 않는다. 실물 확보·사진 권리는 사용자가 확인했다고 답한 기록을 유지한다. 자동 배분은 실제 상세 SKU 재고를 검수한 증거가 아니므로 공개 직전 운영자가 배분 결과를 확인한다.
- 운영은 PRELAUNCH를 유지한다. 실제 PG 테스트·지연/중복 웹훅·환불·오류 복구·서명 앱 복귀·정책 심사가 끝나기 전 LIVE flag만 먼저 켜지 않는다.
- Google Play 서면 회신을 기다리는 대신 실제 제출·심사를 준비한다는 사용자 결정을 따른다. 이는 승인이나 국내 법률 검토 완료를 의미하지 않는다. 참고 앱의 출시 사실도 다뽀바의 승인 증거가 아니다.

### 원격 코드 및 소유권 확인 — 2026-10-01 후속 조회

- 실제 Git remote는 private `rudals906377/DABBOBA`, 원격 main은 `20f7160165ebbae9dba68585cd52fd9293be8a25`다. 이번 준비 브랜치 `prep/launch-step1-20261001`는 원격에 없으며 준비 소스 `85c25e3`는 로컬에만 있다. 이 문서 갱신 커밋도 원격 푸시를 의미하지 않는다.
- 최근 main CI run `36751699848`은 위 `20f7160`에서 success/completed다. 새 준비 소스에 대한 GitHub CI 성공으로 인용하지 않는다. 조회한 최근 6개 run은 모두 terminal 상태였다.
- 기존 상품 상세 PR #9는 OPEN이고 대상은 `release/prelaunch-signing-stage2`다. 이번 최신 main 기반 로컬 통합은 그 PR의 원격 병합을 대신하지 않는다. 모션 시안 PR #4는 별도 작업이며 임의 병합하지 않는다.
- 저장소 Owner login은 `rudals906377`라는 사실만 확인했다. 이것으로 지정 친구의 법적 소유·통제·복구 권한이 확인되지는 않는다. `docs/friend-owned-release-accounts.md`의 GitHub/Expo 표는 9/23 기록으로 현재 소유 상태를 다시 확인해야 한다. 자동으로 새 조직을 만들거나 저장소를 이전하지 않는다.
- AGENTS의 친구 명의 출시 조건과 공개 배포 금지를 지킨다. 원격 푸시·PR·main 병합/Pages 연결, Expo 빌드 환경은 소유자 통제 확인 후 정확한 대상에서 진행한다. 과거의 커밋·푸시·PR 병합 요청을 다른 앱 계정이나 미확인 배포 계정 사용 허가로 확대하지 않는다.
- 로컬 iOS 컴파일은 종료됐고 전용 테스트 DB 컨테이너 두 개는 중지 상태다. 진행 중인 작업을 기다리고 있는 것으로 표현하지 않는다. Android SDK·서명 AAB, 최신 서명 IPA·실기기, 운영 반영 및 PG/심사 완료 증거는 아직 없다.

## 내일 사용자가 직접 해야 할 일만

1. **다뽀바 운영 계정 열기.** 다른 앱 작업이 끝나면 친구 Supabase 계정의 `dabboba-production` (`rconfxsykttfvznakile`)을 열어준다. Cloudflare도 다뽀바 친구 계정으로만 열어준다. 기존 FINDE 로그인이나 다른 앱 프로젝트를 바꾸지 않는다. 이후 이력 대조·백업·배포 준비는 Codex가 진행한다.
2. **비밀 보관/입력.** Bitwarden을 친구 계정으로 잠금 해제하고 새 Apple Sign in 키 `AuthKey_659HA2ZNGL.p8`를 별도 안전 보관·복원 확인할 수 있게 한다. 운영 DB 접속 비밀번호 등이 필요하면 안전한 입력창/터미널에만 입력한다. 채팅에 키·비밀번호·인증 코드·인증 URL을 보내지 않는다. 기존 DB·이미지 백업 키 저장을 다시 처음부터 요구하지 않는다.
3. **친구의 PG 업무.** 안내받은 계약서·구비서류 제출, 가입비, 보증보험을 처리하고 담당자의 테스트/운영 채널 승인 여부를 확인한다. 납부나 보험 가입은 Codex가 대신 승인하지 않는다.
4. **실기기 조작.** iPhone을 연결하고 Android 실기기도 준비한다. 최신 앱 설치 후 네 SNS 로그인·로그아웃·유지, Apple 탈퇴가 허용된 별도 테스트 회원, 실제 테스트 결제·취소·앱 복귀는 직접 눌러야 한다. Apple 테스트 계정의 다뽀바 회원 삭제 승인은 그때 받는다. 휴대폰 OTP를 첫 출시 범위에 넣는 경우에만 SMS 계약/발신 설정과 유료 발송 승인이 추가로 필요하다.
5. **판매 정보 최종 확인.** 8개 상품의 상세 이름·사진 매칭·자동 배분을 확인한다. 숫자 파일인 먼작귀·산리오 구성 이름은 정확한 명칭을 알려주거나 관리자가 입력한다. 총수량과 사진 권리는 이미 확인받았으므로 같은 질문을 반복하지 않는다. 쿠지 상품 자료는 지금 필요하지 않다.
6. **사업자/심사·출시 계정 소유 확인.** 친구가 판매자·정산·지원 연락처·반품 조건을 최종 확인하고 국내 판매 방식 검토를 맡긴다. GitHub와 Expo/EAS도 친구가 소유·통제하고 복구/MFA·billing을 관리하는지 확인하고 개발자는 필요한 협업 권한만 사용한다. 스토어 계정 로그인, 계정 소유자 약관·인증·유료 결정, 실제 심사 제출은 소유자가 할 부분이다. 검증 안 된 화면을 실제 결제 캡처나 출시 완료로 제출하지 않는다.

위 사용자의 직접 작업 전에도 준비된 코드·검사·문서는 유지된다. 외부 완료가 필요한 항목을 로컬 검사의 성공으로 지우지 않는다.
