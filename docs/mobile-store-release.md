# DABBOBA mobile store release gate

## 2026-10-01 current preparation boundary

The owner's newer launch scope is eight gacha products only; Kuji is deferred.
The current LIVE public API gate requires genuinely purchasable gacha and rejects
sellable Kuji in this first-launch scope. Empty or coming-soon Kuji is allowed.
The four social methods remain required; PHONE is an additional requirement only
when its readiness flag is approved and device-tested. Older dated sections
below that require both categories or always require five methods are historical.
The owner chose to prepare an actual Google Play submission rather than wait for
a written policy reply; this is not a claim of store approval or legal clearance.

The latest local source integrates PR #9 while preserving current security,
authentication and PRELAUNCH guards. Fresh disposable-DB tests and both-platform
production bundle marker scans passed; they do not constitute signed device or
real payment evidence. See [no-login preparation](no-login-launch-preparation-2026-10-01.md).

This document separates repository readiness from evidence that can exist only
after using external developer accounts, signed artifacts, store consoles, and
physical devices. A green local check is not App Store or Google Play approval.

The authoritative external ownership checklist is
[friend-owned-release-accounts.md](friend-owned-release-accounts.md).

## 2026-09-26 launch decision — LIVE first

The owner changed the public-release target: the first public app must support
verified PortOne V2 → KG INICIS payment followed by server-authoritative gacha
and kuji draws. The older PRELAUNCH-first instructions below are historical
context, not permission to submit a payment-disabled catalog as the final app.
Keep the current PRELAUNCH server/binary fail-closed until LIVE is actually
approved and tested; changing a flag or shipping a payment-screen mock is not
completion.

The production API checked again on 2026-09-26 still returned `PRELAUNCH` and an
empty list of customer login methods (`methods: []`). Its filtered public catalog
returned one gacha item and no Kuji item; this is not evidence that either can
currently be purchased. The new read-only LIVE mobile API gate
requires the social login methods (`KAKAO`, `NAVER`, `GOOGLE`, `APPLE`) and at
least one genuinely purchasable, in-stock gacha and kuji product each. `PHONE`
(SMS OTP) is required only when the build environment and the Edge profile both
set `DABBOBA_PHONE_LOGIN_READY=true` after SMS delivery has been contracted and
verified on real devices; without that flag a LIVE server that lists `PHONE`
fails the gate, and `prepare-supabase-edge-profile.mjs` rejects a LIVE profile
that enables `PHONE`. It is a candidate-screening check, not proof that a real account
can sign in, a card can be charged/refunded, or a draw can complete.
The production release workflow also checks the deployed worker's public
boundary before bundling: `GET` must return the expected 405 handler response,
and an anonymous `POST` with no body or secret must return its 401 denial. It
does not execute a worker job, validate the real invoke secret, prove that Cron
runs, or verify reconciliation. The 2026-09-26 public check failed because the
production worker handler was not deployed; this remains a LIVE blocker. The
local workspace's Expo SDK 57 patch dependencies now pass `expo install --check`
and Expo Doctor's 21 checks, but those checks do not prove a signed binary or a
physical-device payment return.

Migration `0069` and the super-admin API provide one durable, full-amount
PortOne cancellation attempt for two narrow cases: a cancelled late payment
with no issued assets, and a paid gacha/kuji-only order whose draw entitlements
are all still available. In the latter case the order is frozen in
`REFUND_REVIEW` before the external cancellation call, so a concurrent draw
cannot consume an entitlement. On verified full cancellation, the local
entitlements are cancelled and stock is restored. A repeated key reads the
original attempt; a different key cannot send a second cancellation. Unknown
outcomes require a fresh provider lookup through the separate reconciliation
route, never a cancellation retry. The admin UI exposes the full-refund action
only for eligible payments to a `refunds.cancel` super-admin while LIVE is
configured, and preserves the attempt in the audit list after reconciliation.
If the initial PortOne read fails before any cancellation call, no attempt or
order freeze is created; the operator can retry once provider access returns.
Local disposable-PostgreSQL integration tests covered both cases, the one-attempt
rule, role denial, PRELAUNCH denial, draw/refund race, and eventual
reconciliation, plus a failed precheck followed by one successful retry. These
are mocked PortOne responses, not a real PG refund test.
Customer self-service refunds, partial/used-draw refund policy, and real
test-channel cancellation remain unfinished. A local-only scheduled
reconciliation path now signs a short-lived worker request to the API; the API
re-reads PortOne and applies the canonical payment handler before the worker
records recovery. Migration `0071` records that outcome, while `0072` limits
the worker's existing payment-table update grant to cancelling an unpaid
reservation. This path passed disposable-database and mocked-provider tests,
but its production schedule, separate secret, network route, and real payment
recovery have not been configured or verified. Do not enable the LIVE rail on
this evidence.

