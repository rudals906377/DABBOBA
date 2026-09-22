# DABBOBA and FINDE on the same Mac

Keep each repository, `.env`, app identity and data store independent. Docker
Desktop is shared infrastructure, not a shared app database.

| Local service | DABBOBA | FINDE |
| --- | --- | --- |
| Expo / Metro | 8084 | 8081 |
| API development | 8788 | 8787 |
| Admin | 4180 | 3000 |
| Legacy web / assets | 4174 (strict port) | Metro web on 8081 |
| PostgreSQL | 55433 | Random loopback port for disposable tests |
| Redis | 56380 | None |

## One fixed mobile command

```sh
"/Users/kyoungmin/Desktop/DBB/DABBOBA 열기.command"
```

This is the user-facing full-stack entry point. The approved 2026-09-08 environment
split replaces its former production-Supabase development connection with the
`local-development` profile. Production `.env` and mobile public settings remain
preserved but must not enter the development API, worker or Metro process. Local
setup uses a separate `dabboba_development` database in the PostgreSQL-only
`dabboba-development` Compose project and its own data volume; online provider staging is
not yet provisioned. Existing Redis volume, API 8788, assets 4174, Metro 8084 and
the dedicated Simulator identities remain fixed. The terminal can close
after the success message. Implementation and tests are in `../.dabboba-launch/`;
keep that folder and the `.command` alongside this repository on this Mac.

The environment split was verified on 2026-09-08. Preparation and repeated
preparation passed without replacing the profile or rotating credentials. The
old PostgreSQL volume and LOGIN roles were preserved; its newly started legacy
container was stopped before bringing up the separate development cluster on
55433. Existing assets and Redis were reused. The stale Metro profile was rejected
before its DABBOBA-owned process was deliberately stopped and reopened in LOCAL.
Read-only launcher checks, local API session/inventory round trips, two finite
worker executions, and an iOS Metro bundle passed. The bundle did not embed the
preserved production Supabase public configuration. No Simulator UI session,
signed native build, real device or production-provider transaction was tested
for this environment change. Older Supabase-connected launcher results below
remain historical rather than proof of the new profile.

`corepack pnpm ios:local` / `mobile:ios` remain **developer-only Metro aliases**;
they do not start the API or asset server, and their terminal owns a newly started
Metro. Both launch paths use the same fixed public configuration and reject a
foreign, unknown or differently configured server; neither kills it nor chooses
a fallback port. Do not offer the Metro-only alias as a second app-opening recipe.

DABBOBA now uses Expo SDK 57 (installed 57.0.20), React/React DOM 19.2.3,
React Native 0.86.3, Reanimated 4.5.1 and Worklets 0.10.1. It requires an Expo Go
compatible with SDK 57. The launcher checks
the actual installed version before choosing an existing simulator. A simulator
name alone is not version evidence. Do not overwrite another project's Expo Go,
erase simulator data, or change bundle IDs to fix an SDK mismatch. If no compatible
host exists, prepare a separate development device rather than replacing one.

The full-stack launcher is pinned to `DABBOBA SDK57`, UDID
`C3E8BD62-FFAC-4E91-A10C-C7CD416C731E` (iOS 26.5 / iPhone 17 Pro), with Expo Go
57.0.9 installed. The previous `DABBOBA SDK54` Simulator and its local data are
preserved; no local sessions or caches were copied into the new device. Supabase
member, order, point and inventory records were not migrated or reset.

Metro uses IPv4-first localhost resolution so the fixed `127.0.0.1:8084` health
check and device URL reach the same listener, without opening it to the LAN.
Local Metro watching remains enabled (no inherited `CI=1`).

## SDK 57 compatibility changes

- Router-owned tab types replace direct React Navigation imports.
- Removed `absoluteFillObject` aliases use the equivalent `absoluteFill` style;
  capsule animation geometry, timing, assets and draw results are unchanged.
- Status bar icon styles remain; removed background props are omitted. Native
  startup retains the wordmark and canvas color through `expo-splash-screen`.
- Native multipart uploads use the same hashed bytes as a Blob with Expo fetch,
  not unsupported URI-only FormData. Missing notification data is ignored safely.
- Mobile dependencies are isolated from the web workspace's React versions.

