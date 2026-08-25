# Mobile Prototype Agent Guide

## Prototype Instructions

In ChatGPT Work Mode, run `sites-preview start "$PWD"`, open `http://terminal.local:4173/` in the cloud browser, and verify the rendered app and its primary interactions. Keep that preview open and tell the user to inspect it in the cloud browser; do not present the local URL as a user-facing chat link. In Codex Desktop, run the local server yourself, open the preview in the in-app browser, and provide the clickable local URL. Do not deploy to Sites unless the user explicitly asks to share, publish, or deploy. Do not give the user server-start instructions when you can run it.

Before planning or implementing any mobile-app change, read this `AGENTS.md` in full. It is the source of truth for the template's runtime and component guidance.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Editing Boundary

- Build app-specific UI in `src/Prototype.tsx` and `src/prototype.css`.
- Treat `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `src/mobile/`, `public/assets/iphone/`, `public/assets/android/`, `public/assets/status/`, `vite.config.ts`, `worker/index.js`, and `scripts/prepare-sites-build.mjs` as protected runtime files. Do not edit, replace, remove, or recreate them unless the user explicitly asks to change the mobile runtime itself. For an explicit runtime change, update the affected lock hashes only after verifying the new runtime behavior.
- Run `pnpm run check:runtime` before preview or handoff. If it fails, restore the protected runtime instead of weakening or bypassing the check.
- `pnpm run build` preserves the mobile runtime and prepares the static Cloudflare Worker output required by Sites. Before a Sites handoff, confirm `dist/client/index.html`, `dist/server/index.js`, `dist/.openai/hosting.json`, and source `.openai/hosting.json` exist, then run `pnpm run test:sites`. Do not replace this project with a Vinext starter.

## Runtime Contract

- Preserve the mobile device runtime unless the user's task explicitly asks otherwise. Do not replace it with a standalone page. Visual fidelity applies to app-owned content inside the device screen, not to template-owned device chrome.
- Keep `App` composed around `PhoneFrame` -> `KeyboardProvider`, with `StatusBar`, app content, `HomeIndicator`, and `KeyboardDock` mounted inside the phone frame. `StatusBar` and the iOS home indicator are overlaid device chrome. When the Android keyboard is closed, the app viewport reserves the protected navigation-bar region instead of painting behind it. When the Android keyboard is open, preserve the current full-screen keyboard layout: its asset includes the IME navigation strip and the separate black navigation bar is hidden. iOS screens continue to paint behind the home-indicator area and own their safe-area content padding.
- Preserve the `iPhone` / `Pixel 10` device picker and both calibrated device presets. The Pixel screen is `427 x 952`; its `32 x 32` camera circle and `public/assets/android/navigation-bar.svg` bottom navigation bar are protected device chrome, not app content.
- Preserve the device picker's intentionally lightweight Codex styling in the top-right corner: its trigger wrapper is borderless and transparent, its trigger sizes to content, and its right-aligned menu uses the compact 3px inset plus the specified hairline and elevation shadow layers. Keep the prototype root and default app screen white.
- Preserve `StatusBar` as live device chrome, including its platform-specific typography, source status-icon assets, and spacing. Pixel 10 uses Roboto, Android indicators, and 32px top, left, and right padding. iPhone uses its iOS indicators, system typography, and calibrated spacing. Do not hardcode screenshot times like `9:41` into the status bar, replace its real-time clock, or move status bar content into app markup unless the user explicitly asks for a fixed/mock device time.
- `PhoneFrame` owns the calibrated device frame, screen portal, device picker, camera cutout, and custom cursor. Keep device assets in `public/assets/iphone/` and `public/assets/android/`; if an asset fails to load, repair the asset path or restore the asset instead of removing the frame, keyboard, or image render.
- Use `MobileScroll` directly for simple single-screen prototypes. Use `FlowStack` for conventional multi-screen flows whose routes can own their fixed header and footer; when using it, define each route as a `FlowScreen`: `{ id, header?, headerHeight?, footer?, footerHeight?, render }`, and use `flow.push(screen)`, `flow.pop()`, and `flow.replace(screen)` from `FlowStack` render callbacks or `useFlow()` instead of introducing another router.
- Use `Carousel` for a carousel, horizontal rail, swipeable cards, image or media strip, horizontally scrollable cards, chip rail, or other horizontal collection.
- For a layered app shell—such as a persistent composer, independently presented sheet, pushed/peek sidebar, or app-wide transition—compose directly in `Prototype.tsx` rather than forcing it through `FlowStack`. Keep app-owned fixed chrome as sibling layers outside `MobileScroll`.
- When using `FlowScreen`, put route-owned fixed headers or footers in `FlowScreen.header` or `FlowScreen.footer`. Set `headerHeight` to the visible app-toolbar height; `FlowStack` adds the device's top safe-area/status-bar inset automatically. Do not include `StatusBar` or its height in the header. Set `footerHeight` to the full app-footer height. `FlowScreen.footer` is an overlay, not reserved layout space; screens using it must add their own bottom content padding such as `padding-bottom: calc(var(--flow-footer-height) + var(--mobile-safe-area-height) + 24px)` so final content can scroll above the footer while still painting behind it.
- Render only scrollable content inside `MobileScroll`; it is for content that should move with scroll and rubber-band overscroll. Keep app-owned headers, nav bars, tabs, composers, and overlays outside it. This keeps scroll physics, safe areas, keyboard insets, scrollbars, and drag click suppression active without letting content paint under fixed chrome.
- Buttons, links, cards, and images inside `MobileScroll` should still allow drag scrolling when the pointer moves beyond tap slop. Use `data-scroll-drag="ignore"` only for rare controls that must own the drag gesture themselves.
- Do not add `var(--keyboard-height)` to ordinary screen/content padding inside `MobileScroll`; the scroll viewport already shrinks above the simulated keyboard. For custom fixed composers, search bars, or toast chrome, use `useKeyboardInsets().bottomInset`. It is relative to the app viewport: Android returns `0` while the closed-keyboard viewport already reserves navigation, then returns the keyboard height while open; iOS continues to clear the home indicator while closed and ride directly above the keyboard while open. Do not pin custom bottom chrome to `bottom: 0` or only `keyboardHeight`.
- Use `KeyboardInput`, `KeyboardTextarea`, or `MobileTextField` for every text-entry control. A raw `input` or `textarea` disconnects focus, keyboard animation, safe-area insets, and attached surfaces.
- Use `BottomSheet` for phone-scoped sheets. Its props are `open`, `onOpenChange`, `title`, optional `description`, optional `snap`, and `children`; it renders through the phone screen portal and dismisses the keyboard before opening.

## Horizontal Carousels

- Use `Carousel` for horizontally draggable cards, images, media, chips, or other horizontal collections. Do not recreate these with `overflow-x`, custom pointer handlers, or a generic div.
- `Carousel` can be nested directly inside `MobileScroll`. It owns horizontal gestures and automatically yields vertical gestures to the parent.
- Never put `data-scroll-drag="ignore"` on or around a `Carousel`; doing so prevents vertical parent scrolling when a gesture begins inside it.
- Do not add CSS scroll snapping to `Carousel`; its runtime owns momentum and release motion.
- Use `data-scroll-drag="ignore"` only when a control must prevent parent scrolling in every drag direction.

See `src/mobile/COMPONENTS.md` for the full component and gesture contract.

## Keyboard Rule

The simulated keyboard is a separate top-layer component. Before presenting anything that behaves like iOS navigation or modal UI, dismiss it first.

Call `keyboard.hide()` before:

- pushing, popping, or replacing FlowStack routes
- opening bottom sheets, action sheets, dialogs, menus, or navigation sheets
- starting transitions where the destination should not inherit text-input focus

`FlowStack` already hides the keyboard for `push`, `pop`, and `replace`. `BottomSheet` already hides it before opening. If you add new modal/sheet/navigation primitives, follow the same rule.

When a composer, search surface, or other keyboard-attached component closes, call `keyboard.hide()` in the same event before changing that component's open state. Position attached surfaces from `useKeyboardInsets()` rather than a separate timer or visibility flag so both dismiss together.

When any text-entry control loses focus, dismiss the simulated keyboard. If the control is custom or does not use the runtime's keyboard-aware fields, handle its blur event and call `keyboard.hide()` explicitly. Keep the keyboard open only when focus is moving directly to another text-entry control that should share the same keyboard session.

## Interaction Rules

- Do not trigger buttons or inputs after a pointer has become a drag. Preserve the drag suppression behavior in `MobileScroll`.
- Do not allow native browser image/file dragging inside the phone frame. Preserve the phone-level `dragstart` suppression and non-draggable image styles so scroll drags that begin on images still scroll the prototype.
- Use `KeyboardInput`, `KeyboardTextarea`, or `MobileTextField` for text entry so the simulated keyboard and safe-area insets stay connected.
- Fixed phone chrome should not animate with pushed screens. Screen content can animate; the status bar, camera cutout, and preview chrome should stay put.
- Keep the keyboard below the home indicator/safe area layer in z-index, and above ordinary app UI while visible.
- Keep the home indicator as the topmost safe-area layer in the z-index above everything else in the prototype.

## DABBOBA Product Decisions

- Use a guest-first launch: show a brief DABBOBA loading splash, then open the home screen without forcing login. Guests may browse the app, but opening or writing exchange posts, submitting exchange applications, creating product requests, or liking requests must show a clear `로그인이 필요합니다` prompt with a `로그인` action that leads to the app login screen and resumes the intended action after mock authentication.
- Keep the shared commerce flow as catalog → product detail → quantity sheet → mock checkout, then branch by category: 가챠·쿠지 continue to the arcade draw, while 피규어·카드 finish on a normal purchase-complete screen without an app-side prize draw.
- Keep the primary bottom-navigation order fixed as 교환방 → 뽀바 → 홈 → 덕룸 → 프로필. Show this navigation only on those five root screens; hide it on pushed exchange-detail, IP, product-detail, checkout, profile utility, customer-center, request-room, and draw screens so route-owned back controls and commerce action footers remain unambiguous.
- Treat the root navigation as a `스크롤 반응형 플로팅 하단 네비게이션`: keep icons and labels expanded at the top and while scrolling upward, then compact it to an icon-centered floating bar while scrolling downward. Use a restrained translucent light surface so scrolling content remains perceptible behind it. Keep every tab icon as the line variant; indicate selection only through the line icon color and a thin `#91E98E` indicator, never a filled icon or colored selection tile. Never hide it completely, keep every tab target at least 44px, preserve the root footer reservation so content does not jump, and reset it to expanded whenever the root tab changes or keyboard focus enters the navigation.
- Use 교환방 for product-for-product exchange listings and applications; 뽀바 for searching, choosing, and purchasing 가챠·피규어·쿠지·카드; 홈 for the current DABBOBA discovery home; 덕룸 for collectors to show off their collections; and 프로필 for the account summary plus direct entries to 찜, 보관, 배송, 구매, 포인트, 신청방, and customer support.
- In the Exchange Room composer, the author selects exactly one registered item from their authenticated storage or purchase inventory and publishes it without requiring a wanted item. Other users then select one registered item from their own inventory and send an `이 상품과 교환하실래요?` proposal. The author may accept one proposal or reject proposals individually. Show each product's registered image, exact name, IP, category, and a clearly qualified non-cash `앱 기준가`; never present that reference value as a sale price or settlement amount. Rank autocomplete matches with real server aggregates when available. Current inventory, prices, applications, and decision states are prototype fixtures only and must become authenticated server-owned data before production.
- Every exchange listing must include a title, category, IP, one offered item, and details. Connect each listing to a footer-free detail `FlowScreen` with product-backed exchange proposals, author-only accept/reject controls, and a keyboard-aware proposal form. Hide the root navigation on the pushed detail screen and restore it when returning to the exchange feed.
- Expose 신청방 as a standalone `#91E98E` featured card above the ordinary profile-menu list instead of nesting it under 고객센터 or rendering it as a plain list row. Keep 고객센터 focused on FAQ and support guidance. Every profile entry must open a dedicated footer-free `FlowScreen`. A request records category, IP, desired item, and details, and other authenticated users can add a single local like through the shared request state.
- Treat Exchange Room, Request Room, Dukroom, Wishlist, Storage, Shipping Request, Purchase History, Point History, and Profile content as local frontend fixtures in the current prototype. Do not imply that listings, applications, requests, likes, collections, shipping requests, orders, points, account edits, or profile state are authenticated or server-persisted until their backend contracts exist.
- Treat edits made in the profile-detail screen as local browser state only. They may update the current prototype session, but they are not saved to an authenticated account or any server and may reset when the app reloads.
- Keep `회원정보 변경` as a separate footer-free hub reached from `프로필 관리`, with dedicated detail screens for 개인정보(이름·휴대폰·이메일·생년월일), 기본 배송지, 결제 카드, 결제 설정, 로그인 및 보안, and 개인정보·수신 동의. In the prototype, store only safe local fixtures and masked card metadata; never persist full card numbers, CVC values, or plaintext passwords in client state. Production phone/email changes require re-verification, saved cards require a payment-provider token, and every security-sensitive account change belongs to an authenticated API.
- Keep the home settings entry as a 44px line-gear action between search and points. The footer-free settings hub groups 알림 수신설정, 계정정보·비밀번호, 공지·문의·FAQ, and 약관·로그아웃·탈퇴. Separate mandatory account/order/delivery notices from optional activity and marketing consent. Keep account deletion discoverable in-app and add a functional external web deletion route before Google Play release. Treat every bundled legal document as a launch-structure draft only: actual business identity, processors, retention periods, commerce conditions, random-item disclosures, effective dates, and legal review must be completed before publication.
- Use a warm off-white canvas instead of pure white. Show physical product photography with `object-fit: contain` on quiet light surfaces; reserve near-black for the arcade moment and sparse brand contrast.
- For every visual or design change, use golden-ratio relationships as the proportional starting point, then prioritize optical stability over mathematically exact ratios. Alignment, visual weight, breathing room, safe areas, readable hierarchy, and comfortable touch targets win whenever a strict golden ratio would make the screen feel less balanced.
- Use `#91E98E` as DABBOBA's canonical representative color and primary action color. Keep `--db-brand` as the source token and alias existing `--db-green` usage to it; do not substitute a more fluorescent lime without a new explicit decision.
- Use the canonical `DABBOBA` pixel wordmark derived from the exact `Press Start 2P` construction already used by `IP SELECT`. Render every letter monochrome near-black `#111411`; do not color individual letters, stretch the wordmark, apply faux bold, outline it, add a glow, or substitute another arcade font. Reserve representative `#91E98E` for interaction, status, and the four-pixel opening loader effect.
- Use `public/assets/dabboba/brand/dabboba-wordmark.png` (`1170 × 172`, transparent RGBA) as the canonical web wordmark and keep `apps/mobile/assets/dabboba-wordmark.png` byte-identical for Expo splash/loading/error surfaces. Reuse the shared asset from the web splash through home, login, and draw-header brand lockups. Keep semantic copy such as `나의 DABBOBA` as text instead of replacing ordinary sentences with the logo artwork.
- Use retro arcade screenshots only as sparse, low-opacity texture. They must not determine the page layout or become a full-screen background.
- Keep the 8-bit influence concentrated in the wordmark, fixed interface-title system, short status labels, and the draw moment. Body copy and dynamic commerce, exchange, and request content remain contemporary and highly readable so the overall product stays simple and adult-oriented.
- Give gacha a capsule-specific finite draw sequence inside the arcade screen: use the compact matte-black DABBOBA capsule machine with an exact DABBOBA marquee, smoked-glass chamber, olive/lime and ivory DB-marked capsules, a large manual crank, and a lower outlet. The fixed sequence is crank → mix → drop → split-open with a restrained lime pixel bloom before the result sheet appears. Keep kuji on its separate non-capsule draw rhythm, avoid full-screen confetti, and provide a reduced-motion fallback.
- Keep the gacha ready state front-facing even when its supplied cinematic uses a side angle. Build the crank from three independent layers: the restrained 8-bit/dot-art machine at `public/assets/dabboba/capsule-machine-front-pixel.png`, whose crank area is plain graphite with no square metal backing, screw, or slot; the fixed transparent circular plate at `public/assets/dabboba/capsule-crank-plate-pixel.png`, preserving its inner ring, dark recess, center socket, and four screws; and the transparent clean horizontal handle at `public/assets/dabboba/capsule-crank-pixel.png`. Keep the plate completely still and rotate only the handle continuously and in direct proportion to the `밀어서 뽑기` slider, mapping 0–100% travel to 0–360 degrees on the same pointer-update frames. Do not add a separate transform delay to the handle, and never layer the retired CSS/3D capsule machine underneath it. Hold the completed handle during the short transition, then continue with `public/assets/dabboba/video/dabboba-capsule-lower-chute.mp4`. Treat the supplied clip as temporary prototype media, not as a replacement for the final capsule-containment direction below.
- Keep the selected gacha capsule physically contained throughout the reveal: it must fall vertically through the machine's internal chute, land and fully settle behind the walls and front safety lip of the bottom receiving tray, and open only inside that tray. Never launch it toward the camera, bounce it out of the machine, or open any capsule still inside the upper chamber.
- Treat IP as a first-class catalog layer above 가챠·피규어·쿠지·카드. Keep the home exposure compact, and put complete discovery and multilingual alias search on a separate `FlowScreen`.
- Keep the initial IP catalog in `src/fixtures/ip-seed.json` behind typed exports so it can later be replaced by the shared TypeScript REST/OpenAPI client without rewriting screens.
- IP artwork under `public/assets/dabboba/ips` is temporary prototype material with provenance in `sources.json`; replace it with licensed production assets before public commercial distribution.
- Keep Phase 1 test products at exactly one per IP: 가챠 8, 피규어 8, 쿠지 7, 카드 2. The card category is limited to 원피스 and 포켓몬스터 until the user changes this decision.
- Product imagery under `public/assets/dabboba/products/ip` is locally frozen prototype reference material. Preserve its `sources.json` provenance and replace or license it before any public or commercial release.
- Keep the Vite web app as the UI source of truth and the Expo Go client in `apps/mobile` as a thin TypeScript WebView shell. The shell must open the web app with `?embed=1&platform=<ios|android>` so the preview bezel, simulated status bar, simulated keyboard, and home indicator are removed while normal browser preview behavior stays unchanged. Use a LAN URL only for local Expo Go testing and an HTTPS deployment URL for production builds.

