# DABBOBA Expo Go shell

This TypeScript Expo app opens the existing Vite web app in a native `WebView`.

## Local Expo Go run

Use two terminals on the same Wi-Fi network:

1. From the repository root, run `npm run dev:lan`.
2. From the repository root, run `npm run mobile`.
3. Scan the Expo QR code with Expo Go.

The shell derives the computer LAN host from the Expo development server and opens port `4174` with `?embed=1`.

For a hosted environment, copy `.env.example` to `.env` and set `EXPO_PUBLIC_DABBOBA_WEB_URL` to the HTTPS web deployment URL.
