# DABBOBA mobile store release gate

This document separates repository readiness from evidence that can exist only
after using external developer accounts, signed artifacts, store consoles, and
physical devices. A green local check is not App Store or Google Play approval.

The authoritative external ownership checklist is
[friend-owned-release-accounts.md](friend-owned-release-accounts.md).

## Release ownership boundary — 2026-09-23

The final publisher and operator is the user's designated friend. Apple
Developer/App Store Connect, Google Play Console, Expo/EAS, GitHub, Cloudflare
and the domain registrar, Supabase, authentication and push providers, support
mail, PortOne/KG INICIS, settlement, billing, tax, and seller records must be
owned or legally controlled by that friend or by a business whose representation
and control by that friend have been verified.
The developer may retain only named least-privilege collaborator access.

Apple Team `52HC8BV2BL` belongs to the current developer's individual account
and is not used for the DABBOBA public build. The former team's unused DABBOBA
App ID and provisioning profile were removed after approval; other app assets
and shared certificates were preserved.

The friend-owned individual Apple Developer Program Team `MCZ4884P7F` now owns
`com.dabboba.mobile`, App Store Connect app ID `6815146511`, and the signing
credentials for PRELAUNCH `1.0.0 (1)`. Apple verified the uploaded TestFlight
build and its metadata reports `MCZ4884P7F.com.dabboba.mobile`. Physical-device
testing and public App Store submission remain separate gates.

The public legal identity must also be internally consistent. The store seller
name, published policy operator, domain and support-mail controller, PG merchant,
settlement account, tax records, and customer-support contact must identify the
friend or the same verified friend-controlled business. Do not put personal identifiers
or recovery details in this repository; retain only non-secret account IDs and
dated verification evidence.

## Current repository boundary

- `apps/mobile/eas.json` defines an internal payment-disabled `preview`, an
  internal payment-window `pg-review`, a payment-disabled
  `production-prelaunch`, and a payment-enabled `production-live` build.
  Its iOS submit profiles contain only the public App Store Connect app ID;
  submit credentials and secrets stay outside Git.
- App version `1.0.0`, the next iOS build number `2`, Android version code `1`,
  bundle and package IDs, and the approved app icon are explicit in
  `apps/mobile/app.json`. iOS build `1` is the older TestFlight upload from
  commit `933186d`; a new candidate cannot reuse that build string. Bump each
  platform's build identifier before another upload to that store.
- Local Expo CLI resolution matches the configured
  `@dabboba-team/dabboba-mobile` project ID
  `fa48d52e-3b3c-4e2b-82d5-ae0726382587`. The current Expo account can manage
  and publish this organization project, and its default Android keystore is
  attached. Sign in with Apple is declared. The friend-owned Apple Team
  `MCZ4884P7F` owns the Bundle ID and the verified PRELAUNCH TestFlight upload
  described below. This establishes iOS signing and upload only; it does not
  establish physical-device QA or public App Store approval.
- Android uses a separate transparent safe-zone foreground and the DABBOBA
  green background for its adaptive icon. The signed AAB still needs launcher
  inspection across circle, squircle, and manufacturer masks.
- `preview` is not a store artifact. Expo documents preview builds as internal,
  production-like testing builds, while the production profile is the store
  path: <https://docs.expo.dev/build/eas-json/>.
- The first public `1.0.0` release is the payment-disabled PRELAUNCH catalog.
  It uses `production-prelaunch`, a production server reporting commerce mode
  `PRELAUNCH`, and `PAYMENT_PROVIDER=UNCONFIGURED`. Product discovery, search,
  wishlists, notices, and account controls must be complete, while order,
  payment, draw, kuji-room, exchange, point-return, and shipping mutations stay
  inaccessible in both the app and API. It must never expose development
  TEST_PG controls, fabricate payment success, issue a draw entitlement, or
  create shippable inventory.
- `production-live` is a later release gate. It requires a reviewed PortOne V2
  → KG INICIS LIVE channel, production webhooks, cancellation/refund and
  reconciliation evidence, and a production server reporting commerce mode
  `LIVE`. Changing only the server can never upgrade a PRELAUNCH binary.