References: [Expo upgrade guide](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/),
[SDK 57 notes](https://expo.dev/changelog/sdk-57),
[Router migration](https://docs.expo.dev/router/migrate/sdk-55-to-56/),
[splash configuration](https://docs.expo.dev/versions/latest/sdk/splash-screen/).

## Verified on 2026-09-06

- Root unit suite: **523/523**; full-stack launcher safety suite: **28/28**.
- Mobile typecheck, root production build, runtime integrity (28 protected files),
  Expo dependency check, peer dependency check, and Expo Doctor **21/21** passed.
- Both iOS and Android production Hermes bundles exported successfully. These
  are JS/assets exports, not signed store binaries or real-device release tests.
- Fixed `.command`: starts missing services; subsequent invocation reuses the
  existing API/assets/Metro and opens only `DABBOBA SDK57`. Read-only `--check`
  and live Metro process/environment verification pass. Ctrl+C/termination/hangup
  lock release is regression tested. A forcibly killed launcher (SIGKILL) may
  require verifying a stale lock owner; unknown locks are never blindly deleted.
- API `/healthz`, `/readyz`, public catalog read succeed; unauthenticated
  `/v1/auth/me` and `/v1/account/inventory` return 401. Redis PING/health is good.
- iOS Simulator displayed DABBOBA and catalog images. Development-only previews
  completed the six-tap gacha lever-to-result and kuji ticket-to-result flows.
  Preview `RESULT 01` is a deliberate placeholder, not a paid random award.
- No migrations, seeding, real purchases, point mutations, provider setting
  changes, FINDE edits, cloud deployment, billing activation or Git push occurred
  as part of this SDK/isolation work. Previous user changes remain uncommitted.

Still outside this verification: physical iPhone/Android interaction, Android
edge-to-edge appearance, signed splash screen, actual SMS/social provider flows,
real multipart network upload, paid-draw recovery against a payment provider,
and production rollout. Automated regressions are not proof of those operations.

## Native catalog UX check on 2026-09-08

- The Home and 뽀바 catalog cards now distinguish image loading, missing media,
  and load failure without adding a nested retry target inside the product link.
  Pull-to-refresh retries the same registered URL. Home keeps compact gacha crop
  behavior and wide original-ratio kuji `contain`; 뽀바 retains its measured
  source ratio and existing `cover` behavior.
- Simulator review confirmed the canonical Home wordmark after a reload, the
  non-blank image-error state for retired example URLs, the filtered-result reset,
  removal of generated recent-draw activity, and the selected-kuji empty state
  (`상품을 준비 중이에요.` / `곧 새로운 상품을 보여드릴게요.`). The wordmark issue was a stale
  running bundle after the asset move; no alternate logo or local catalog photo
  was added.
- `tests/expo-shell-structure.test.mjs` passed 34 tests and the Expo TypeScript
  check passed. The root production build and protected-runtime check were run
  separately by the supervising task.
- No catalog or database records were changed. The local API listener stopped
  independently during one later check and was not restarted by this implementation
  work; the supervising task subsequently observed it listening again as PID 7394
  without having restarted it. 뽀바 currently
  loads at most the existing 100-item API page, so `전체보기` means the complete
  requested category within that loaded snapshot; cursor pagination remains a
  production follow-up and was not added in this UX slice.

## Native root sizing check on 2026-09-08

- Home and 뽀바 product summaries now share 14/20 titles, 16/22 prices, and
  12/16 metadata. Home collection prices are separate from category metadata;
  the existing compact gacha and wide source-ratio kuji media remain unchanged.
- 뽀바 category chips keep their 36 px visual height inside an unclipped 44 px
  touch envelope. Root storage uses the same product hierarchy and 44 px action
  tabs; profile summary values use 18 px with 12/16 supporting labels and menu
  captions. Existing 52 px primary actions and 72 px profile menu rows remain.
- The catalog API was empty during this slice, so source checks and TypeScript
  verification do not claim a populated Home or 뽀바 runtime review. Existing
  storage/profile data was preserved; no fixture, catalog, service, or database
  state was added or changed. Before screenshots are under
  `../UI-history-backups/UX-sizing-2026-09-08-fceGOw`; the supervising task owns
  final Simulator screenshots and the root build/runtime checks.

## Docker preservation

`ops/local/compose.yaml` declares project `dabboba-local`, so the standard script
and a direct `docker compose -f ops/local/compose.yaml ...` agree. Keep that name;
do not override it with `-p local` or another app's namespace.

The currently active legacy Redis data volume is `local_dabboba_redis_data`.
It is explicitly external to Compose: creating an empty replacement or deleting
it through Compose is not allowed. A fresh machine without the volume must prepare
an approved local data store; do not silently discard existing data to make `up`
pass. PostgreSQL keeps `dabboba-local_dabboba_postgres17_pgmq_data`. Historical
Redis/PG16 volumes are retained, not merged or pruned.

When moving the old `local-redis-1` container to `dabboba-local-redis-1`, stop the
old verified container before starting the replacement. Never run two Redis
writers against the same volume. Preserve the stopped old container for rollback;
stop the new writer before ever restarting it. Do not use `down -v` or a global
Docker/process cleanup. This runtime adjustment does not migrate cloud databases
or certify production authentication, payments or deployment.
