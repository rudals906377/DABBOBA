# 심사 전 출시 준비 — 2026-10-14

대상 작업본은 `feat/direct-purchase-shared-pg-review`다. PG 승인, 유상 결제·환불, 스토어 승인과 판매 개시는 이 준비와 별도로 확인한다. 운영은 PRELAUNCH / UNCONFIGURED를 유지한다.

## 구현

- NICE V2와 EasyPay/KICC V2를 운영 API·Edge 프로필·앱 출시 검사의 카드 결제사로 지원한다. STAGING은 고정 심사 프로젝트와 TEST, PRODUCTION은 고정 운영 프로젝트와 LIVE만 허용한다. 서로 섞인 tier, TEST 운영 채널, 심사 로그인, 직접 Toss 자격증명은 거부한다.
- 기본 PG와 보조 PG의 채널은 중복되거나 서로 덮어쓸 수 없다. 프로필 직렬화와 되돌리기에 NICE/KICC 및 과거 INICIS/KCP 채널을 포함한다. 신규 구매는 NICE/KICC만 노출하고 과거 주문은 원래 채널로 복구한다.
- 앱은 주문에 고정된 PG에 따라 상품명 바이트 길이와 결제자 이름 길이를 검사한다. 한글·Unicode 중간을 자르지 않으며 결제자 이름은 자동 축약하지 않는다. 실제 주문 상품명과 금액은 보존한다.

## 상품 준비

`ops/catalog/gacha-launch-plan-2026-10-14.json`은 소유자가 확인한 종류별 20개를 8개 시리즈·46개 포함 상품·920개로 정리한 선언형 계획이다. 파일의 `DRAFT_NOT_APPLIED`는 자동 적용 명령이 아님을 뜻하며 실제 운영 준비 상태는 아래와 별도 증거에 기록한다. `corepack pnpm run release:catalog:check -- --production-readonly`는 운영 DB를 읽기 전용 트랜잭션으로 대조한다. SQL로 재고·확률표를 변경하지 않는다.

| 시리즈 | 포함 종류 | 준비한 재고 |
| --- | ---: | ---: |
| 먼작귀 모니터 컵케이크 | 7 | 140 |
| 데스노트 | 5 | 100 |
| 오네무탄 13형 | 5 | 100 |
| 페탓토 Vol.2 | 5 | 100 |
| 페탓토 Vol.3 | 5 | 100 |
| 하츠네미쿠 | 6 | 120 |
| 산리오 캔 속 피규어 | 5 | 100 |
| 실바니안 어드벤처 | 8 | 160 |

지정 운영자 로그인 뒤 관리자 화면의 불변 조정 원장으로 8종을 목표 재고에 맞췄다. 같은 감사 경로에서 각 구성 20개·가중치 1의 버전 1 초안을 준비했다. 공개·판매 시작은 실행하지 않는다. 운영 DB 최종 읽기 전용 대조에서 초안 8개·구성 46개·각 초기/잔여 수량 20·가중치 1, 부모 재고 920개·예약 0·ACTIVE 버전 0·COMING_SOON을 확인했다. 과거 DIRECT 46종은 비활성·재고 920개·예약 0이다. 과거 DIRECT 46종의 비활성 재고와 거래는 보존하며 이전 392개 자동 배분을 확정 구성의 확률로 사용하지 않는다.

## 운영과 계정

- Supabase CLI의 운영 프로젝트 접근은 확인했다. Supabase 커넥터는 재인증을 요구하므로 CLI와 고정 대상 DB 연결을 사용한다.
- 운영 암호화 백업을 새로 만들고 인증 태그를 검증했다. 동일 Supabase PostgreSQL 17.6 이미지의 빈 로컬 DB에 데이터와 큐를 복원했다. migration 101개, public 테이블 101개, 카탈로그 100개, 큐 1개를 확인했고 public 테이블의 RLS 비활성 수는 0이다. 이번 복원에서는 소유권·GRANT·역할 접속·Storage 파일·관리형 플랫폼 복구를 재검증하지 않았다. 복원 컨테이너는 검증 후 중지했다.
- 올바른 소유자 Cloudflare 계정에서 Zero Trust Free를 소유자가 활성화했다. `admin.dabboba.net` 전체에 지정 이메일 한 개와 One-time PIN, 24시간 세션을 적용했다. 이메일은 Git 바깥 비공개 운영 자료에만 보관한다. 익명 요청의 Access 302와 소유자가 수행한 Access + 기존 관리자 로그인을 확인했다.
- 관리자 Worker v27 (`d85d049b-852e-4ca9-ad13-bbc5ab1a3e89`)이 100% 운영 트래픽에 배포됐다. 새 Access JWT 검증 설정과 기존 Secret 바인딩이 유지됐다. Wrangler 마지막 도메인 탐색 단계는 좁은 OAuth 권한으로 실패했으나 실제 배포 기록·버전 바인딩·인증된 관리자 화면으로 적용을 별도 확인했다. `workers.dev`와 Preview URL은 API에서도 모두 비활성이다. 배포 도구 로그인은 기존 다른 제품 계정과 분리해 비공개 경로에 보관한다.
- 운영 API v30·관리자 API v34·워커 v13을 코드 커밋 `cb864a5`에서 PRELAUNCH로 배포했다. 기존 운영 Secret을 보존했으며 익명 워커 호출 거부를 확인했다. 결제 채널은 UNCONFIGURED, 자동 판매 전환은 없다.
- 운영 pg_cron/pg_net은 현재 설치되지 않았다. 검증된 워커 프로필을 사용해 자동 실행을 설정하고 실행 결과를 확인해야 한다. 보관 만료 포인트 전환과 개인정보 자동 파기는 계속 DISABLED다.
- 로컬 환경의 bootstrap 계정은 운영 관리자 계정이 아니다. 소유자가 기존 운영 계정으로 로그인했으며 새 관리자나 비밀번호를 만들지 않았다.
- EAS 프로젝트 `@dabboba-team/dabboba-mobile` 연결을 확인했다. 개발자 계정의 Owner 접근은 대표의 소유권·복구·MFA·billing 통제 증거를 대신하지 않는다.