## DABBOBA Pixel Wordmark And Title Rules

### Source Of Truth

- Treat the supplied `IP SELECT` reference and the current `DABBOBA` wordmark as one typography family. Their defining characteristics are square counters, stepped diagonal and curved terminals, a single-weight bitmap stroke, tight uppercase rhythm, and no decorative effects.
- Use the bundled `Press Start 2P` font for Latin letters, numbers, short codes, and fixed English title labels. Keep the import centralized; do not download or embed a second copy of the same font in individual screens.
- The canonical logo is an image asset, not ordinary heading text. Always consume the shared wordmark asset for `DABBOBA`; never rebuild the logo independently with HTML, CSS shapes, an inline SVG, or a different font declaration.
- If Korean display text must itself become pixel-styled, first choose and license one Korean bitmap font with comparable stroke density, add it as the single `--db-font-pixel-ko` token, and verify every required Hangul glyph. Until that font is approved, pair the pixel English title label with the existing Korean sans-serif title rather than allowing a silent system-font fallback inside a pixel heading.

### Where The Pixel Title System Is Required

- Apply the shared pixel-title treatment to every short, app-authored display title: app and page identifiers, section eyebrows, hero labels, sheet and dialog titles, empty-state titles, result grades, arcade status labels, and short tab/step headings.
- Every major screen or section title block should expose the pixel system consistently. Prefer a short uppercase English or alphanumeric label such as `IP SELECT`, `SHOP`, `EXCHANGE`, `WISH BOARD`, `PROFILE`, `RESULT`, or `STEP 01`, followed by the readable Korean title when Korean explanation is needed.
- Keep dynamic or potentially long content out of the bitmap display font: product names, exchange/request titles, usernames, prices, quantities, descriptions, legal notices, form labels, button labels, navigation labels, and body copy continue to use the established Korean UI font. These are content, not fixed interface-title artwork.
- Do not rasterize each title as a new image. Only the DABBOBA wordmark remains a canonical image asset; other fixed titles must use shared text styles so accessibility, localization, truncation, and large-text behavior remain intact.

