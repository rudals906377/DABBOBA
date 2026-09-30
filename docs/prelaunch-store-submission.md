# DABBOBA 1.0.0 PRELAUNCH store submission source

This file is the reviewed source for App Store Connect and Google Play Console.
It is not proof that the values were entered or approved in either console.

## Product scope

- Version: `1.0.0`
- iOS build: `2`
- Android versionCode: `1`
- Locale: Korean first
- Capability: product discovery, search, wishlist, notices, account settings,
  support, legal documents, and account deletion
- Explicitly unavailable: purchase, payment, draw, kuji queue, exchange,
  point return, new shipping request, and shipping-fee payment

## Console-ready Korean metadata

These values are prepared for the first payment-disabled PRELAUNCH binary.
Do not enter the URLs in either store until each URL returns HTTPS 200 without
login. App name, subtitle, and descriptions must continue to match the signed
binary rather than later LIVE commerce plans.

### App Store Connect

- Name: `DABBOBA`
- Primary language: Korean
- Bundle ID: `com.dabboba.mobile`
- SKU: `DABBOBA-IOS-001`
- Subtitle: `가챠·쿠지 상품을 한곳에서`
- Primary category: Shopping
- Secondary category: Entertainment
- Promotional text: `좋아하는 작품의 가챠·쿠지 상품을 둘러보고, 새로운 소식과 관심 상품을 한곳에서 확인해 보세요.`
- Keywords: `가챠,쿠지,피규어,캐릭터,애니메이션,굿즈,컬렉션`
- Support URL: `https://dabboba.net/support`
- Privacy policy URL: `https://dabboba.net/privacy`
- Marketing URL: leave empty for 1.0.0 unless a separate public product page is approved
- Copyright: `2026 다뽀바`
- Price: Free

The Account Holder must still answer Content Rights, age rating, Republic of
Korea availability, DSA trader status, and App Privacy using real contracts and
deployed data flows. Do not infer those declarations from source code.
The Account Holder, store seller, public-policy operator, support controller,
and any later PG/settlement party must be the designated friend or the same
verified friend-controlled business before this source is entered in a console.

### Google Play Console

- App name: `DABBOBA`
- Default language: Korean
- App or game: App
- Free or paid: Free
- Category: Shopping
- Short description: `가챠·쿠지 상품을 미리 둘러보고 관심 상품을 저장하는 다뽀바 사전오픈판`
- Support email: `support@dabboba.net`
- Support phone: unresolved; enter only the account owner's verified business contact
- Website: `https://dabboba.net/support`
- Privacy policy: `https://dabboba.net/privacy`
- Ads: No, unless an advertising SDK or paid placement is added before signing

The developer must still complete Target audience, Content rating, App access,
Data safety, Account deletion, and policy declarations against the signed AAB
and production backend. The store listing is shared across test tracks, so it
must not advertise payment or draw behavior that is absent from PRELAUNCH.

## Short description

가챠·쿠지 상품을 미리 둘러보고 관심 상품을 저장하는 다뽀바 사전오픈판

## Full description

DABBOBA는 좋아하는 작품의 가챠·쿠지 상품을 한곳에서 찾고 정리할 수
있는 상품 카탈로그입니다. 작품과 상품을 검색하고, 새로운 상품과 운영
소식을 확인하고, 관심 상품을 저장할 수 있습니다.

첫 공개 버전은 사전오픈판입니다. 결제, 주문, 뽑기, 쿠지 대기열, 교환,
포인트 환급, 배송 신청은 제공하지 않습니다. 해당 기능이 열리기 전에
앱 업데이트와 공지를 통해 별도로 안내합니다.

고객지원: support@dabboba.net

## Review notes

The following is a submission-note draft. Paste it into a store only after the
signed PRELAUNCH artifact, deployed API, public policy URLs, reviewer access,
and account-deletion flow have been verified against the release record.

This submission is a payment-disabled PRELAUNCH catalog release. Reviewers can
browse Home, Gacha Shop, the Kuji coming-soon page, search, product details,
notices, and public legal/support pages without making a purchase. After the
release test account is supplied, authenticated reviewers can save wishlists,
manage sessions, and request account deletion.

For the submitted artifact, confirm that the binary is compiled with
`EXPO_PUBLIC_COMMERCE_CAPABILITY=PRELAUNCH`; the deployed API must run with
`DABBOBA_COMMERCE_MODE=PRELAUNCH` and
`PAYMENT_PROVIDER=UNCONFIGURED`. Customer order, payment, draw, kuji-room,
exchange, point-return, inventory, and shipping mutations return
`COMMERCE_NOT_AVAILABLE`. Server configuration alone cannot enable commerce in
this binary.

No reviewer should be asked to enter payment data. The later LIVE checkout,
payment, and draw code remains in the binary, but PRELAUNCH exposes no CTA to
it, route guards return users to a safe catalog screen, and server mutations
fail closed. Before copying this note, verify that no TEST_PG, demo customer, or
fake success state is included in the signed submission artifact.

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

- [ ] `https://dabboba.net/privacy`, `/terms`, `/support`, and
  `/account-deletion` return HTTPS 200 without login.
- [ ] `support@dabboba.net` can send and receive.
- [ ] The designated friend (or a business verifiably represented and controlled
  by that friend) matches the store Account Holder/seller, published operator,
  support controller, and later PG/settlement party; retention periods and
  policy wording were approved.
- [ ] Image/IP rights evidence is attached to the release record.
- [ ] Signed IPA/AAB was inspected and tested on physical iOS/Android devices.
- [ ] App Store review contact and Play contact phone use verified owner details.
- [ ] Reviewer account, sign-in steps, and OTP handling notes were tested from a
  fresh install; the account follows ordinary customer authorization rules and
  contains no hidden admin or demo bypass.
- [ ] App Store phone screenshots and Google Play screenshots/feature graphic
  were captured from the signed PRELAUNCH build.
- [ ] App Store privacy and Google Data Safety answers match the working matrix.
- [ ] Google policy support supplied written classification before any later
  paid chance-based physical-prize Android release.
