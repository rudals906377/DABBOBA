# 모바일 최종 준비 검사 — 2026-10-04

통합 후보 `65c9d85f59a1a2d388ba64bfd1390dff6a4913c3`에 실제 산출물의 공개 설정 문자열을 검사하는 `scripts/verify-mobile-artifact-config.mjs`와 회귀 테스트를 추가했다. 기존 설정 검사는 소스와 선언한 환경을 확인하고, 기존 production bundle 검사는 TEST_PG·개발 세션 등의 금지 표시를 찾는다. 승인된 옛 API 주소만 남아 있는 번들은 그 검사들을 통과할 수 있었다. 새 검사는 생성된 번들에서 현재 예상하는 API 기본 주소를 정확히 대조한다.

첫 출시 범위는 가챠 8개, 쿠지 보류이며 PRELAUNCH를 유지한다. 민트 배경의 가로 워드마크 아이콘, 앱 식별자와 Apple 팀 설정은 변경하지 않았다. 검사 명령은 패키지 스크립트에 등록했고 기존 production bundle 검사의 새 export 직후 실행하도록 연결했다. EAS 실행·배포·스토어 작성·실제 결제·회원 삭제는 하지 않았다.

## 실행 가능한 추가 검사

- Expo export의 `metadata.json`이 지정하는 iOS/Android 번들, IPA의 `Payload/<app>.app/main.jsbundle`, APK의 `assets/index.android.bundle`, AAB의 `base/assets/index.android.bundle`을 직접 읽는다.
- Hermes 바이트코드는 설치된 Expo/React Native의 Hermes 검사기로 정확한 문자열 테이블을 읽는다. JavaScript 번들은 설치된 Babel 파서로 문자열 리터럴을 읽으며 앱 코드를 실행하지 않는다. 주석과 소스맵은 값의 증거로 사용하지 않는다.
- 8개 필수 공개 빌드 변수의 정확한 리터럴을 비교한다. LIVE 선언이면 PortOne의 공개 store/channel 식별자도 요구한다. 긴 URL에 예상 주소가 일부 포함돼 있어도 동일한 값으로 인정하지 않는다.
- 기대 환경의 필수 값 누락, 실제 번들의 공개 인증 키 누락, 다른 Supabase 프로젝트, 옛/대체 DABBOBA API 주소, 구체적인 로컬 고객 API 주소, TEST_PG/개발 세션, server-only 키를 실패로 처리한다. SDK에 들어 있는 `sb_secret_` 같은 거절 검사용 접두어만으로 실제 키 유출이라고 판단하지 않는다.
- 번들이 없거나 여러 개라서 대상이 모호한 아카이브, 메타데이터 밖의 추가 실행 번들, 두 플랫폼이 같은 번들을 지정하는 메타데이터, 읽을 수 없는 Hermes 테이블은 통과하지 않는다.
- 보고서에는 산출물·번들·기대 값의 SHA-256, 플랫폼, 검사 형식과 오류 코드만 기록한다. 키와 발견한 자격증명 값은 출력하지 않는다.

검사 결과 `pass`는 **컴파일된 정확한 문자열이 존재한다는 제한된 증거**다. 그 문자열이 실행 중 실제 설정으로 사용되는지, CommerceCapability의 활성 값, 서명, 인증 성공, 외부 결제, 스토어 제출 가능 여부를 증명하지 않는다. 보고서의 `runtimeConfigurationVerified`, `commerceCapabilityAttested`, `signingVerified`, `authenticationVerified`, `storeSubmissionReady`는 항상 `false`다. 실제 기기에서 로그인 및 결제 복귀를 별도로 확인해야 한다.

## 이번에 직접 실행한 결과

```sh
node --test tests/mobile-artifact-config.test.mjs tests/mobile-production-bundle.test.mjs tests/mobile-release-config.test.mjs tests/verify-ios-artifact-team.test.mjs
corepack pnpm run check:runtime
node scripts/check-mobile-release-config.mjs --structure-only
git diff --check
```

초기 회귀 검사 **38개 통과, 실패 0, 건너뜀 0**. 이 중 새 검사 12개에는 설치된 Hermes로 실제 바이트코드를 컴파일하고 검사하는 사례, 실제 ZIP 형식의 IPA/APK/AAB 읽기, 오래된 승인 API 주소 검출, 주석·소스맵·URL 접미사 위장 차단, 누락된 공개 인증 키와 모호한 번들의 실패가 포함된다. 이후 자동 연결의 양 플랫폼 검사·오래된 결과 실패·시험 프로필 경계와 EAS 계약을 포함한 집중 검사도 29개 통과했다. 보호된 runtime 28개 파일과 릴리스 구조 검사도 통과했다.

새 빌드는 기존 승인된 운영 프로젝트의 실제 공개 인증 키를 메모리에서 재사용했다. 키를 보고서·명령 인자에 출력하거나 새 자격증명 파일로 복사하지 않았다. 완전한 공개 환경 검사를 실행한 뒤 변환 캐시를 비워 iOS/Android export와 Android APK/AAB를 새로 생성했다. 네 산출물의 8개 공개 설정 정확 일치 검사는 모두 통과했다. 아래에 남긴 옛 산출물 실패는 그대로 보존하며, 새 빌드를 실제 로그인 검증 완료로 바꾸어 해석하지 않는다.