### Typography Tokens And Hierarchy

- Define Latin pixel titles from one stack: `"Press Start 2P", ui-monospace, monospace`, weight `400`. The font has no legitimate bold weight, so never apply synthetic `font-weight: 700/900`.
- Use these starting sizes and adjust only when optical balance or device width requires it:
  - micro eyebrow/status: `7px` size, `12px` line-height, `-0.2px` tracking;
  - section title/step label: `9px` size, `14px` line-height, `-0.2px` tracking;
  - page/sheet/dialog title: `11px` size, `17px` line-height, `-0.25px` tracking;
  - hero/result display title: `14px` size, `21px` line-height, `-0.3px` tracking.
- Keep pixel titles at weight `400`, uppercase for Latin, and one line whenever possible. For a short controlled title that must wrap, limit it to two lines and preserve whole words; never compress the font horizontally to make it fit.
- Use golden-ratio relationships only as a starting guide between title and supporting text. Optical centering, safe-area clearance, line wrapping, Korean readability, and a stable title block always take priority over mathematical ratios.

### Color And Surface Rules

- Default pixel titles and the DABBOBA wordmark use `#111411` on `#F5F5F1` or `#FCFCF8` light surfaces.
- Small section eyebrows and status labels may use `--db-green-ink` (`#176F2A`) when the contrast remains sufficient. Use `#91E98E` primarily as a background, indicator, selection, or loader accent—not as the main color for a long pixel title.
- On the near-black arcade surface, use the established high-contrast light title color and reserve `#91E98E` for a small state cue. Do not add neon glow, multi-color letters, gradients, bevels, drop shadows, or blinking text.
- Never place the dark wordmark directly on a dark or busy image. Use a quiet light surface, an approved light inverse asset, or an explicit accessible container.