## 기기와 스토어

- 갤럭시 SM-S931N에 내부 QA APK를 설치하고 실제 PRELAUNCH 게스트 홈을 확인했다. APK의 고정 운영 API·Supabase·정책 URL과 PRELAUNCH 문자열 검사를 통과했다. 임시 Android 템플릿 debug 키 서명이며 공식 스토어 빌드가 아니다. 현재 다른 앱 작업이 기기를 사용하므로 이후 동작을 확대 검증하지 않았다. 실제 iPhone 두 대는 현재 unavailable이다.
- Google Play의 기존 `다뽀바 / com.dabboba.mobile` 앱 초안에 최신 구매 설명, 아이콘, 그래픽 이미지를 저장하고 새 탭에서 재조회했다. 광고 없음·정부 앱 아님·건강 기능 없음·앱 포인트 기능 선언을 저장해 설정 6/11을 마쳤다. 로그인 세부정보·콘텐츠 등급·대상 연령·데이터 보안·최종 앱 스크린샷은 남았다. 소유자는 대상에 청소년도 포함한다고 확인했다. 현재 연령 설정은 앱 액세스·심사용 로그인 작성 전 단계에서 막혀 있어 아직 저장하지 않았다. 운영용 스토어 심사 로그인을 준비해야 하며 STAGING PG 계정을 대신 제출하지 않는다. 개인 개발자 계정은 12명 연속 14일 비공개 테스트가 필요하며 현재 참여 0명, 시작 전이다. 제출이나 공개 출시를 실행하지 않았다.
- App Store Connect의 올바른 JEUNGMI KIM 팀에 기존 앱 `6815146511`이 있음을 확인했다. Account Holder의 Apple Developer Program 사용권 계약 갱신이 요구되고 현재 협업자 화면은 버전 metadata가 읽기 전용이다. 소유자의 약관 갱신과 편집 권한 확인이 필요하다. 승인되지 않은 개발자 개인 Team으로 출시하지 않는다.
- 앱 소개·심사 설명은 결제 후 명시적으로 캡슐을 열 때 포함된 상품 중 1개를 지급하며 개별 상품 지정 불가·중복 가능성을 밝힌다. 쿠지는 준비 중이다.
- PG 심사는 스토어 심사를 대신하지 않는다. [Google Play 실제 현금 정책](https://support.google.com/googleplay/android-developer/answer/9877032?hl=ko) 및 [Apple 심사 지침](https://developer.apple.com/app-store/review/guidelines/)에 따라 실제 판매 방식 그대로 심사받는다. 이름만 바꾸거나 심사 전용 동작으로 위장하지 않는다.

## 승인 이후

승인받은 V2 계약·정산 주체 확인 → PortOne LIVE 채널 등록 → 운영 결제·환불·실제 거래 웹훅·앱 복귀 검증 → 최종 서명 빌드·스토어 승인 → LIVE 전환 순서다. 기존 전환 명령의 관리자 Access·DB 역할·백업·공개 API 검사를 생략하지 않는다.

## 검증 기록

실행 로그·암호화 백업·실기기/브라우저 증거는 Git 바깥 `.dabboba-launch/evidence/preapproval-20261014/`에 보관한다. 배포 코드의 GitHub CI에서 workspace build/tests·PostgreSQL migrations·Cloud Run artifact·Cloudflare Pages 검사가 모두 통과했다.

- workspace 빌드 12개와 typecheck 20개 성공, 생산 의존성 audit의 알려진 취약점 0개.
- Node 24에서 패키지별 검사 합계 2,225개 통과. 워커의 보관 정책 중복 검사는 1개 skip이며, 별도 새 DB 보관 정책 검사 1개는 skip 없이 통과했다. 전체 실행은 호스트 부하로 900초 총 제한에 걸려 끝난 패키지를 보존하고 미완료 API·워커만 재실행했다. API 438개, 워커 178개 통과; 전체 명령 한 번이 끝났다고 표현하지 않는다.
- runtime 무결성, Sites 검사, storefront 브라우저 2개와 runtime 브라우저 9개 통과.
- NICE/KICC 출시 설정·채널 직렬화·rollback·모바일 PG 입력 제한 회귀 검사 65개 통과.
- 관리자 Cloudflare 빌드·Secret 혼입 검사와 실제 Access 302 검사 통과. 운영자 이메일·관리자 비밀번호·OAuth token은 Git에 포함하지 않았다.

- 운영 상품 최종 대조 통과: 초안 8개, 포함 상품 46개, 각 20개, 총 920개. 공개 버전 0, 판매는 COMING_SOON이다. 조회 오류가 발생한 실바니안 페이지는 새로고침 후 정상 조회·초안 저장됐고 관리자 홈도 정상 표시됐다. 일시 오류의 서버 원인은 확정하지 않았다.
- 운영 API v30·관리자 API v34·워커 v13 ACTIVE 확인 및 익명 워커 호출 거부 확인. 실제 LIVE 거래 검증을 뜻하지 않는다.