A claimed PortOne window remains on the worker's requery schedule even if its
stock reservation later expires and the local order/payment become CANCELLED.
Migration `0074` indexes this narrow candidate set. A verified late PAID
observation enters REFUND_REVIEW without issuing draw entitlements; a verified
terminal no-charge observation closes the reconciliation schedule. Unclaimed
cancelled payments are not sent to PortOne. This is covered by local
disposable-DB and mocked-provider tests only; provider delay, webhook loss,
real refund, and production scheduling remain launch blockers.
The local API integration test now also exercises that same claimed-and-expired
payment through verified late success, super-admin full cancellation, one paid
ledger entry, one refund ledger entry, no draw entitlement, and idempotent
cancel replay. This links recovery to refund without treating mocked PortOne
responses as a real card refund.

The same late-charge recovery now covers a shipping-fee order only when its
linked delivery request is CANCELLED, still belongs to the payer, contains
items, and has no product order lines. The super-admin refund-review page
exposes the one-time full-cancellation action only after these server checks;
it does not revoke the customer's owned product. Migration `0075` keeps
cancelled shipping-item snapshots for history but permits that item to be
requested again, while a row-serialized trigger rejects overlapping active
requests and a request for another owner's item. Focused tests passed on a
disposable PostgreSQL database with mocked PortOne replies and the runtime DB
role. This is not production migration, real-PG refund, or signed-device proof.

The disposable-PostgreSQL PortOne requery test also follows the resulting
customer entitlement through one server-committed gacha draw, idempotent replay,
and owned inventory visibility. A separate local PortOne-to-kuji integration
test covers paid-order confirmation, two sealed slot selections, immutable
draw results, replay, and owned inventory. It also covers an approval timestamp
outside the kuji checkout lease: no entitlement is issued, the room and stock
reservation are released, and a super-admin's verified full cancellation
reconciles exactly one payment and one refund ledger entry. PortOne GET and
cancel responses are mocked in both tests; these prove local contracts and
persistence, not a real card charge/refund or signed-device payment return.
The PortOne-to-kuji signed-device path still requires separate verification.
The shipping-fee refund regression also now checks that restoration of multiple
inventory units is atomic: if one unit cannot return from `SHIPPING` to `OWNED`,
none may be partially restored before the payment enters `REFUND_REVIEW`.
After an operator resolves the local conflict, an audited admin requery can
reconcile the verified provider refund without creating a second refund ledger
entry; ordinary customer confirmation remains a duplicate replay. This passed
only against disposable PostgreSQL with mocked PortOne responses.
Before opening a new Kuji PG window, the native app now reads the server-bound
room entry ID from the owned order, fetches that exact room snapshot, and
requires CHECKOUT_PENDING with an unexpired absolute server deadline.
An expired lease returns to the product; a mismatched or unavailable room
fails closed. This guard is repeated after the purchaser enters their name,
so time spent on that form cannot silently restart the three-minute lease.
An already-started payment still goes to provider/server reconciliation even
after lease expiry. The focused lease tests and local disposable-database
PortOne/Kuji integration test pass, but a PG flow can still finish after the
lease; the server's late-success/refund-review path and signed-device callback
must be exercised with a real KG test channel before LIVE.

