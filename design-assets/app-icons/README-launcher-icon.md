# DABBOBA launcher icon

- Selected source: `dabboba-wordmark-capsule-horizontal-final-source.png` (1254×1254)
- iOS/default runtime asset: `apps/mobile/assets/icons/app-icon.png` (1024×1024)
- Android adaptive foreground: `apps/mobile/assets/icons/adaptive-icon-foreground.png` (1024×1024)
- Direction: horizontal black 8-bit `DABBOBA` wordmark, pixel-jelly capsule replacing `O`, bright mint background.
- Confirmed by the product owner on 2026-10-01. White and ivory variants are previews only, not the approved launcher.
- Android foreground retains the full wordmark inside the adaptive safe circle with background `#78EF95`. The former slanted source is preserved as history.
- Regenerate assets with `node scripts/prepare-launcher-icons.cjs`. Existing device icons change only after a new native build is installed.

The source file is kept separately so runtime resizing does not replace the approved original.

## Developer-console uploads

Use `dabboba-developer-icon-256.png`: opaque 256×256 RGB PNG, below 250 KB, including the approved mint background. Never upload the transparent Android foreground or add rounded corners. Verify the DABBOBA app/account and current upload requirements before saving. File preparation does not establish that Naver, Kakao, Google or store uploads are complete.