- `apps/mobile/app.config.js` omits the PortOne native config plugin unless the
  build capability is exactly `LIVE`. The later payment implementation remains
  in source, while PRELAUNCH avoids adding bank-app URL schemes and Android
  payment-app package queries to the native manifest.
- The internal `pg-review` profile may be used to capture the test-channel
  payment screens requested during KG INICIS onboarding. The ordinary `preview`
  keeps payment disabled. Those screenshots are design/onboarding evidence,
  not proof that payment return URLs, webhooks, refunds, reconciliation, or
  duplicate-payment prevention work.
- EAS release profiles run the repository gates automatically after dependency
  installation. Store profiles run the full configuration and bundle checks;
  the internal `pg-review` profile requires its API, Supabase publishable key,
  PortOne Store ID and Channel Key, plus the same bundle scan. It exempts only
  public-LIVE legal/server checks that do not apply to the isolated test-channel
  capture and therefore cannot pass as a public LIVE release.
- PortOne's published requirements describe APK plus payment-path screenshots;
  they do not explicitly promise that a TestFlight or Play closed-test link
  alone is accepted. Keep the written confirmation request and capture sequence
  in `docs/kg-inicis-card-review.md`.
- After a reviewed Edge deployment, run `corepack pnpm run supabase:edge:public:verify`.
  The deploy command also runs this read-only smoke before reporting success. It
  requires `PRELAUNCH` public config and the current Home/recent-draw response
  contracts, not merely an API health check. On 2026-09-24 the deployed API
  returned 404 for `/v1/public/config` and `/v1/catalog/recent-draws`, while
  the local API source registered both routes. This deployment remains a
  release blocker until a clean reviewed build is deployed and the smoke passes.
- On 2026-09-24, `api.dabboba.net` did not resolve from the development host,
  and the new exact-URL mobile API smoke failed before its first response. DNS
  setup and a successful five-route read-only smoke are required before this
  address can be used in a signed customer build.
- On 2026-09-24 the local required integration run passed with no skipped DB,
  worker, or API cases after migration 0066 repaired the pgmq worker's
  `set_vt` dependency and Turbo forwarded all test-role URLs. The full local
  suite, Expo dependency check, runtime integrity check, and iOS/Android
  production JavaScript export marker scan also passed. The marker scan used a
  non-production publishable-key placeholder and proves only bundle contents,
  not signed artifacts or customer login. The exact mobile public API smoke
  still fails because the API hostname does not resolve; the deployed Edge
  function's public config still returns HTTP 404.

## Explicit automated gates

Run the static, credential-free check in ordinary CI:

```sh
corepack pnpm run release:mobile:check -- --structure-only
```

It checks platform identifiers and versions, 1024×1024 icon metadata, adaptive
icon readiness, EAS profile shape, and the source guards that keep the draw
preview, internal account bootstrap, and TEST_PG controls out of release builds.

Run the first public PRELAUNCH configuration gate only with the exact public
build values for the candidate:

```sh
EXPO_PUBLIC_DABBOBA_API_URL=https://api.dabboba.net \
PAYMENT_PROVIDER=UNCONFIGURED \
DABBOBA_COMMERCE_MODE=PRELAUNCH \
EXPO_PUBLIC_SUPABASE_URL=https://... \
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
EXPO_PUBLIC_DABBOBA_PRIVACY_POLICY_URL=https://dabboba.net/privacy \
EXPO_PUBLIC_DABBOBA_TERMS_URL=https://dabboba.net/terms \
EXPO_PUBLIC_DABBOBA_SUPPORT_URL=https://dabboba.net/support \
EXPO_PUBLIC_DABBOBA_ACCOUNT_DELETION_URL=https://dabboba.net/account-deletion \
EXPO_PUBLIC_COMMERCE_CAPABILITY=PRELAUNCH \
corepack pnpm run release:mobile:check
```

The configuration check validates URL shape, not DNS or API availability. With
the same `EXPO_PUBLIC_DABBOBA_API_URL` and `EXPO_PUBLIC_COMMERCE_CAPABILITY`
values as the candidate build, run `corepack pnpm run release:mobile:api:verify`
before signing. This read-only gate checks public configuration, recent draws,
Home sections, products, and IPs through the exact URL the app will use. A
missing DNS record, stale Edge deployment, invalid response, or wrong commerce
mode fails the gate; do not replace the result with local fixture products. The
same check runs automatically inside production EAS builds; the separate
internal PG-review profile does not require the public catalog to be live.

