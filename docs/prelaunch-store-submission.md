# DABBOBA 1.0.0 PRELAUNCH store submission source

This file is the reviewed source for App Store Connect and Google Play Console.
It is not proof that the values were entered or approved in either console.

## Product scope

- Version: `1.0.0`
- iOS build: `1`
- Android versionCode: `1`
- Locale: Korean first
- Capability: product discovery, search, wishlist, notices, account settings,
  support, legal documents, and account deletion
- Explicitly unavailable: purchase, payment, draw, kuji queue, exchange,
  point return, new shipping request, and shipping-fee payment

## Short description

가챠·쿠지 상품을 미리 둘러보고 관심 상품을 저장하는 다뽀바 사전오픈판

## Full description

DABBOBA는 좋아하는 작품의 가챠·쿠지 상품을 한곳에서 찾고 정리할 수
있는 상품 카탈로그입니다. 작품과 상품을 검색하고, 새로운 상품과 운영
소식을 확인하고, 관심 상품을 저장할 수 있습니다.

첫 공개 버전은 사전오픈판입니다. 결제, 주문, 뽑기, 쿠지 대기열, 교환,
포인트 환급, 배송 신청은 제공하지 않습니다. 해당 기능이 열리기 전에
앱 업데이트와 공지를 통해 별도로 안내합니다.

고객지원: support@dabboba.com

## Review notes

This is a complete payment-disabled PRELAUNCH catalog release. Reviewers can
browse Home, Gacha Shop, the Kuji coming-soon page, search, product details,
notices, and public legal/support pages without making a purchase. Authenticated
customers can save wishlists and manage sessions or request account deletion.

The binary is compiled with `EXPO_PUBLIC_COMMERCE_CAPABILITY=PRELAUNCH`; the API
also runs with `DABBOBA_COMMERCE_MODE=PRELAUNCH` and
`PAYMENT_PROVIDER=UNCONFIGURED`. Customer order, payment, draw, kuji-room,
exchange, point-return, inventory, and shipping mutations return
`COMMERCE_NOT_AVAILABLE`. Server configuration alone cannot enable commerce in
this binary.

No reviewer should be asked to enter payment data. No TEST_PG, demo customer,
fake success state, or hidden purchase route is included in the production
artifact.

## Screenshot acceptance rules

1. Show only screens reachable in the signed PRELAUNCH artifact.
2. Include Home, Gacha Shop, Kuji `오픈 예정`, product detail with
   `관심 상품 저장`, Storage read-only/empty state, and Profile.
3. Do not show prices as immediately purchasable. Use `오픈 예정가` or
   `가격 공개 예정` exactly as the app does.
4. Do not show checkout, payment, draw-result, queue, exchange, point return,
   or shipping-request screens.
5. Do not use `테스트 계정`, synthetic wins, or placeholder legal/support
   URLs in captions.

## Data disclosure working matrix

Store console answers must be checked against the signed build and deployed
API before submission.

| Data | Purpose | Linked to user | Shared with processor |
| --- | --- | --- | --- |
| Email/social identity | Authentication and account recovery | Yes | Supabase and selected identity provider |
| Nickname/profile | Account display and support | Yes | Supabase infrastructure |
| Wishlist and product activity | Requested app function | Yes | Supabase infrastructure |
| Inquiry text/photos | Customer support | Yes | Supabase storage/infrastructure |
| Notification token | Required account/expiry notices | Yes | Push delivery provider when remote push is configured |
| Address/phone retained from prior operations | Account and legal record display; no new PRELAUNCH shipping request | Yes | Supabase infrastructure |
| Diagnostics/server logs | Security, reliability, and abuse prevention | May be linked | Hosting infrastructure |

The first release adds no advertising SDK and no behavioral analytics SDK.
App Store Connect/Play Console crash reports and redacted server logs are the
approved first-release diagnostics boundary.

## External evidence checklist

- [ ] `https://dabboba.com/privacy`, `/terms`, `/support`, and
  `/account-deletion` return HTTPS 200 without login.
- [ ] `support@dabboba.com` can send and receive.
- [ ] Legal owner, retention periods, and policy wording were approved.
- [ ] Image/IP rights evidence is attached to the release record.
- [ ] Signed IPA/AAB was inspected and tested on physical iOS/Android devices.
- [ ] App Store privacy and Google Data Safety answers match the working matrix.
- [ ] Google policy support supplied written classification before any later
  paid chance-based physical-prize Android release.
