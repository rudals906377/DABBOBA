# INICIS / KCP card channel binding

The primary server rail remains `PAYMENT_PROVIDER=PORTONE_V2_INICIS`. An optional
`PORTONE_KCP_CHANNEL_KEY` adds a KCP V2 card channel in the same merchant, store,
and `PORTONE_CHANNEL_ENVIRONMENT`; it never replaces the primary INICIS key.
An unset optional key preserves the INICIS-only behavior. Production commerce
remains PRELAUNCH until the separate release gates are met.

## Deployment order

1. Apply committed migration `0082_portone_card_channel_binding.sql` before the
   new API version. Do not edit previously applied migrations.
2. Configure the additional public KCP channel key only in the intended backend.
   API/webhook secrets remain server-only. TEST and LIVE channels cannot be mixed.
   Supabase Edge uses the namespaced `DABBOBA_API_PORTONE_KCP_CHANNEL_KEY`.
   The worker receives no PG channels or API secrets; its existing authenticated
   canonical API requery is also responsible for KCP recovery.
3. Deploy API/worker with the matching frontend. No migration or provider-setting
   deployment is performed merely by committing this implementation.
4. Test both existing INICIS and optional KCP flows independently before release.

## Client contract

LIVE `/v1/public/config` exposes `cardPaymentOptions`; PRELAUNCH returns `[]`.
Each option contains `provider`, `pgProvider`, `merchantId`, `storeId`,
`channelKey`, and `channelEnvironment`, never secrets.

`POST /v1/orders` accepts optional `cardPg: "INICIS" | "KCP"`. Omission retains
INICIS. The normalized choice participates in the idempotency fingerprint.
The server selects and persists the exact channel in `payments`; the returned
`Order.cardPayment` is that immutable binding. A client must use this order
snapshot, not a global current channel, when opening the PortOne card window.
Changing PG for an existing order requires closing/reconciling that order and
creating a fresh intent; changing a retry's PG with the same key conflicts.

The binding is immutable at SQL level. Provider verification, confirmation,
abandonment, webhook recovery, worker recovery, and refunds use the saved PG
identity. A KCP response cannot fulfill an INICIS ledger or vice versa.
Historical INICIS orders without a snapshot retain the legacy primary fallback;
KCP orders without a complete snapshot are rejected. Channel removal/rotation
fails closed for affected snapshots: reconcile pending orders and preserve a
supported channel until refunds/recovery for its orders are no longer needed.

## Provider-specific browser constraints

Use CARD/KRW. KCP limits `paymentId` to 40 characters and `orderName` to 100 UTF-8
bytes. Its official UUID example supports the existing 36-character payment UUID.
Do not generalize an observed INICIS READY-amount workaround to KCP without KCP
evidence. TEST window display is not payment approval, settlement, cancellation,
refund, webhook delivery, or release approval.

Source: [PortOne KCP V2 integration](https://developers.portone.io/opi/ko/integration/pg/v2/kcp-v2).