For the later LIVE candidate, use the payment-enabled values:

```sh
EXPO_PUBLIC_DABBOBA_API_URL=https://... \
PAYMENT_PROVIDER=PORTONE_V2_INICIS \
DABBOBA_COMMERCE_MODE=LIVE \
PORTONE_CHANNEL_ENVIRONMENT=LIVE \
EXPO_PUBLIC_SUPABASE_URL=https://... \
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
EXPO_PUBLIC_DABBOBA_PRIVACY_POLICY_URL=https://... \
EXPO_PUBLIC_DABBOBA_TERMS_URL=https://... \
EXPO_PUBLIC_DABBOBA_SUPPORT_URL=https://... \
EXPO_PUBLIC_DABBOBA_ACCOUNT_DELETION_URL=https://... \
EXPO_PUBLIC_COMMERCE_CAPABILITY=LIVE \
corepack pnpm run release:mobile:check
```

The manually triggered `Mobile production release readiness` GitHub workflow
runs the same fail-closed check with variables from the protected
`mobile-production` environment. Missing values fail that workflow without
blocking ordinary pull-request CI while the external setup remains unfinished.
The checker accepts only public HTTPS addresses and rejects Supabase
secret/service-role keys. It rejects a configured payment provider in
PRELAUNCH, and an absent/unconfigured provider in LIVE. A `LIVE` candidate is also rejected
while the published terms or privacy document still describes a prelaunch
version where payment is unavailable. It does not print configured values.
The PRELAUNCH gate is independent of PG onboarding. The LIVE gate is expected
to fail during PG onboarding even when all public URLs are supplied; that
failure is the intended payment-release boundary, not a reason to weaken the
checker.

The currently registered mobile representative number remains a visible
warning for a payment-disabled PRELAUNCH build so it does not block creation of
an internal signed artifact. It is still a hard error for `pg-review` and
`production-live`, and the account owner must verify the final store review
contact before public submission.

## External account steps — not performed by repository work

1. Make the friend the durable owner of the Expo/EAS organization, GitHub
   repository or organization, Cloudflare/domain account, Supabase organization,
   support mailbox, identity/push providers, and later PG/settlement accounts.
   Confirm recovery and MFA before reducing the current developer to a scoped
   collaborator. Do not record personal recovery data or secrets in Git.
2. Use the verified friend-owned paid Apple Developer Team `MCZ4884P7F`. Do not
   use Team `52HC8BV2BL` for DABBOBA release.
