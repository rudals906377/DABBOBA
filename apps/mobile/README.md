# DABBOBA Expo Go shell

This TypeScript Expo app opens the existing Vite web app in a native `WebView`.

## Local Expo Go run

Use two terminals on the same Wi-Fi network:

1. From the repository root, run `pnpm run dev:lan`.
2. From the repository root, run `pnpm run mobile`.
3. Scan the Expo QR code with Expo Go.

The shell derives the computer LAN host from the Expo development server and opens port `4174` with `?embed=1`.

This is an Expo Go project, so it appears inside Expo Go rather than installing a standalone DABBOBA home-screen icon. A development or store build and a physical-device pass are separate release steps.

The repository uses the root `pnpm-lock.yaml` for the Expo package as well. Do not create a separate `apps/mobile/package-lock.json`; CI and future EAS builds must install from the pinned pnpm workspace lock.

## Hosted configuration and origin policy

For a hosted environment, copy `.env.example` to `.env` and set:

- `EXPO_PUBLIC_DABBOBA_WEB_URL` to the primary HTTPS deployment URL.
- `EXPO_PUBLIC_DABBOBA_ALLOWED_ORIGINS` to any additional trusted HTTPS origins, separated by commas. Each value must be an exact bare origin such as `https://auth.example.com`; paths, credentials, and wildcards are rejected.

Production builds fail closed when the primary URL is missing or is not HTTPS. During local development only, localhost, emulators, `.local` names, and private LAN HTTP addresses are accepted. Web navigation to an approved origin remains inside the WebView. Other HTTP(S) links open through the operating-system browser, while unknown schemes are blocked.

## Native bridge

The bridge uses strict JSON messages with `version: 1` and an 8 KiB size limit. Messages are processed only when the sending document URL has the primary `EXPO_PUBLIC_DABBOBA_WEB_URL` origin. Additional navigation origins do not receive bridge privileges.

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
