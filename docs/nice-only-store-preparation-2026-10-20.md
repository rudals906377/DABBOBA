# NICE-only store preparation — 2026-10-20

The owner chose NICE V2 through PortOne only, and explicitly approved a browsing-first PRELAUNCH publication to obtain the store URL before NICE approval. Purchases remain unavailable. This replaces the earlier LIVE-first release order; it does not approve production payments or waive store review.

## Change

- The review website offers only NICE. Its proxy rejects new EasyPay orders before reaching the staging API. A previously unknown EasyPay request receives a recoverable refusal so its persisted intent is retained; known historical payment queries and cancellations keep their original bindings.
- The native card label and processor summary name NICE. A future production LIVE build accepts only `PAYMENT_PROVIDER=PORTONE_V2_NICE`; TEST channels remain prohibited for production.
- The public support page describes payment followed by explicit opening and one included product, with no pre-payment item selection and possible duplicates. Kuji remains preparing, exchange remains available and new point returns remain closed.
- The currently published privacy revision `2026-10-13-r2` is preserved byte-for-byte with its recorded consent hash. It lists EasyPay as a planned processor. A separate NICE-only privacy revision must be announced and versioned before a production payment launch; do not silently edit the accepted document or claim the processor update was published.

## Store boundary observed

- Apple app `6815146511` belongs to JEUNGMI KIM / Team MCZ4884P7F. The browser session still shows Developer access, read-only metadata and the updated-program-agreement banner after a provider-team refresh, despite the owner's reported completion. The existing EAS App Store Connect API key successfully saved the PRELAUNCH description, privacy/support URLs and SHOPPING category. An owner or effective App Manager browser session is still needed for the remaining console-only forms and screenshots.
- The latest source is version 1.0.0 / iOS build 6. Previous TestFlight build 5 is not proof of the new source. Requested from application commit `f5b52a9`: iOS `699b0ded-c4a3-4263-90da-43f16e5a467a`, Android `7bb5a3d1-c5f3-42a2-9701-be77a6189515`. These are build requests, not verified uploads or approvals.
- Google Play app `com.dabboba.mobile` is still a draft. The personal developer account currently requires twelve testers for fourteen continuous days and has zero participating testers. Organization conversion is a separate identity-verification flow, not completed by receiving a D-U-N-S number.
- Production public config is PRELAUNCH with no card options. Store-review login is disabled. PG staging credentials are not valid production store-review credentials.

## Verification

The focused review proxy/channel, mobile release-config and public hosting tests pass. The native TypeScript check and public/web build pass. This does not establish signed-device payment behavior, merchant approval, App Review approval, or a working public App Store URL.
