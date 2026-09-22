# DABBOBA Admin

Separate Next.js App Router operations console for DABBOBA. It talks only to the shared REST API and never imports the database package.

This package intentionally remains separate from the customer Vite/Expo UI. It uses Next.js 16.3 and React 19, and does not add an `/admin` route to the customer application.

## Security boundary

- The browser submits credentials to the same-origin `/api/auth/login` route.
- In production, the BFF reads one explicitly configured edge-overwritten client IP header and signs the normalized IP, user agent, and short timestamp with `ADMIN_PROXY_IDENTITY_SECRET`. The API verifies that context before using it for login limiting, audit, or session metadata; it never trusts browser-supplied forwarding headers directly.
- The route exchanges them for the API's opaque admin session token and stores it in a host-only `Secure`, `HttpOnly`, `SameSite=Strict` cookie.
- Server components and server actions read that cookie and call `/v1/admin/*` with a bearer token. The token is never rendered into HTML or stored in browser storage.
- The server-only DAL checks the current actor through `/v1/admin/me` before reads and mutations. The API remains authoritative for RBAC and every state transition.
- Navigation and actions use the permission codes returned by `/v1/admin/me`; administrator provisioning remains `SUPER_ADMIN`/`roles.manage` only.
- All mutations require an operator reason. The reason is sent in `x-admin-reason`; endpoints whose schema includes a reason also receive it in the JSON body.

## Local configuration

If `.env.local` does not exist, copy `.env.example` to it and point `DABBOBA_API_URL` at the local API; do not overwrite an existing secrets file. Open the admin app through `localhost`/loopback so browsers accept the Secure host cookie in local development. Local development may leave `ADMIN_PROXY_IDENTITY_SECRET` and `ADMIN_EDGE_CLIENT_IP_HEADER` empty; production requires both. The selected edge header must be stripped and overwritten by ingress and contain exactly one IP literal. See `docs/dabboba-operations-runbook.md` for the deployment and rotation checklist.

The API must already expose the OpenAPI paths under `/v1/admin`. There is deliberately no fixture login, mock administrator, database fallback, or direct public-browser API client.

The admin UI treats the API as authoritative. The API independently enforces roles, allowed state transitions, idempotency, append-only audit recording, and the `x-admin-reason` policy. Navigation follows the permission list returned by `/v1/admin/me`; administrator provisioning still requires an active `SUPER_ADMIN`.

The operations console currently covers dashboard metrics, users and administrator accounts, account-deletion review, notices, conversational inquiries with internal notes, posts/comments/reports, exchange resolution, IP/character/product/catalog requests, draw probability versions, order and payment inspection, refund review, append-only inventory adjustment, shipping transitions, media previews, and append-only audit history. Account-deletion approval records that the blockers were reviewed, but deliberately does not physically delete or anonymize the account; that final transition requires an approved retention/anonymization policy. Refund review records an operator decision but deliberately does not call a real payment provider. Push campaigns, MFA, production identity providers, provider-side refund execution, and cloud deployment remain explicit later stages rather than fixture-backed claims.

## Package checks

From the workspace root, use the workspace scripts once dependencies and generated contracts are present. Package-focused commands are:

```sh
pnpm --filter @dabboba/admin typecheck
pnpm --filter @dabboba/admin test
pnpm --filter @dabboba/admin build
```

The focused dependency-free boundary test can also be run directly:

```sh
node --test apps/admin/tests/*.test.mjs
```
