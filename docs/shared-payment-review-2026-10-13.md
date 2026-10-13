# 나이스·토스 공통 심사 웹 — 2026-10-13

최신 사용자 결정: 포트원 나이스와 토스 직접 결제를 같은 심사 웹에서 공통으로 사용한다. 상품·수량을 먼저 선택하고 기존 가격으로 구매하는 흐름, 교환방 유지, 포인트 환급 숨김 정책을 따른다.

## 동작

- 공통 주문·결제 화면에 두 결제 방식을 표시한다. 서버가 확인한 TEST 설정만 활성화하며 미연결 방식은 ‘연결 준비 중’으로 닫힌다.
- 양쪽 연결: 기본 provider `PORTONE_V2_NICE`와 완전한 Toss TEST 설정을 함께 사용한다. NICE 단독과 Toss 단독 환경도 지원한다. 두 STAGING 등급과 기존 결제시험 프로젝트 제한, LIVE 차단을 유지한다.
- 주문 생성 요청에 `reviewPaymentProvider`를 넣고 NICE에는 `cardPg=NICE`를 함께 보낸다. 서버 결제 provider 및 NICE 채널 스냅샷을 검증하고 저장된 미완료 주문의 결제사·상품·수량을 고정한다. 자동 대체 결제는 없다.
- NICE는 `/v1/payments/:paymentId/{attempt,confirm,abandon}`, Toss는 `/v1/review/toss-payments/:paymentId/{attempt,confirm,abandon}`를 사용한다. 다른 provider의 결제 ID를 받으면 거부한다.
- 서버의 상품 가격과 주문 합계를 사용하며 주문 복구는 변경된 카탈로그 가격이 아니라 저장된 서버 주문 기준이다. 예약으로 상품이 목록에서 빠져도 상품 상세를 조회해 기존 주문을 확인한다.
- 복귀 정보는 검증 후 주소에서 지운다. 성공은 서버 재조회로 확인하며 불확실한 결과는 기존 주문에 유지한다. 미결제 해제도 각 PG 조회 결과로 확인한다.
- 심사 경로만 공식 SDK와 PG 요청에 필요한 CSP를 허용한다. 인라인/eval 허용, 과거 INICIS/KCP 신규 구매 허용, 다른 공개 경로 CSP 변경은 없다.

## 검증과 한계

- 웹 심사·복구·공통 결제 채널·Sites 검사 47개, 설정 검사 34개, API 결제 선택/채널/Toss/commerce 단위 검사 44개 통과. API 타입 검사와 OpenAPI 생성·빌드 통과.
- 새 임시 PostgreSQL 17에 전체 100개 마이그레이션을 적용했다. 공통 STAGING 통합 검사 및 선택 도우미 3개 통과: 두 설정 동시 제공, 결제사 혼합/중복 요청 차단, NICE 확인·미결제 해제, Toss 승인·응답 유실 후 복구, 선택 SKU만 지급 및 뽑기권 미발급. PG HTTP 응답은 합성이다.
- 실제 소스를 연 로컬 브라우저에서 두 방식을 순서대로 선택해 각 2개·14,000원 주문 성공을 확인했다. SDK와 API는 명확히 표시된 로컬 합성 시험이며 실제 청구·PG 증거가 아니다.
- 보호 런타임 검사 후 웹 빌드 성공. 보호 파일 중 worker/index.js의 검증된 해시만 갱신했다. 기존 큰 청크/모듈 유형 경고는 남아 있다.
- 실제 NICE 채널 저장, Toss 키 연결, 원격 시험 DB/Edge 반영, 실제 결제창/승인·취소·웹훅·기기 검증은 미완료다. Production·LIVE 판매는 활성화하지 않았다.

## 공식 근거

- PortOne NICE V2: https://developers.portone.io/opi/ko/integration/pg/v2/nice-v2
- PortOne checkout: https://developers.portone.io/opi/ko/integration/start/v2/checkout
- Toss 공식 SDK: https://docs.tosspayments.com/sdk/v2/js

미리보기 배포와 실제 서비스 연결 증거는 구분해 아래에 기록한다.

## 미리보기 반영 확인

- 기존 승인된 Cloudflare 프로젝트 `dabboba`의 Preview 브랜치 `direct-purchase-20261013`만 갱신했다. 배포 ID `ef9219b4`, 주소 https://direct-purchase-20261013.dabboba-2o6.pages.dev/review/#about . Production dabboba.net은 변경하지 않았다.
- 배포된 약관·개인정보처리방침·교환방 운영정책과 review/app.js·payment-channel.js의 bytes가 로컬 원본과 일치한다. 새 CSP와 no-referrer도 응답에서 확인했다.
- 실제 HTTPS 미리보기에서 PortOne.requestPayment와 TossPayments가 각각 function으로 로드됨을 브라우저 진단으로 확인했다. 화면은 현재 서버 연결 상태에 맞춰 ‘결제 연결은 준비 중’으로 표시하며, 실제 TEST 채널 연결 완료를 주장하지 않는다. 카드 입력·청구 요청은 실행하지 않았다.
- 화면 캡처: 작업공간 외 비공개 증거 폴더 `.dabboba-launch/shared-payment-review-preview-20261013.png`. API Edge 번들 생성도 통과했으나 원격 Edge에는 배포하지 않았다.

## 실제 심사 주소 게시 — 후속 사용자 요청

- `https://dabboba.net/review/`에 Production 배포 `22fc7feb`로 소스 `6e099bb`의 공통 심사 웹을 게시했다. 공개 소개와 직접 선택 정책 문서도 같은 공개 웹 번들에 포함된다.
- 실제 주소에서 직접 선택 앱 소개와 나이스·토스 준비 상태를 브라우저로 확인했다. 심사 파일과 세 정책 HTML의 게시 bytes가 원본과 일치하며 CSP의 두 공식 SDK 및 no-referrer를 확인했다.
- 연결된 시험 서버의 상품은 아직 0개이며 NICE/Toss 설정과 새 정책 동의 버전은 미반영이다. 현재 화면 게시 완료와 실제 상품 주문·TEST 결제 가능 상태를 구분한다. 운영 DB/API, 일반 판매와 실제 PG 승인·카드 청구는 변경하거나 확인하지 않았다.