### Layout And Responsive Rules

- Align pixel titles to the same content grid as the Korean title or content below them. Do not visually center a title that belongs to a left-aligned information hierarchy.
- Use `4–6px` between a pixel eyebrow and its Korean title, `10–14px` from that title block to supporting content, and preserve at least the current screen gutter on both sides.
- The wordmark must retain its intrinsic aspect ratio. The approved slots are `26px` high on the web opening screen, `16px` high in the home header, `20px` high on login, and `11px` high in the draw header unless a new screen-specific visual check approves a change.
- Pixel titles must not collide with search, points, back buttons, Safe Area, bottom sheets, or keyboard-attached surfaces. At narrow widths, reduce the approved size tier or shorten the controlled English label before allowing clipping or horizontal scrolling.
- Preserve actual text semantics: use the correct heading level for page and section titles, keep screen-reader text available, and do not rely on pixel styling or color alone to communicate state.

### Prohibited Variations

- Do not mix Press Start 2P with another Latin arcade font on the same screen.
- Do not use lowercase Latin in the fixed pixel-title system unless a later brand decision explicitly introduces a lowercase set.
- Do not manually redraw individual glyphs, replace letters with icons, alter only selected DABBOBA letters, or introduce a `DBB` abbreviation as the primary wordmark without explicit approval.
- Do not use pixel typography for paragraphs, dense lists, checkout totals, accessibility-critical instructions, or any text whose primary job is fast reading.
- Do not create one-off font sizes, letter spacing, shadows, or colors in individual components. Extend the shared token or shared pixel-title class only after checking every existing title surface.

