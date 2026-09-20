# DABBOBA mobile store release gate

This document separates repository readiness from evidence that can exist only
after using external developer accounts, signed artifacts, store consoles, and
physical devices. A green local check is not App Store or Google Play approval.

## Current repository boundary

- `apps/mobile/eas.json` defines an internal payment-disabled `preview`, an
  internal payment-window `pg-review`, a payment-disabled
  `production-prelaunch`, and a payment-enabled `production-live` build.
  It deliberately contains no Apple, Google, Expo account ID, submit credential,
  or secret.
- App version `1.0.0`, iOS build number `1`, Android version code `1`, bundle and
  package IDs, and the approved app icon are explicit in
  `apps/mobile/app.json`. Bump both platform build identifiers for every
  uploaded binary.
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
- The internal `pg-review` profile may be used to capture the test-channel
  payment screens requested during KG INICIS onboarding. The ordinary `preview`
  keeps payment disabled. Those screenshots are design/onboarding evidence,
  not proof that payment return URLs, webhooks, refunds, reconciliation, or
  duplicate-payment prevention work.
- PortOne's published requirements describe APK plus payment-path screenshots;
  they do not explicitly promise that a TestFlight or Play closed-test link
  alone is accepted. Keep the written confirmation request and capture sequence
  in `docs/kg-inicis-card-review.md`.

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
EXPO_PUBLIC_DABBOBA_API_URL=https://api.dabboba.com \
PAYMENT_PROVIDER=UNCONFIGURED \
DABBOBA_COMMERCE_MODE=PRELAUNCH \
EXPO_PUBLIC_SUPABASE_URL=https://... \
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... \
EXPO_PUBLIC_DABBOBA_PRIVACY_POLICY_URL=https://dabboba.com/privacy \
EXPO_PUBLIC_DABBOBA_TERMS_URL=https://dabboba.com/terms \
EXPO_PUBLIC_DABBOBA_SUPPORT_URL=https://dabboba.com/support \
EXPO_PUBLIC_DABBOBA_ACCOUNT_DELETION_URL=https://dabboba.com/account-deletion \
EXPO_PUBLIC_COMMERCE_CAPABILITY=PRELAUNCH \
corepack pnpm run release:mobile:check
```

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

## External account steps — not performed by repository work

1. Create or select the exact Expo organization/project, run `eas init` from
   `apps/mobile`, review the resulting project ID, and commit that association.
   Do not reuse an unrelated Expo project.
2. Confirm the Apple Developer team, App Store Connect app record, Google Play
   app record, package ownership, agreements, tax/banking state where relevant,
   and least-privilege submit access. Add submit IDs only after those exact
   records exist; never add signing keys or service-account JSON to Git.
3. Produce signed builds from a clean, reviewed commit. `cli.requireCommit` is
   intentionally enabled, so uncommitted migrations or UI changes cannot become
   an untraceable store binary.
4. Upload the first iOS build to TestFlight and the first Android App Bundle to
   a Play internal-testing track. EAS Submit can upload binaries, but store
   metadata, screenshots, review notes, and release decisions still belong in
   App Store Connect and Play Console: <https://docs.expo.dev/deploy/submit-to-app-stores/>.
5. Do not promote either build until the signed-artifact checks below pass.

No `eas login`, `eas init`, cloud build, credential generation, TestFlight/Play
upload, or store submission is performed by the repository setup above.

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
