# Public commerce-rule references (2026-09-26)

This is a **system-rules** reference for DABBOBA, not a screen-structure or visual-design reference and not a claim that another app's private implementation has been reproduced. Keep DABBOBA's own navigation, cards, artwork, animation, and copy. Compare customer-visible state transitions and operational rules instead: what can be bought, when payment is confirmed, when a draw may be opened, when its result is shown, how acquired items enter storage, and how exchange, points, and shipping work.

| Publicly verifiable statement | Source | What it does **not** establish |
| --- | --- | --- |
| Pickuri describes product selection → online purchase → immediate result confirmation → storage → a later shipping request. | [Duckflex, Pickuri operator](https://duckflex.kr/) | The server's exact result-commit instant, payment provider, Kuji slot binding, cancellation/refund behavior, or the duration of storage. |
| Pickuri's Google Play listing tells customers they can check the remaining Kuji quantity before drawing, describes Gacha as a random character outcome, and says acquired items stay in storage until a later shipping request. | [Pickuri Google Play listing](https://play.google.com/store/apps/details?id=kr.duckflex.pickuri.app&hl=ko) | Exact odds math, deck reservation timing, payment/PG mechanics, storage duration, and shipping fees. |
| Pick&Pop's current App Store description describes draws, user exchange or point conversion, shipping, published Kuji odds, and live draw activity. | [Pick&Pop current App Store listing](https://apps.apple.com/kr/app/%ED%94%BD%EC%95%A4%ED%8C%9D-%EB%82%B4-%EC%86%90%EC%95%88%EC%9D%98-%EA%B0%80%EC%B1%A0-%EC%BF%A0%EC%A7%80%EC%83%B5/id6752372089) | The exact payment/result sequence, point calculation, current shipping thresholds, or refund eligibility. |
| Pick&Pop's public site advertises a half-value point return, choosing items to ship together, and a joining-point promotion. | [Pick&Pop public site](https://www.pickandpop.co.kr/) | Whether these offers apply to every item, their eligibility/expiry details, and whether they will remain in force. They are not DABBOBA terms. |

## Functional comparison boundary

| Rule to compare | Public evidence | DABBOBA decision or verification needed |
| --- | --- | --- |
| Purchase → result → storage → later shipping | Pickuri's operator describes this customer-facing sequence. | Verify payment before any draw consumption, durable result after opening, inventory ownership, and a separate shipping request. Do not infer the internal result-commit instant from the marketing sequence. |
| Exchange and point conversion after acquisition | Pick&Pop advertises both features; its public site markets a half-value point return. | Keep DABBOBA's own exchange safety rules and point eligibility. The competitor's advertised rate is not permission to change DABBOBA's conversion rate or apply points to ineligible Kuji/promotional items. |
| Kuji remaining quantity, odds and live activity | Pickuri's Play listing advertises remaining-count visibility; Pick&Pop advertises odds disclosure and live draw activity. | Show actual published odds/deck counts, keep server-owned slot assignment and draw audit, and never fabricate activity or counts. |
| Refund, cancellation, expired storage, delivery fee | Neither cited source establishes these exact rules. | Use DABBOBA's verified payment/refund state machine and separately approved storage and shipping policies. Test interruptions, retries, and duplicate callbacks before LIVE release. |

Visual matching is outside this document's scope: do not model DABBOBA's tabs, card proportions, typography, illustrations, animation, or copy on these competitors. A feature appearing in a competing app is evidence of a customer-facing capability, not proof of its private algorithm, legal classification, or approval for DABBOBA to make a different disclosure.

DABBOBA's independently approved shipping rule remains: gacha-only bundles are free from 24,900 KRW; any Kuji item raises the threshold to 54,900 KRW; below the applicable threshold, the delivery fee is 3,000 KRW. Storage's baseline is 60 days. These are DABBOBA decisions, not inferred competitor rules.

The current implementation verifies payment and issues server-owned draw entitlements before opening the draw route. An explicit capsule/ticket open consumes an entitlement and commits the immutable result on the server. The cited public materials do not prove whether either competitor commits its result at payment approval or at an explicit open action; do not claim equivalence at that internal boundary. A change to that boundary also changes refund, expiry, inventory, recovery, and audit rules and needs an explicit DABBOBA decision before implementation.

Do not claim that a paid gacha or sealed Kuji outcome is non-random merely because the app eventually reveals the result. Customer and store disclosures must describe the behavior actually implemented and verified.
