# 포함 상품 구매판 스토어 준비 — 2026-10-13

상태: 소스 수정 및 제출 초안. 실제 콘솔 입력·제출·승인을 의미하지 않는다. 이전 직접 선택 구매 초안을 대체한다.

## 첫 판매 범위

고객은 포함 상품·공개 확률·가격을 확인하고 구매 횟수를 선택해 결제한다. 캡슐을 열 때 서버가 공개된 구성에 따라 포함된 상품 중 1개를 확정한다. 개별 상품을 지정할 수 없고 같은 상품이 중복될 수 있다. 기존 1회 구매 가격을 유지한다. 쿠지는 준비 중이며 판매하지 않는다. 기존 주문·결제·뽑기·직접 구매 기록은 보존한다.

종류별 20개로 확인한 실물 수량과 기존 재고·구성표를 대조해 운영자가 공개 구성을 검증한다. 과거 직접 선택 SKU는 판매에서 제외하고 재고 기록은 보존한다. 이 문서만으로 재고를 이동하거나 판매를 활성화하지 않는다.

## 콘솔용 한국어 설명

DABBOBA는 캐릭터 실물 상품의 포함 구성을 확인하고 구매하는 앱입니다.
구매 전 포함 상품과 공개된 확률·수량·가격을 확인하고 구매 횟수를 선택합니다.
결제 후 캡슐을 열면 서버가 공개된 구성에 따라 포함된 상품 중 1개를 확정합니다. 개별 상품을 지정할 수 없으며 같은 상품이 중복될 수 있습니다.
획득한 상품은 보관함에서 확인하고 배송을 신청할 수 있습니다. 기본 보관 기간은 획득일부터 60일이며 취소·반품 규정은 결제 전에 확인할 수 있습니다.
쿠지 상품은 준비 중이며 아직 구매할 수 없습니다.

고객지원: support@dabboba.net

짧은 설명: 포함된 상품 중 1개를 만나는 설렘, 보관·배송 신청까지 다뽀바에서
부제: 포함 구성을 확인하는 캐릭터 쇼핑

## Reviewer notes

DABBOBA is a shopping application for physical character merchandise. Customers review the included items, published probabilities and quantities before choosing how many draws to purchase. Verified payment issues draw rights. When a capsule is opened, the server determines one included item under the published configuration. The exact item cannot be selected in advance and duplicates may occur. Acquired items appear in storage and can be requested for delivery under the disclosed storage and shipping conditions. Kuji sales are not enabled.

Reviewer access, payment TEST environment, installed build identity and actual costs must match the submitted build. Historical direct-purchase and draw orders remain recoverable under their original records. EasyPay and NICE applications both use PortOne; application is not approval.

## 제출 전 확인

- 종류별 실물 수량과 개별 SKU의 사진·이름·가격 일치
- 구매 횟수 주문, 서버 결제 확인, 권리 발급 및 포함 상품 지급·보관, 배송 및 취소·환불
- 실패·중복·재시작 시 같은 주문 복구 및 재고 중복 지급 방지
- 포함 상품 구매 약관 게시와 새 버전 재동의
- 서명 iPhone/Android 설치 확인, 실제 스크린샷, 심사 계정 접근
- PG 승인 및 스토어 제출은 별도 외부 절차