새 증거는 `../.dabboba-launch/evidence/native-candidate-20261004-final-candidate/result.json`과 `../.dabboba-launch/artifacts/android-prelaunch-20261004/final-candidate/result.json`이다. 2.x brace-expansion의 마지막 공식 수정 버전을 반영한 뒤의 재생성 결과는 별도의 `final-reviewed` 경로로 남긴다. Android 파일은 **미서명·arm64 전용**이며 기기에 설치하거나 스토어에 올리지 않았다. iOS는 export만 새로 생성했으며 서명된 IPA는 만들지 않았다.

이전 준비물을 새 검사로 읽은 최종 보고서는 다음 위치다. 2026-10-02의 원본 증거와 바이너리는 수정하지 않았다.

| 직접 읽은 이전 산출물 | 새 검사 결과 | 확인 범위 |
| --- | --- | --- |
| `../.dabboba-launch/evidence/native-candidate-20261002/ios-preparation/export` | FAIL | Hermes 98에서 API/Supabase/4개 공개 링크/PRELAUNCH 문자열 존재. 완전한 publishable/anon 인증 키 리터럴 없음 |
| `../.dabboba-launch/artifacts/android-prelaunch-20261002/integrated-65c9d85/dabboba-prelaunch-unsigned-arm64.apk` | FAIL | 실제 `assets/index.android.bundle`의 Hermes 98에서 같은 7개 문자열 존재. 완전한 publishable/anon 인증 키 리터럴 없음 |

보고서는 `../.dabboba-launch/store-final-preparation-20261004/compiled-config-ios-export-20261002-verified.json`과 `compiled-config-android-unsigned-20261002-verified.json`이다. 두 보고서 모두 공개 인증 키를 기대 환경에 제공하지 않았다는 사실도 기록한다. 오류는 `EXPECTED_VARIABLE_MISSING(EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY)`와 `PUBLIC_AUTH_KEY_LITERAL_MISSING`이다. 따라서 이전 준비물을 로그인 가능한 완성본으로 취급할 수 없다. 같은 폴더의 `-verified`가 없는 초기 진단 보고서는 SDK 접두어를 검사한 초기 결과이며 최종 판정에는 사용하지 않는다.

## 다음 빌드에서 사용할 순서

먼저 이미 승인된 production 공개 환경을 확인한다. `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`에는 승인된 프로젝트의 실제 공개 publishable/legacy anon 값만 사용한다. 시험용 가짜 키, server-only secret/service-role 키를 넣어서 이 검사를 통과시키지 않는다. 키를 명령 인자나 로그로 출력하지 않는다.

소스 환경 검사와 새 export/산출물 검사는 같은 확인된 공개 환경을 사용한다. Expo export는 저장소의 `apps/mobile`에서 실행하고 `--clear`를 적용하여 이전 환경의 변환 캐시가 재사용되지 않도록 한다. 새 산출물은 별도의 새 출력 디렉터리에 만든다.

```sh
node scripts/check-mobile-release-config.mjs
node scripts/verify-mobile-artifact-config.mjs /absolute/path/to/new-ios-export
node scripts/verify-mobile-artifact-config.mjs /absolute/path/to/new-android-export
node scripts/verify-ios-artifact-team.mjs /absolute/path/to/final-store.ipa
node scripts/verify-mobile-artifact-config.mjs /absolute/path/to/final-store.ipa
node scripts/verify-mobile-artifact-config.mjs /absolute/path/to/final-store.aab
```

하나의 `.hbc`/`.jsbundle` 파일만 읽는 경우에는 `--platform ios` 또는 `--platform android`를 추가한다. 환경 누락 또는 비교 실패는 종료 코드 1이며, 재빌드 없이 선언만 바꿔 해결하지 않는다. `release:mobile:artifact:verify`로 직접 실행할 수 있고, 기존 production bundle 검사는 새 export 직후 이 검사를 자동 실행한다. 명시적인 내부 `pg-review` 프로필만 기존 시험 프로젝트용 검사를 유지하며, 운영 공개 환경 검사 우회에는 사용할 수 없다. 최종 서명된 IPA/AAB 자체를 읽는 검사는 여전히 별도로 필요하다.

## 운영자 확인이 남은 실제 완료 조건

최종 공개 인증 환경과 reviewer 접근, 운영 PG 승인/MID/채널 및 결제·취소·환불·재고/원장 반영, 실제 계약에 맞는 정책·개인정보 선언, 친구 명의의 Android upload key/Play 소유권 확인, 새 빌드 번호와 최종 signed IPA/AAB, signed 기기의 로그인 유지·로그아웃·결제 복귀·스크린샷, 각 스토어 필수 답변과 제출은 별도 조건이다. Apple 팀/ASC 기록은 기존 `MCZ4884P7F` / `6815146511`을 유지한다. 이 도구의 통과나 unsigned 빌드 성공만으로 위 조건을 완료 처리하지 않는다.
