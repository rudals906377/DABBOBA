# DABBOBA Expo native app

This TypeScript Expo app is the customer product source of truth. Expo Router owns native navigation, the home catalog is the first native vertical slice, Expo SQLite stores disposable cache data, and Expo SecureStore is reserved for authentication tokens and device keys.

## Local Expo Go run

Use two terminals on the same Wi-Fi network:

1. Load the local API environment and run `pnpm run dev:api`.
2. From the repository root, run `pnpm run mobile`.
3. Scan the Expo QR code with Expo Go.

The app derives the computer LAN host from the Expo development server and connects to API port `8788` unless `EXPO_PUBLIC_DABBOBA_API_URL` is set. Set `EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL` only for explicit development compatibility with legacy relative catalog images. Production catalog media must use absolute approved Supabase Storage/CDN URLs.

This is an Expo Go project, so it appears inside Expo Go rather than installing a standalone DABBOBA home-screen icon. A development or store build and a physical-device pass are separate release steps.

The repository uses the root `pnpm-lock.yaml` for the Expo package as well. Do not create a separate `apps/mobile/package-lock.json`; CI and future EAS builds must install from the pinned pnpm workspace lock.

## Native runtime configuration

For a hosted environment, copy `.env.example` to `.env` and set:

- `EXPO_PUBLIC_DABBOBA_API_URL` to the Fastify HTTPS origin.
- `EXPO_PUBLIC_DABBOBA_ASSET_BASE_URL` only when legacy relative media paths need an explicit origin.

Production builds fail closed when the API URL is missing or is not HTTPS. During local development only, localhost, emulators, `.local` names, and private LAN HTTP addresses are accepted.

## Local data boundary

`dabboba-local.db` may contain only disposable catalog/feed cache, recent searches, post drafts, upload queue records, and sync cursors. It must never become the source of truth for accounts, orders, payments, points, inventory, shipping, draw entitlements, probability versions, or draw results.

Auth access/refresh tokens belong in Expo SecureStore. Supabase service-role/secret keys, PostgreSQL credentials, payment secrets, and administrator keys must never be added to `EXPO_PUBLIC_*` variables or the app bundle.

## Legacy WebView compatibility

`App.tsx` and `webShell.ts` retain the bounded bridge while existing Vite screens are compared and migrated, but `expo-router/entry` is the app entry point and the legacy WebView is not app-completion evidence.

The compatibility bridge uses strict JSON messages with `version: 1` and an 8 KiB size limit. Messages are processed only when the sending document URL has the primary legacy web origin. Additional navigation origins do not receive bridge privileges.

Web to native:

- `{"version":1,"type":"APP_READY"}`
- `{"version":1,"type":"OPEN_EXTERNAL_URL","payload":{"url":"https://example.com"}}`
- `{"version":1,"type":"NAVIGATE","payload":{"route":"settings"}}`

Native to web:

- `{"version":1,"type":"DEEP_LINK","payload":{"route":"profile","url":"https://app.example.com/profile?embed=1&platform=ios"}}`

Unknown message types, versions, fields, routes, URL schemes, credentials, and oversized payloads are ignored. The bridge intentionally contains no authentication token, payment key, or other secret.

## Deep links

The `dabboba://` scheme accepts only these fixed routes:

- `home`
- `exchange`
- `ppoba`
- `dukroom`
- `profile`
- `request-room`
- `settings`

For example, `dabboba://profile` is mapped to the matching path on the primary approved web origin. Cold- and warm-start links are queued and delivered to the web document only after it sends `APP_READY`. The web app must consume the versioned `DEEP_LINK` message to select the matching screen; registering the native scheme alone does not create URL routing inside the web app.

Custom-scheme registration and cold/warm operating-system delivery require a development or standalone build. Expo Go alone is not physical-device proof for `dabboba://` handling.
