# PortOne channels and server release — 2026-10-14

The owner requested completion of payment connection and production server deployment. Both current applications use PortOne: EasyPay/KICC V2 and NICE V2. The included-product flow, Kuji coming soon, retained exchange room and disabled new point returns remain unchanged.

The authenticated representative-owned PortOne store currently has no LIVE channel. Public common TEST channels can support the isolated payment review; they do not prove merchant approval or real-money settlement.

Production `rconfxsykttfvznakile` already holds its authentication, storage and worker credentials. Their values are not retrievable from the management API. `scripts/deploy-supabase-preserved-prelaunch.mjs` supports a code-only deployment: verify the fixed project's digests against known configuration and existing runtime/worker/Apple credentials, require unchanged opaque secret digests, refuse payment/reviewer credentials or active background workers, require clean committed source and the full database release check, and verify the public mobile contracts before and after deployment. It never uploads or rotates secrets. This is PRELAUNCH maintenance only; it cannot perform LIVE cutover.

Before applying pending migrations, verify published legal HTML hashes and create/authenticate a fresh encrypted production backup. The standard migration runner preserves existing checksums, handles the documented staging migration rename and applies through 0100. Keep retired DIRECT stock separate and paused. Production starts with 93 recorded migrations through 0092; isolated review staging starts with 83 records including the old name of 0084.

The release smoke now accepts the same optional policy revision suffix as the API/mobile contract, including `2026-10-13-r2`. Malformed revisions remain rejected. Focused deployment and public contract checks passed 42 tests without skips.

Deployment receipts and provider-window evidence are recorded after execution. Actual card payment, refund, signed webhook delivery, native-device validation, PG approval and LIVE activation are separate evidence requirements.
