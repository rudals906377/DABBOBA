# PortOne channels and server release — 2026-10-14

The owner requested completion of payment connection and production server deployment. Both current applications use PortOne: EasyPay/KICC V2 and NICE V2. The included-product flow, Kuji coming soon, retained exchange room and disabled new point returns remain unchanged.

The authenticated representative-owned PortOne store currently has no LIVE channel. Public common TEST channels can support the isolated payment review; they do not prove merchant approval or real-money settlement.

Production `rconfxsykttfvznakile` already holds its authentication, storage and worker credentials. Their values are not retrievable from the management API. `scripts/deploy-supabase-preserved-prelaunch.mjs` supports a code-only deployment: verify the fixed project's digests against known configuration and existing runtime/worker/Apple credentials, require unchanged opaque secret digests, refuse payment/reviewer credentials or active background workers, require clean committed source and the full database release check, and verify the public mobile contracts before and after deployment. It never uploads or rotates secrets. This is PRELAUNCH maintenance only; it cannot perform LIVE cutover.

Before applying pending migrations, verify published legal HTML hashes and create/authenticate a fresh encrypted production backup. The standard migration runner preserves existing checksums, handles the documented staging migration rename and applies through 0100. Keep retired DIRECT stock separate and paused. Production starts with 93 recorded migrations through 0092; isolated review staging starts with 83 records including the old name of 0084.

The release smoke now accepts the same optional policy revision suffix as the API/mobile contract, including `2026-10-13-r2`. Malformed revisions remain rejected. Focused deployment and public contract checks passed 42 tests without skips.

Deployment receipts and provider-window evidence are recorded after execution. Actual card payment, refund, signed webhook delivery, native-device validation, PG approval and LIVE activation are separate evidence requirements.

## Executed server deployment

Production backup authentication passed (881,017 encrypted bytes), published R2 terms/privacy hashes matched 0100, and the standard runner applied eight migrations from 0093 through 0100. The read-only database release check passed all 101 checksums and runtime/worker role boundaries. Source `71897a9` deployed customer API v27, admin API v31 and worker v12; custom secret digests remained unchanged and the anonymous worker invocation was denied. Production reports PRELAUNCH, policy `2026-10-13-r2`, eight series, no card options and no purchasable product. Its 46 retired DIRECT SKUs retain 920 units and are all paused/inactive. No worker schedule was added.

The isolated review database now has all 101 migrations. Its historical 0082 PortOne binding record was renamed to 0084 only after exact checksum verification, with the pending migration set applied atomically under an advisory lock. Representative-owned common TEST NICE V2 and KICC V2 channels were saved and connected to staging. Historical INICIS/KCP channel identifiers remain available only for recovery. The authenticated PortOne API accepted the existing API secret and reported the new NICE channel's payment with the exact server amount.

## Observed NICE window-close response

The actual NICE TEST card-selection window opened for 7,000 KRW. Closing it without choosing a card returned authenticated PortOne `FAILED`, PG code `I009` (user cancellation), no card method, PG transaction, paid timestamp or cancellation records, and `amount.paid` still equal to the requested amount. The old INICIS-only exception rejected this NICE shape and blocked recovery. Accept only this observed NICE/code pairing under the existing strict no-approval guards; preserve the raw amount and normalize it as terminal failure, never payment or refund. KCP/KICC do not inherit it. Regression tests reject other failure codes, partial/cancelled amounts and approval evidence. Forty-one provider/evidence tests and 21 review-web tests passed, along with API type checking and the public build.

The PortOne console's generic signed webhook probe reached the staging endpoint but returned 422 `WEBHOOK_CONTRACT_MISMATCH`; this is not proof of a valid local payment webhook. Do not weaken the fixed store/UUID/order contract to accept arbitrary console samples. Real transaction-webhook delivery remains unverified until a matching payment event is observed.
