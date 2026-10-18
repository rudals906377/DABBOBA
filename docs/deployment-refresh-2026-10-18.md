# PRELAUNCH deployment refresh — 2026-10-18

The owner requested commit, push, PR update and deployment of the latest DABBOBA source. The existing branch and PR #42 are retained; this does not authorize merging the PR, public store submission or LIVE sales activation.

## Source and deployment tooling

Native presentation source through `88d84a9` was already committed and pushed. Commit `0588c7b31ddee7f113acdc19fb543e563b4ce824` adds `--use-api` to the preserved PRELAUNCH deployment path. The first attempt waited on the CLI's local `docker info` probe. The retry explicitly bundles on Supabase while keeping the same project, source/database checks, opaque-secret comparisons and PRELAUNCH restrictions.

## Applied production deployment

- Customer API: version **32**, ACTIVE.
- Admin API: version **35**, ACTIVE.
- Worker: version **14**, ACTIVE.
- Applied source: `0588c7b31ddee7f113acdc19fb543e563b4ce824`.
- Production database release check passed; target hash `7f6fdac67f393af1aecb9dfe38bde3dec838262e4e94a6e6aceb492fe16822f3`.
- Custom secret digests matched before and after deployment. No secrets were uploaded or rotated, no migrations were applied and no worker schedule was enabled.
- Public API verification passed before and after deployment. Follow-up reads report PRELAUNCH, policy `2026-10-13-r2`, no card options and eight non-purchasable COMING_SOON gacha series. The four social login methods remain registered.
- Worker boundary checks passed: GET 405 and anonymous POST 401. These do not execute jobs or prove scheduled reconciliation.

The admin Cloudflare build passed its local-secret and API-target scan. Worker version `261d8b60-2ace-464c-bbb9-b263a565879f` is deployed at **100%**, confirmed independently through the deployment list. Deployment ID: `338a70bb-350c-477a-916c-a425f4b978d0`. The CLI subsequently returned an error while discovering the existing custom-domain zone with its narrow OAuth scopes; the upload and active deployment were separately confirmed. The public administrator hostname still redirects to the configured Cloudflare Access team. An authenticated administrator screen was not re-tested in this refresh.

## Public site and review web

The current production review JavaScript and generated purchase notices already match the current build byte-for-byte. This is a content check, not a new Pages production deployment.

A new production Pages deployment remains pending. The dedicated account's existing Wrangler token can deploy Workers but lacks `pages:write`; listing Pages projects returned an authentication error. The owner was asked to finish the account login and Pages authorization in the prepared Chrome window. Do not use another product's Cloudflare account or describe a successful PR Preview as a production deployment.

Cloudflare's injected analytics script still makes served legal HTML bytes differ from the checked-in policy HTML and migration hashes. Raw published-policy hash verification is not passed by this refresh.

## Verification and release boundary

- Workspace build: 12 tasks passed, including cached tasks.
- Workspace type checking: 20 tasks passed, including cached tasks.
- Draw feedback/audio/animation checks: 22 passed, no skips.
- Preserved-deployment and Edge preflight regression checks: 31 passed, no skips.
- Static hosting checks: 27 passed, no skips.
- Protected runtime integrity: 28 files passed.
- Admin build and public API, administrator Access and worker boundary checks passed.

Kuji remains coming soon, the Exchange Room is retained and new point returns/automatic expiry conversion remain closed. No real-money transaction, PG approval, signed mobile release, mobile store submission, physical-device QA or sales activation is established by these deployment results. A separate optional question about TestFlight/Play internal distribution has not yet been answered.