3. Resolve the Bundle ID before creating an App Store Connect record. The current
   team already registered `com.dabboba.mobile`. Apple allows an App ID to be
   removed only when it has not been uploaded to App Store Connect, and an App
   transfer requires at least one released version. Because DABBOBA has no
   released App Store version, do not attempt the normal app-transfer flow.
   After confirming the current identifier's upload and Sign in with Apple
   status in Apple's portal, use one of these reviewed paths:
   - remove the unused App ID and its obsolete profile from the current team,
     then register the same Bundle ID and fresh credentials in the friend team;
   - if Apple does not permit safe reuse, select a new friend-owned Bundle ID and
     update Expo, deep links, Sign in with Apple, push, auth redirects, and later
     PG/store configuration before building.
   See Apple's [App ID removal rules](https://developer.apple.com/help/account/identifiers/delete-an-app-id)
   and [app-transfer criteria](https://developer.apple.com/help/app-store-connect/transfer-an-app/app-transfer-criteria).
4. Create the friend-owned Google Play app record and confirm package ownership,
   agreements, seller identity, tax/banking state where relevant, and
   least-privilege submit access. Add submit IDs only after those exact records
   exist; never add signing keys or service-account JSON to Git.
5. Produce signed builds from a clean, reviewed commit. `cli.requireCommit` is
   intentionally enabled, so uncommitted migrations or UI changes cannot become
   an untraceable store binary.
6. Upload the first iOS build to TestFlight and the first Android App Bundle to
   a Play internal-testing track. EAS Submit can upload binaries, but store
   metadata, screenshots, review notes, and release decisions still belong in
   App Store Connect and Play Console: <https://docs.expo.dev/deploy/submit-to-app-stores/>.
7. Do not promote either build until the signed-artifact checks below pass.

Expo organization access, the existing Android build credential, and the iOS
distribution certificate/provisioning profile were confirmed on 2026-09-22.
The fail-closed PRELAUNCH public values were also registered in EAS Production,
without PortOne or server secrets. The signed iOS build
`579aa393-b5d6-42de-a167-dec3bce3e4ec` from commit `933186d` was uploaded
through EAS submission `c1235fc9-d334-4e63-bdf9-d3f5f9091bd5` and Apple
marked it valid and ready for internal beta testing on 2026-09-23. This is not
physical-device QA, Google Play testing, or public App Store approval.

## Signed artifact and device QA

Record the exact Git commit, EAS build IDs, version/build numbers, tester,
device/OS, date, and result. At minimum verify both platforms for:

- installed display name, launcher icon/adaptive masks, splash, orientation,
  status/navigation safe areas, and cold/warm start;
- production API and asset origins, TLS failures, offline launch, slow or lost
  network, retry behavior, and no local/development host fallback;
- Kakao, Naver, Google, Apple, and email OTP callback into `dabboba://`, app
  termination during login, token restoration after restart, logout, and
  account deletion with real non-admin customer accounts;
- guest browsing and login gates, background/foreground transitions, push
  permission denial, deep links, and no TEST_PG, demo account, preview route, or
  fake draw-success surface in the release artifact;
- PortOne/KG payment-window return, app termination and resume, server re-query,
  duplicate or out-of-order webhooks, amount mismatch, cancellation/refund,
  reservation expiry, and network loss. Failed or uncertain states must leave no
  paid order, entitlement, inventory, point debit, shipping request, or
  misleading success UI;
- VoiceOver/TalkBack, Dynamic Type/font scaling, reduced motion, contrast,
  target sizes, keyboard avoidance, and screen-reader order;
- crash-free smoke passes and symbol/source-map upload in the chosen crash
  monitoring service.

Inspect the generated native manifest/entitlements rather than assuming Expo
configuration equals the signed binary. Review iOS URL schemes, associated
domains/notifications capabilities if enabled, privacy usage descriptions,
Android intent filters, permissions, exported components, target SDK, network
security configuration, and the final AAB/IPA signing identity. Keep the
inspection output with the release evidence; do not commit provisioning
profiles, certificates, or private keys.

`ios.supportsTablet` is disabled. The first release is iPhone-only; iPad support
must be reopened as a separate layout and store-metadata decision rather than
being enabled accidentally by a build default.

## Policy, support, deletion, and operational blockers

- Publish working privacy, terms, support, and account-deletion HTTPS pages.
  Placeholder pages do not satisfy the full release gate.
- Complete operator identity, contact information, processors, retention,
  commerce/random-item disclosures, effective dates, and legal review. Bundled
  in-app drafts are not publication-ready legal advice.
- Verify the in-app deletion flow against a real customer and provide a
  functional web deletion/request route. Google Play requires both an in-app
  path and an external web resource when the app supports account creation:
  <https://support.google.com/googleplay/android-developer/answer/13327111>.
- Complete App Store privacy nutrition labels and Google Play Data safety from
  observed production data flows and SDK behavior, not from planned behavior.
- For the first PRELAUNCH release, use App Store Connect and Play Console crash
  reporting plus redacted server structured logs; do not add a new behavioral
  analytics or advertising SDK. Assign an owner and alert review cadence. A
  dedicated crash SDK is a later explicit privacy and release decision.
- Re-read the current Apple App Review Guidelines at submission time, especially
  completeness, login/reviewer access, privacy, account deletion, and commerce:
  <https://developer.apple.com/app-store/review/guidelines/>.

Public PRELAUNCH submission remains blocked until the PRELAUNCH configuration gate, signed
artifact QA, real authentication matrix, policy/deletion pages, legal metadata,
crash monitoring, reviewer instructions, screenshots, and store-console forms
have current evidence. PG onboarding and payment review use the separate
`pg-review` artifact and never redefine the PRELAUNCH public binary as
payment-capable.
