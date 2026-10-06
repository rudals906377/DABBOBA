# 가챠 판매판 스토어 준비 — 2026-10-01

상태: **판매판 제출 초안, 미제출·미승인**. 현재 운영 및 로컬 확인 빌드는 PRELAUNCH다.
결제·실기기·법률·운영 검증 후 실제 판매판과 일치할 때만 아래 판매 설명을 사용한다.
카탈로그 사전오픈판 초안은 `prelaunch-store-submission.md`에 별도로 남긴다.

## 첫 판매 범위

- 가챠 8개, 사용자 확인 총수량 392개, 상세 종류 46종. 쿠지는 판매하지 않는다.
- 결제로 해당 가챠 구성 중 실물 상품이 무작위로 정해진다. 특정 종류의 선택 구매나 당첨 보장은 아니다.
- 내부 재고 자동 배분을 사용하며, 실제 추첨은 서버의 남은 종류별 수량에 비례한다. 잔여 수량 변화로 확률이 달라질 수 있다.
- 상세 화면은 대표 사진 슬라이드, 상품명·가격, 구성 목록, 서버가 확인한 전체/오픈 수량, 최근 기록 및 안내를 보여준다. 내부 배분 수량을 실제 실물 검수 증거로 표현하지 않는다.
- LIVE의 실제 서버 확률 안내는 유지한다. `1/n`이나 `50/202` 예시를 현재 상품의 확정 확률처럼 심사에 제출하지 않는다.
- 획득 상품은 보관함에서 확인하고 획득 기준 60일 내 배송을 신청한다. 고객 화면과 서버의 실제 만료 처리·안내를 최종 대조한다.
- 배송 정책: 쿠지 없는 묶음 24,900원 이상 무료, 미달 기본 3,000원. 쿠지 판매를 시작하기 전에는 쿠지 구매를 광고하지 않는다.
- 포인트 환급은 본인이 직접 뽑아 보관 중인 적격 가챠 상품에 한하며, 해당 경품 자체 기준가의 50%를 항목별로 내림한다. 현금 환전이 아니다.
- 환불·교환 안내는 실제 계약과 법률 검토로 확정한다. 하자·오배송 등 법적 구제까지 무조건 배제하는 문구는 제출 초안에 넣지 않는다.

## 콘솔 입력 초안

| 항목 | 초안 / 확인 기준 |
| --- | --- |
| 앱 이름 | DABBOBA |
| 기본 언어 | 한국어 |
| 분류 | 쇼핑 앱 (게임으로 제출하지 않음) |
| 앱 다운로드 가격 | 무료 — 상품 주문은 별도 결제 |
| iOS Bundle ID | com.dabboba.mobile |
| iOS 소유 팀 / 기존 앱 | MCZ4884P7F / 6815146511 유지 |
| Android package | com.dabboba.mobile |
| 버전 | 소스 1.0.0, 최신 검증 iOS PRELAUNCH build 5, Android versionCode 1; 실제 판매판은 별도 최종 빌드·업로드와 중복 여부를 확인 |
| iOS 부제 | 캐릭터 실물 굿즈 쇼핑 |
| Play 짧은 설명 | 캐릭터 가챠 상품을 살펴보고, 실물 굿즈 구매부터 보관·배송 신청까지 다뽀바에서 |
| 키워드 초안 | 가챠,캐릭터,굿즈,피규어,애니메이션,컬렉션,쇼핑 |
| 지원 | support@dabboba.net / https://dabboba.net/support |
| 개인정보 | https://dabboba.net/privacy |
| 약관 / 탈퇴 | https://dabboba.net/terms / https://dabboba.net/account-deletion |

공개 주소의 정상 응답만으로 문의 메일 수신이나 실제 탈퇴 처리가 검증되는 것은 아니다.
대표 연락처·판매자·정산 주체는 친구분 사업자의 확정 정보를 쓰며 임의 정보를 채우지 않는다.
연령 등급·대상 연령·거래자 선언은 소유자가 실제 서비스와 법률 검토를 토대로 결정한다.

### 판매판 설명 초안

DABBOBA는 좋아하는 캐릭터의 실물 가챠 상품을 살펴보고 구매할 수 있는 쇼핑 앱입니다.
상품 사진과 구성 목록, 판매 안내를 확인하고 관심 상품을 저장해 보세요.

가챠 상품은 구성 목록에 포함된 상품 중 하나가 무작위로 제공되는 방식입니다.
같은 상품이 중복될 수 있으며, 원하는 종류를 선택하거나 특정 결과를 보장받을 수는 없습니다.
구매 전 해당 상품의 구성 및 확률 안내를 확인해 주세요.

구매 후 획득한 상품은 보관함에서 확인하고 배송을 신청할 수 있습니다.
보관 기간, 배송비와 무료배송 조건, 교환·환불 조건은 상품 안내와 약관에서 확인해 주세요.
첫 판매 버전은 가챠 상품을 제공합니다. 쿠지 판매는 준비 후 별도로 안내합니다.

고객지원: support@dabboba.net

위 문구는 결제·뽑기·보관·배송이 실제로 작동하는 판매판 전용이다.
PRELAUNCH 빌드에 붙여 넣거나 작동하지 않는 기능을 스크린샷으로 꾸미지 않는다.

## 심사 담당자 안내 초안

