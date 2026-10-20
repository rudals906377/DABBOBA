# PG review web source

2026-10-13 전환: 신규 심사 주문은 고객이 정확한 상품과 수량을 고르는 DIRECT 판매 SKU만 사용한다. 아래 PG·확률표 관련 내용은 당시 이력이다. 현재 범위와 배포 순서는 direct-purchase-2026-10-13.md를 따른다.

The owner reports PG review submission complete. This is not PG approval.

`/review/` provides the service, three actual product descriptions, shared
shipping/cancellation/refund notices, and review login on dabboba.net.
The proxy is pinned to payment staging (`lyzcyrdiazorjaqlgblr`) and the exact
three review products. No production commerce setting is changed.
The existing INICIS channel is TEST. KCP V2 TEST channel `DABBOBA_KCP_TEST`
was created on the same friend-owned PortOne store with public site code T0000.
Its channel key is `channel-key-bc0b3dde-475a-490c-85df-c4f4ebdb2b3c`.
Frontend selection stays disabled until the staging API advertises this exact
TEST binding; KCP cannot fall back to an INICIS binding. Backend per-order channel
binding/migration/deployment and actual KCP-window verification are separate work.

The opaque customer session is held only in a Secure HttpOnly SameSite cookie.
POSTs require same-origin checks; API routes, products, quantities and redirect
behavior are bounded. An order intent is persisted before POST with a durable
idempotency key and fixed odds version. Lost responses/reloads replay that same
request. An unknown intent older than 24 hours stays blocked for manual review.

Local checks: review proxy, redirect rejection, unknown-order retry/persistence,
existing site/account-deletion regressions, public-site build and runtime lock.
These checks do not establish actual card authorization, paid draw, refund,
provider webhook delivery, or store approval. Those remain launch gates.
Credentials are outside Git and must not be included in public review materials.
