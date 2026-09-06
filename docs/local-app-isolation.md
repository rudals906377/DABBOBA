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

This is the user-facing full-stack entry point. It validates the DABBOBA Supabase
project and existing Redis volume, builds shared packages, starts or reuses API
8788, assets 4174 and Metro 8084, then opens only the dedicated Simulator. It does
not seed, migrate, deploy, or create a replacement database. The terminal can close
after the success message. Implementation and tests are in `../.dabboba-launch/`;
keep that folder and the `.command` alongside this repository on this Mac.

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