`corepack pnpm run supabase:edge:live:check` is a read-only LIVE candidate
preflight. It reads only the separate private
`../.dabboba-launch/supabase-edge-live.env` (mode `0600`, current-user owned),
requires the five requested login methods, a LIVE PortOne channel, distinct API
payment/webhook secrets, the same dedicated API/worker requery secret, a worker
configured for `PORTONE_API` against this project's API route, production
storage and database roles, and a clean reviewed commit containing migration
`0076` or later. Migration `0076` publishes the 2026-09-30 TERMS/PRIVACY
revision whose only change is the business phone `031-947-9996`; the
release-config gate fails when either public policy phone differs from the
in-app business information. It then runs the target database's read-only release check.
It does not create the profile, apply migrations, upload secrets, deploy a
function, enable Cron, charge a card, or establish provider/store approval.
After the same preflight and project check, `supabase:edge:deploy` builds and
deploys `dabboba-api`, `dabboba-admin-api` (with the shared WASM image
sanitizer, so admin catalog-media completion works), and `dabboba-worker`.
The existing `supabase:edge:deploy` command remains PRELAUNCH-only; do not
point it at a LIVE profile or treat this preflight as authorization to switch
shared production secrets before a reviewed cutover and rollback sequence is
ready.

The 2026-09-26 read-only recheck still blocks LIVE: the source release check
finds uncommitted migrations `0069`–`0075` and a dirty worktree; the separate
private LIVE candidate profile is absent; the hosted API reports `PRELAUNCH`
with zero public login methods; and the hosted worker does not expose the
expected deployed/anonymous-denial boundary. Local unit tests pass
(`891` passed, `3` skipped in the root suite plus `6` API-client tests), all
`20` workspace typecheck tasks pass, and `git diff --check` passes. These
checks do not establish production migration, provider approval, real payment,
or store eligibility.

Release-critical external evidence remains: friend-owned merchant and identity
provider approvals, test/live channels and webhook secrets, successful signed
iOS/Android payment return and failure/duplicate/refund tests, production
worker/reconciliation checks, domestic legal review, and store review. Google
Play's [real-money games policy](https://support.google.com/googleplay/android-developer/answer/9877032/)
explicitly gives paid games offering a chance at a physical prize as a violation
example. Obtain a written classification from Google and a qualified Korean
legal review before treating the Android paid-draw design as distributable; a
physical-goods payment exception alone does not resolve that policy question.
Showing the selected prize only after payment or draw consumption does not make
the current flow a fixed-product sale. A fixed-product claim would require the
exact item to be determined and disclosed before the customer commits payment,
and a corresponding implemented and tested purchase flow.

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
- The earlier `1.0.0` PRELAUNCH catalog plan has been superseded for public release.
  It uses `production-prelaunch`, a production server reporting commerce mode
  `PRELAUNCH`, and `PAYMENT_PROVIDER=UNCONFIGURED`. Product discovery, search,
  wishlists, notices, and account controls must be complete, while order,
  payment, draw, kuji-room, exchange, point-return, and shipping mutations stay
  inaccessible in both the app and API. It must never expose development
  TEST_PG controls, fabricate payment success, issue a draw entitlement, or
  create shippable inventory.
- `production-live` is the target public release gate. It requires a reviewed PortOne V2
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
- Later on 2026-09-24, the project in the user-designated Dabboba organization (`rconfxsykttfvznakile`) received
  the migrated database and private media, and its direct Edge API passed the
  public route smoke in PRELAUNCH. EAS production now targets that direct API
  instead of unresolved `api.dabboba.net`. The full mobile catalog smoke still
  fails because every migrated product is a private DRAFT; authentication,
  account deletion, the worker and a newly signed build remain unverified.
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
EXPO_PUBLIC_DABBOBA_API_URL=https://rconfxsykttfvznakile.supabase.co/functions/v1/dabboba-api \
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

