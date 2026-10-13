# 직접 선택 구매판 스토어 준비 — 2026-10-13

상태: 소스 수정 및 제출 초안. 실제 콘솔 입력·제출·승인을 의미하지 않는다. 이전 무작위 상품 판매 초안을 대체한다.

## 첫 판매 범위

고객이 사진·이름·종류를 확인하고 정확한 상품과 수량을 선택한 뒤 결제한다. 판매가는 기존 1회 구매 가격과 같다. 선택한 SKU를 보관함에 등록하며 결제 후 상품 추첨이나 종류 변경을 하지 않는다. 쿠지 판매는 계속 보류한다. 기존 주문·결제·뽑기 기록은 보존한다.

8개 시리즈의 46종 구성은 별도 개별 판매 SKU로 준비한다. 기존 총재고 392개와 자동 배분표는 실제 종류별 실물 재고 확인을 대신하지 않는다. 확인 전에는 개별 재고 0 / 오픈 예정으로 유지한다.

## 콘솔용 한국어 설명

DABBOBA는 원하는 캐릭터 실물 상품을 직접 고르고 구매하는 쇼핑 앱입니다.
상품 사진과 이름, 종류별 가격을 확인하고 원하는 상품과 수량을 선택해 보세요.
관심 상품을 저장해 다시 찾고, 구매한 상품은 보관함에서 확인한 뒤 배송을 신청할 수 있습니다.
기본 보관 기간은 60일이며 배송비와 무료배송 기준, 취소·반품 규정은 주문 전에 확인할 수 있습니다.
쿠지 상품 판매는 준비 중입니다.

고객지원: support@dabboba.net

짧은 설명: 원하는 캐릭터 상품을 직접 고르고, 구매부터 보관·배송 신청까지 다뽀바에서
부제: 원하는 캐릭터 상품 직접 구매

## Reviewer notes

DABBOBA is a shopping application for physical character merchandise. Customers select the exact product and quantity before payment. The order contains the selected SKU; payment does not trigger random item allocation or a prize draw. Purchased products appear in storage and can be requested for delivery under the disclosed storage and shipping conditions. Kuji sales are not enabled.

Reviewer access, payment TEST environment, installed build identity and actual costs must match the submitted build. Existing historical draw orders remain recoverable; they are not offered as new purchases.

## 제출 전 확인

- 종류별 실물 수량과 개별 SKU의 사진·이름·가격 일치
- 선택 SKU 주문, 서버 결제 확인, 동일 SKU 보관, 배송 및 취소·환불
- 실패·중복·재시작 시 같은 주문 복구 및 재고 중복 지급 방지
- 직접 선택 구매 약관 게시와 새 버전 재동의
- 서명 iPhone/Android 설치 확인, 실제 스크린샷, 심사 계정 접근
- PG 승인 및 스토어 제출은 별도 외부 절차
