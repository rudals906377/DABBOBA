# DABBOBA storefront

다뽀바의 공개 사전오픈 소개 페이지입니다. 픽앤팝 사이트에서 한 화면에 한 메시지를 보여주는 흐름만 참고하고, 다뽀바의 브랜드·정책·접근성 규칙으로 별도 구현했습니다.

## 화면 구성

1. 브랜드 소개
2. 앱 화면 미리보기
3. 관심 상품
4. 보관·배송 정책
5. 쿠지샵 오픈 예정
6. 사전오픈 및 공개 정책 링크

## 사전오픈 원칙

- 구매·결제·뽑기·배송 신청 CTA를 노출하지 않습니다.
- `0원` 상품이나 가짜 상품 데이터를 표시하지 않습니다.
- 쿠지는 완성된 오픈 예정 화면으로 안내합니다.
- 이용약관, 개인정보처리방침, 고객지원, 계정 삭제 링크를 항상 제공합니다.
- 정식 오픈 후 적용될 배송·보관 기준은 그 상태를 명시합니다.

## 로컬 확인

```sh
corepack pnpm --filter @dabboba/storefront dev
```

기본 주소는 `http://localhost:4190`입니다.

## 검증

```sh
corepack pnpm --filter @dabboba/storefront typecheck
corepack pnpm --filter @dabboba/storefront test
corepack pnpm --filter @dabboba/storefront run test:browser
corepack pnpm --filter @dabboba/storefront build
```