This is a shopping application for physical character merchandise. The first
sales release offers gacha products only; Kuji sales are not enabled. A paid
gacha purchase gives the buyer a randomly determined physical item from the
disclosed product lineup. It is not a fixed-choice purchase, and duplicate
items are possible. The server determines results using finite remaining
inventory; the app does not generate or change results locally.

Obtained physical items are visible in the account's storage, with shipping
requests available under the stated storage and shipping conditions. Eligible
stored gacha items may be returned for non-cash in-app points under the stated
policy. We disclose the paid random-result nature for policy review and do not
assert that the shopping category alone establishes policy eligibility.

Before submission, replace this draft with tested reviewer access instructions
for the actual submitted build. Do not ask reviewers to provide personal card
details. Obtain the PG/store owner's approved review procedure and describe
any test environment explicitly, without creating a hidden authorization bypass.

## 리뷰 계정 준비 서식 — 비밀번호는 별도 보관

심사 기간에만 열리는 운영 심사자 로그인 절차는 [`store-review-login.md`](store-review-login.md)를 따른다.

- 제출 빌드 식별자 / 실제 설치 파일:
- 운영 프로젝트 / API:
- 리뷰어가 사용 가능한 일반 회원 로그인 방법:
- 신규 설치에서 로그인·탈퇴·구매 화면까지 검증한 날짜:
- 계정 ID / 비밀번호 전달: 소유자 콘솔의 리뷰어 전용 비밀 입력란에만 등록
- OTP 또는 SNS 허용 목록 제한: 일반 심사자가 이용 가능한 승인 절차를 구체적으로 기록
- PG 승인된 심사 절차 / 실제 비용 발생 여부:
- 결제·배송 시 운영자가 확인할 접수 경로:

관리자 계정, 친구의 개인 SNS 계정이나 API secret을 리뷰어에게 전달하지 않는다.

## 실제 설치 후 캡처 목록

1. 홈: 실제 운영 상품과 실제 공지, 허구의 구매·당첨 기록 없음.
2. 가챠샵: 실제 상품 2열 목록, 찜·검색, 서버 수량과 판매 상태.
3. 상품 상세: 대표 슬라이드·구성·가격·실제 판매 안내.
4. 구매 흐름: 검증된 결제 수단·최종 금액·고객 동의. 실제 개인정보 및 카드 정보 가림.
5. 결과·보관함: 승인된 실증 주문의 결과만 사용. 가짜 당첨 화면 금지.
6. 배송 신청 / 내정보: 실제 제공하는 동작만 캡처. 테스트 고객 주소 노출 금지.

아직 네이티브 판매판 실기기 캡처는 확보하지 않았다. 임시 UI 또는 PRELAUNCH 화면을 판매 증거로 대체하지 않는다.

## 데이터 선언 준비 범위

| 데이터 / 동작 | 소스상 사용 | 제출 전 직접 확인할 경계 |
| --- | --- | --- |
| SNS 신원·이메일·세션 | Supabase broker 및 고객 인증 | 네 제공자의 공개 승인, 로그인·유지·로그아웃·탈퇴 |
| Apple 갱신 토큰 | 서버 암호화 보관 및 폐기 경로 | Apple 실제 토큰 폐기 후 Auth 삭제 성공 |
| 닉네임·관심 상품·구매·보관 기록 | 회원 기능 및 서버 저장 | 연결성·보존 기간·권한·삭제 예외 |
| 배송지·전화번호 | 실물 배송 | 택배·위탁사 및 실제 전달 필드 |
| 결제 식별자·금액·상태 | PortOne/KG 결제 처리 | 실제 PG 계약·웹훅·취소·법정 보존 |
| 문의·요청 사진 | 인증된 업로드와 파일 연결 | 공개 범위·위탁사·보존·삭제 |
| 푸시 토큰 | 알림 경로 | 활성화 여부·동의·실제 전달사 |
| 오류·접속 로그 | 서버 보안 및 운영 | 개인정보 최소화·접근 권한·보존 기간 |

이 표는 콘솔 질문의 확정 답안이 아니다. source, SDK, 최종 서명 빌드와 운영의 실제 데이터 흐름을 대조한다.
새 광고·행동 추적 SDK를 추가하지 않았다. 사용하지 않은 진단 도구를 활성화됐다고 선언하지 않는다.

## 최종 제출 전에 남은 외부 증거

- 친구 계정에서 운영 migration 이력 확인, 백업·복구 증거 및 안전 배포.
- 8개 상품의 실제 상세 이름·사진 매칭·자동 배분 대조, 판매 상태·가격 최종 확인.
- PG 계약서·가입비·보증보험 및 심사 절차, 실결제/테스트 결제·지연/중복 웹훅·취소·환불·오류 복구.
- 최신 서명 iPhone 및 Android 설치·회귀·결제 복귀, Apple 실제 삭제, 필요할 때만 SMS 실증.
- 사업자·반품/환불·무작위 판매·개인정보 문서의 소유자 승인 및 국내 검토.
- 리뷰어 접근·메일 수신·스토어 캡처·연령 및 데이터 선언, 소유자의 실제 제출.

Google Play 별도 서면 회신 대기를 필수 선행 조건으로 고정하지 않는다. 사용자 결정대로 정확한 설명으로 실제 심사를 준비하되, 승인 전 Android 판매 가능 여부는 미확정이다. 정책 심사와 국내 적법성은 서로 별개다.