### Implementation And Verification Contract

- Keep the reusable DABBOBA wordmark consumer centralized in `DabbobaWordmark`. Keep reusable text-title styles centralized in `src/prototype.css`; components should select a semantic size variant instead of duplicating font declarations.
- Any wordmark asset update must change both the web and Expo PNGs together and verify that they remain byte-identical, transparent, uncropped, and readable at the smallest approved slot.
- For any title-system change, verify once at the end on opening, home, one long page title, one section title, one sheet/dialog title, and the draw screen. Include a narrow mobile width, iPhone and Android Safe Area, large-text behavior for surrounding copy, and reduced-motion mode when the title participates in animation.
- Run `git diff --check`, `pnpm run check:runtime`, `pnpm run build`, and the Expo TypeScript check before handoff. Browser evidence must distinguish the app's simulated iPhone/Pixel frames from proof on a physical device.

## DABBOBA Scalable Production Architecture Rule

- Preserve the approved DABBOBA UI, product flows, domain IDs, and the category rule that 가챠·쿠지 are `draw` while 피규어·카드 are `purchase`. Migrate behind those screens in verified slices instead of rewriting the prototype wholesale.
- Use TypeScript end to end. The production target is a pnpm Workspace + Turborepo with `apps/web`, `apps/mobile`, `apps/api`, and `apps/worker`, plus shared `packages/domain`, `packages/contracts`, `packages/api-client`, `packages/db`, `packages/ui`, and `packages/config`.
- Start with a modular monolith, not microservices. Keep explicit modules for identity/session, exchange, product requests, media, moderation, notifications, catalog, orders, payments, inventory, points/coupons, draw/kuji, shipping, and admin. Split services only after measured load or ownership boundaries justify it.
- Use PostgreSQL as the only source of truth for accounts, posts, orders, money, points, inventory, draw entitlements, draw results, probability-table versions, and audit records. Use Redis only for cache, rate limiting, short-lived coordination, and job delivery; never treat Redis or client state as the ledger for money, inventory, or draw outcomes.
- All authoritative commerce work belongs to the API and database: recalculate prices and discounts server-side, reserve and decrement inventory atomically, require idempotency keys, verify signed PG webhooks, deduplicate provider events, reconcile uncertain payments, and append compensating ledger records for refunds or corrections.
- All authoritative gacha/kuji work belongs to the server. A paid order issues one-time draw entitlements; the server atomically locks and consumes an entitlement, fixes the odds/pool version, selects and reserves the prize, records the immutable result and audit event, and returns that result. The client slider and video only present a result already committed by the server.
- Build Exchange Room and Request Room on authenticated canonical user IDs with cursor pagination, listing/application ownership and permission checks, unique request likes, exchange lifecycle states, soft-delete/moderation states, reports, blocks, rate limits, admin actions, and audit logs. Upload exchange media directly to object storage through short-lived signed URLs, then scan, strip metadata, resize, and serve variants through a CDN.
- Use REST + OpenAPI as the client/server contract and generate shared TypeScript API types. Keep server state out of the broad prototype Context; use a query cache for remote data, an isolated auth/session provider, focused checkout state, and local state machines for transient animation/UI state.
- Replace the in-memory `FlowStack` as the production source of navigation truth with URL-addressable routes and deep links while retaining its approved transition behavior as presentation. Avoid keeping unbounded hidden screens mounted. Lists of exchange listings, applications, requests, products, and IPs must use server pagination and, when needed, virtualization.
- Keep the Expo WebView shell for the early MVP only while it remains operationally useful. Restrict it to approved HTTPS origins and use a typed, validated native/web bridge. Move login, secure token storage, payment SDKs, push notifications, deep links, camera/file upload, or other native-critical flows into Expo-native surfaces when required.
- Use Google Cloud Storage plus a CDN for production media, Redis + BullMQ for asynchronous jobs, and a transactional outbox for notifications, media processing, reservation expiry, payment reconciliation, shipping, and cache invalidation. Add structured logs, request/order/payment/draw correlation IDs, error tracking, metrics, alerts, backups, point-in-time recovery, and periodic restore drills before public launch.
- Begin search with PostgreSQL full-text search and `pg_trgm`. Add read replicas, OpenSearch, feed fan-out, partitioning, or independent services only when production metrics show a real need.
- Apply the migration in this order: split the large prototype by feature and standardize the workspace; establish contracts and canonical identity; add persistent exchange, request, media, and moderation modules; move catalog to the database; implement transactional order/payment/inventory/draw ledgers; then add workers, observability, native integrations, and measured scale optimizations.
- Do not describe fixture data, mock login, timer-based checkout, client-generated order codes, browser point balances, static stock, or `Math.random()` draw results as production-ready. No real payment or public UGC launch may rely on those prototype mechanisms.