Production (`production-prelaunch` and `production-live`) configuration pins the
customer API host: `EXPO_PUBLIC_DABBOBA_API_URL` must use HTTPS on the default
port and its host must be `${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co`
(currently `rconfxsykttfvznakile.supabase.co`) or an entry in
`APPROVED_PRODUCTION_API_HOSTS` in `scripts/check-mobile-release-config.mjs`
(currently `api.dabboba.net`). Add a new custom domain there deliberately, in a
reviewed change, before building against it. The internal PG-review profile is
not pinned.

`release:mobile:api:verify` also self-attests the server against the build
environment: `DABBOBA_COMMERCE_MODE` must be declared, must equal
`EXPO_PUBLIC_COMMERCE_CAPABILITY`, and must equal the `commerceMode` returned by
`/v1/public/config`. Limitation: the public config does not expose the server's
payment provider today, so `PAYMENT_PROVIDER` is compared only if a future
contract adds `paymentProvider` to that response; until then the gate prints a
warning and reports `paymentProviderAttested: false`, and `PAYMENT_PROVIDER`
remains a build-environment declaration that must be confirmed against the
deployed Edge secrets separately.

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
3. [Done 2026-09-23] The Bundle ID moved to the friend team: the developer
   team's unused App ID and obsolete profile were removed, `com.dabboba.mobile`
   was registered to Team `MCZ4884P7F` with fresh distribution credentials, and
   App Store Connect app ID `6815146511` was created there. Keep this App ID,
   record, and the `ascAppId` pin in `apps/mobile/eas.json`; do not remove,
   re-register, transfer, or duplicate them. Before each iOS upload, run
   `node scripts/verify-ios-artifact-team.mjs <path-to.ipa>` because the source
   `appleTeamId` pin alone cannot prove which EAS credentials signed the binary.
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
device/OS, date, and result.

Before uploading any iOS release artifact, run
`node scripts/verify-ios-artifact-team.mjs <path-to.ipa>`. The source
`appleTeamId` pin cannot prove which EAS credentials signed the binary; this
check reads the embedded provisioning profile and requires Team `MCZ4884P7F`,
application identifier `MCZ4884P7F.com.dabboba.mobile`, `get-task-allow` false,
and an App Store (device-free) profile. It rejects Team `52HC8BV2BL`.

At minimum verify both platforms for:

- installed display name, launcher icon/adaptive masks, splash, orientation,
  status/navigation safe areas, and cold/warm start;
- production API and asset origins, TLS failures, offline launch, slow or lost
  network, retry behavior, and no local/development host fallback;
- phone OTP, Kakao, Naver, Google, and iOS Apple callback into `dabboba://`, app
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
- A native payment screen durably marks a pre-claim intent, then asks the LIVE
  API to atomically claim the first PG window for that owned payment before
  mounting the SDK. The server records `pg_attempt_started_at` (migration 0073)
  and increments the payment version so a worker requery deferred before the
  claim becomes due again after the normal stale window. It rejects another
  window from the same or a different device. A restart
  checks the fresh order and PortOne state; a pre-claim crash with no server
  claim can safely resume. The payment screen's status-refresh action also
  returns to the name/PG-start step only after a fresh owned-order read shows
  no server claim and the Kuji lease remains valid; a claimed or uncertain
  attempt cannot open a second window. The local, database, and reconciliation
  tests are not proof of a real KG/card-app return; this one-window rule can also
  leave an abandoned order waiting for reservation expiry or operator reconciliation;
  verify paid, cancelled, provider-unavailable, and killed-app cases in signed
  iOS/Android builds before enabling LIVE payments;
- The installed `@portone/react-native-sdk` 0.7.0 handles its own internal
  `portone://` result redirect and calls `onComplete`; the app's server requery
  remains authoritative. The merchant `appScheme` is passed as `dabboba://`
  (matching the Expo scheme), but native card-app return still needs signed
  device proof. Do not treat the supplied external `redirectUrl` field alone as
  evidence that the SDK uses that exact URL;
- KG INICIS requires a purchaser name for normal card payment. The native
  screen now asks the customer for that name and rechecks the owned order before
  opening the PG window; it never substitutes a profile nickname or treats this
  entry as identity verification. Check the final privacy disclosures for this
  provider-bound field and confirm acceptance with the actual KG test channel;
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
