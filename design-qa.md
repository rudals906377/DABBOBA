# DABBOBA Design QA

## Source visuals

- Commerce-flow references: four user-provided third-party app screenshots retained outside the repository.
- Green direction and texture references: user-provided screenshots retained outside the repository.
- Accepted capsule-machine storyboard: `work/design/dabboba-capsule-storyboard-v1.png` (1774 × 887 native pixels). This is the source of truth for the machine silhouette, component anatomy, capsule palette, DABBOBA marquee, and four-beat reveal sequence.
- The third-party app screens were used only to validate the commerce information order. Product names, imagery, color system, components, visual hierarchy, and DABBOBA brand treatment are original to this prototype.

## Capture setup and evidence

- Primary viewport: iPhone client viewport 393 × 852 CSS px at DPR 1.
- Secondary viewport: Pixel 10 client viewport 427 × 952 CSS px at DPR 1.
- The iPhone locator PNG bounds resolve to 394 × 852 because the emulated phone screen begins on a fractional x-coordinate. Comparison boards normalize those captures to the measured 393 × 852 client viewport.
- Reference screens: 589 × 1280 normalized to 393 × 852 for the side-by-side board.
- Compared states: catalog, profile detail/edit, product detail, quantity sheet, checkout, direct-purchase completion, arcade draw, and result sheet.
- Full implementation captures:
  - `work/qa/final-catalog.png`
  - `work/qa/final-detail.png`
  - `work/qa/final-quantity.png`
  - `work/qa/final-checkout.png`
  - `work/qa/final-draw.png`
  - `work/qa/final-result.png`
  - `work/qa/final-pixel-catalog.png`
  - `work/qa/final-pixel-draw.png`
  - `work/qa/ip-products-iphone-screen.png`
  - `work/qa/ip-products-pixel-screen.png`
  - `work/qa/ip-linked-product-detail-screen.png`
  - `work/qa/ip-product-kuji-detail-screen-v2.png`
  - `work/qa/ip-product-draw-screen.png`
  - `work/qa/product-contact-sheet.png`
- Combined visual evidence:
  - `work/qa/flow-comparison-board.png`
  - `work/qa/style-comparison-board.png`
  - `work/qa/responsive-comparison-board.png`
  - `work/qa/ip-product-comparison-board.png`
  - `work/qa/navigation-comparison-board.png`
- Root-navigation captures:
  - `work/qa/nav-home-iphone.png`
  - `work/qa/nav-shop-iphone.png`
  - `work/qa/nav-duckroom-iphone.png`
  - `work/qa/nav-profile-iphone.png`
  - `work/qa/nav-home-pixel.png`
  - `work/qa/profile-detail-latest-browser.png`
  - `work/qa/purchase-complete-card-latest-browser.png`
  - `work/qa/purchase-complete-card-pixel.png`

## Visual review

- The full app uses warm off-white `#F5F5F1`, with `#FCFCF8` surfaces instead of pure white.
- Primary green `#91E98E` is reserved for selection, success, status, and primary actions; it does not flood the interface.
- The supplied retro-game collage appears only as a 9% texture in the catalog banner. It is not reused as layout, illustration, or draw-screen background.
- 8-bit styling is limited to the wordmark, short labels, and arcade status copy. Product and payment content use a restrained contemporary Korean UI hierarchy for adult customers.
- The IP test expansion uses 25 locally frozen official product references with full source-page and source-image provenance. These assets are prototype-only and must be licensed or replaced before commercial release.
- Product photography now uses `object-fit: contain` on quiet light surfaces so packaging, figures, and wide 쿠지 visuals are not cropped. The 4:3 detail hero keeps landscape promotion art readable without pushing all product facts below the first viewport.
- The draw state uses a compact black cabinet on a matching near-black stage, with no visible blend band or checkerboard boundary.
- iPhone and Pixel screens preserve the same structure, readable density, and bottom-safe-area treatment without horizontal clipping.
- The five equal-width bottom tabs follow the requested `교환방 → 뽀바 → 홈 → 덕룸 → 프로필` order. The compatible internal `community` and `shop` route IDs remain, while the user-facing labels and screen contracts are 교환방 and 뽀바. Active state is expressed with icon fill, green tint, label weight, and `aria-current`, without a raised center button.
- Exchange Room is a restrained product-for-product feed, Shop reuses the existing product grid, and Duckroom keeps its two-column collection gallery. All three preserve the accepted off-white, thin-line, and sparing lime visual language shown on Home.
- Profile detail follows the same restrained form language with a compact live preview, stable labels, local-only disclosure, and a representative-IP picker. The root navigation is intentionally absent while editing.
- Direct-purchase completion reuses the warm surfaces and lime confirmation accent without arcade imagery. It shows the purchased product, category-specific unit, mock order state, and a clear non-production disclosure.
- Exchange detail extends the accepted open-feed layout without a nested dashboard stack. Author, category/IP, title, offered item, wanted item, details, visible applications, and the local application composer keep the same off-white, thin-line, and sparing lime system.
- Profile customer center now leads to a dedicated Request Room. Category/IP filters, desired-product details, and the shared local like control use the same quiet surfaces and reserve green for selected or active state.
- The gacha arcade now uses the accepted compact DABBOBA capsule machine instead of the generic arcade-cabinet image. Its exact marquee, matte-black body, smoked-glass chamber, olive/ivory DB capsules, manual crank, and lower outlet carry a four-beat crank → mix → drop → open sequence; kuji keeps the existing separate cabinet treatment.

### Capsule draw fidelity ledger

- Source comparison method: the accepted native-size storyboard and the latest iPhone/Pixel browser captures were inspected directly at original resolution. Browser interaction tools were unavailable in this environment, so the live `localhost:4174` preview was driven with Playwright as the documented fallback.
- Machine anatomy: the rendered machine preserves the storyboard's compact vertical proportion, exact `DABBOBA` top marquee, smoky curved chamber, large circular hand crank, square coin area, deep lower outlet, and small feet.
- Capsule styling: the seven deterministic capsules use only olive/lime and ivory halves, a dark seam, glossy restraint, and a small `DB` monogram. No unrelated red/blue toy palette was introduced.
- Motion: the 3.2-second choreography uses finite transform/opacity/filter animations. The crank compresses and recovers once, the fixed pool mixes twice, the selected capsule resolves sharp as it drops, and the halves split while a dark reward card rises.
- Reveal accent: six fixed pixel squares and a bounded lime bloom remain inside the machine; the bloom peaks at 0.42 opacity and there are no looping particles, camera shake, or full-screen confetti.
- App integration: the established `결제 완료` ticket, product copy, draw button, probability sheet, and result sheet copy are unchanged. Only the gacha machine visual and the draw duration changed; kuji and direct-purchase branches intentionally remain untouched.
- Intentional deviation: the storyboard's warm presentation board is not reproduced inside the draw route because the accepted app direction reserves near-black for the arcade moment. The machine is code-native rather than one static raster crop so its crank, capsules, outlet, halves, and reward card can animate independently.
- Reduced motion: the same state resolves in 420 ms with movement reduced to effectively immediate state changes before the result sheet.
- Responsive fit: `work/qa/capsule-ready-iphone.png`, `work/qa/capsule-mix-iphone.png`, `work/qa/capsule-select-iphone.png`, `work/qa/capsule-open-iphone.png`, `work/qa/capsule-result-iphone.png`, and `work/qa/capsule-select-pixel.png` confirm the sequence stays inside the arcade screen on both device frames without horizontal overflow.

### Exchange and request-room fidelity ledger

- Copy and hierarchy: a listing keeps its title and details while adding an explicit `올린 상품 ↔ 원하는 교환품` relationship; the detail screen repeats that relationship before the application history.
- Palette: Exchange Room, customer center, and Request Room keep `#F5F5F1` canvas, `#FCFCF8` input surfaces, dark ink, muted secondary text, and green only for selected or active state.
- Container model: the accepted feed's open rows and hairline dividers continue through listings, application rows, and request cards; no nested dashboard-style card stack is introduced.
- Typography: dynamic exchange/request titles, product names, descriptions, authors, and metadata stay in the readable Korean UI typeface; `VOICE DESK` and `WISH BOARD` provide only short fixed pixel-title accents.
- Icons and controls: the existing monochrome person, message, heart, chevron, and back treatments are reused. The request like exposes `aria-pressed`, and the pushed detail, customer-center, and request-room screens omit the root navigation.
- Input behavior: exchange registration collects category, IP, title, offered item, wanted item, and detail; exchange application collects the proposed item and message; product requests collect category, IP, desired item, and detail through keyboard-aware fields.
- Persistence boundary: listings, applications, requests, and likes remain local fixture/session state and disclose that they can reset. Production requires authenticated ownership, unique likes, moderation, and server persistence.

## Iteration history

- P1: closing a sheet could scroll the outer device container and shift the fixed header/keyboard. Fixed with app-specific outer viewport clipping while retaining the inner `MobileScroll` behavior.
- P1: an early draw composition showed rectangular blend bands around the cabinet. Removed the texture from the draw screen and matched the stage/image background with normal blending.
- P1: paid draw passes could be abandoned through the draw header. The draw route now has a static header with no back action, and the final state clears the flow stack to the catalog root.
- P2: footer-adjacent page content was visible in the iOS safe area. Added an app-owned safe-area surface extension when the keyboard is closed.
- P2: tightened small-text contrast, increased compact controls to at least 44 px, added visible keyboard focus, radio-group arrow navigation, route-entry focus, and reduced-motion handling.
- Post-fix comparison found no remaining actionable P0, P1, or P2 visual issues.

## Interaction and technical review

- Verified the shared start `catalog → detail → quantity → checkout → mock payment` and both category branches end to end: 가챠·쿠지 continue to arcade draw, while 피규어·카드 finish on the ordinary purchase-complete screen.
- Coupon and payment radio groups support arrow-key selection, maintain roving focus, and update `aria-checked` correctly.
- Each pushed/replaced route focuses its current `main`. Closing the zero-pass result returns to one catalog flow screen and focuses its `main`.
- Result grades use the displayed S 2% / A 18% / B 80% mock distribution. Production settlement must be performed and signed by the backend; this client randomizer is prototype-only.
- iPhone regression check: no back control on the paid draw route, no outer scroll drift, no console/page/network errors.
- Pixel check: 427 × 952, `scrollWidth === clientWidth`, outer `scrollTop === 0`, no console/page/network errors.
- IP product check: all 25 products render, with filters reporting 가챠 8 / 피규어 8 / 쿠지 7 / 카드 2; the card filter contains only 원피스 and 포켓몬스터.
- IP detail check: the selected IP exposes only its connected category and its product card opens the existing 상품 상세 → 수량 → 결제 flow before the category-specific branch.
- Category-specific prize labels were verified only for draw categories, including 쿠지 (`라스트원상 / 상위상 / 굿즈상`). Cards and figures instead show direct-purchase guidance and never render the app-side prize table.
- Local media validation: all 25 product files decode successfully and the combined contact sheet shows the intended category-appropriate imagery without missing assets.
- Browser console check after the product expansion: zero error and warning entries.
- Root navigation check: all five tabs render once, switch with `FlowStack.replace()`, keep exact order, expose 69 × 79 px iPhone targets, and show the matching active page.
- Exchange-room verification target: register category/IP/title/offered/wanted/details, open a seeded and newly authored listing, submit a proposed item and message, confirm the shared application count, and confirm the pushed detail hides the root navigation.
- Request-room verification target: Profile → 고객센터 → 신청방, filter all four requested categories, submit category/IP/desired item/details, toggle one local like, and confirm guest actions route through the login prompt.
- Responsive verification target: repeat Exchange Room, exchange detail, customer center, and Request Room at iPhone 393 × 852 and Pixel 10 427 × 952 with no horizontal clipping or keyboard overlap. These new checks belong to the final consolidated validation rather than the historical evidence above.
- 뽀바 navigation check: 가챠 8 / 피규어 8 / 쿠지 7 / 카드 2. The 가챠 and 쿠지 routes reach `DABBOBA ARCADE`; the 피규어 and 카드 routes reach `주문 완료` with `개` and `팩` units respectively. The root navigation stays hidden on every commerce subroute and returns with 뽀바 selected.
- Profile detail check: stable `닉네임` and `한 줄 소개` labels, 2–12 character nickname validation, representative-IP selection, save-and-return behavior, and session persistence across root-tab switches passed. The screen also states that changes reset because no account backend is connected.
- Direct-purchase wording check: active figure and card screens contain no app-draw wording. Card stock, quantity, checkout, and completion consistently use `팩`; figure uses `개`; 가챠 uses `회`; 쿠지 uses `장`.
- iPhone root-screen check: all five pages reported zero horizontal overflow and one 70 px app footer.
- iPhone pushed-screen check: profile detail and card purchase completion both report `scrollWidth === clientWidth` at 393 × 852, with the fixed action area clearing the iOS home indicator.
- Pixel check: profile detail and card purchase completion report `scrollWidth === clientWidth` at 427 × 952, and the purchase footer clears the Android navigation surface.
- Fresh browser reload console check after navigation implementation: zero error and warning entries.
- Capsule animation check: iPhone ready/mix/drop/open/result captures and Pixel open capture passed; both machine bounds remained inside the stage, the result sheet appeared after the full 3.2-second sequence, and the protected device chrome remained intact.
- Expo embed check: `work/qa/expo-embed-pixel.png` confirms the app fills a 427 × 952 native WebView without the browser-preview bezel, device picker, simulated status bar, simulated keyboard, or Android navigation asset. The same root navigation and Shop transition remain interactive in embed mode.
- `npm run check:runtime`: passed, 28 protected runtime files unchanged.
- `npm run build`: passed; only the existing non-blocking Vite chunk-size advisory remains.
- `npm run test:runtime`: 8/8 passed.
- `npm run test:sites`: 4/4 passed.
- `node --test tests/ip-catalog-data.test.mjs`: 3/3 passed, including product count, category distribution, card restriction, IP linkage, and local file checks.
- `node --test tests/navigation-structure.test.mjs`: structural coverage now expects the user-facing `교환방` label while retaining the compatible `community` ID, plus accessibility state, root-only nav ownership, collapse behavior, and commerce footer separation. Rerun in the final consolidated validation.
- `node --test tests/profile-purchase-structure.test.mjs`: 5/5 passed, covering category-mode mapping, 15 draw / 10 purchase fixtures, profile detail ownership, keyboard-aware fields, checkout branching, and purchase-completion isolation.
- `node --test tests/community-detail-structure.test.mjs`: structural coverage now validates complete exchange/application/request fixtures, footer-free exchange and request routes, keyboard-aware registration/application fields, customer-center entry, and shared request likes. Rerun in the final consolidated validation.

## Latest focused QA — front pixel machine and isolated silver handle (2026-08-24)

- Source visual truth: user-provided screenshot retained outside the repository (`590 × 322` px). The leftmost machine and its compact silver circular crank are the selected target.
- Implementation evidence: `design-qa-phone.png` and `design-qa-implementation.png`; interaction evidence: `design-qa-drag.png`.
- Combined focused comparison: `design-qa-comparison-normalized.png` (`336 × 287` px), containing the source and implementation in one image after equal-height subject normalization. Focused comparison was required because the target is a machine asset rather than a complete app screen.
- Browser viewport: `1280 × 720` px at DPR 1. The protected iPhone content viewport measured `272.83 × 591.47` CSS px because the template scaled its `393 × 852` screen by `0.6942` to fit the browser height. The machine element measured `161.75 × 287.40` CSS px in that rendered scale. The component crops were normalized to `162 × 287` px for visual comparison; no claim is based on the surrounding scaled device chrome.
- State: paid gacha ready screen, front-facing machine, slider at rest; a separate real drag capture confirmed the slider and lever update together.

### Required fidelity surfaces

- Fonts and typography: the exact in-image `DABBOBA` pixel marquee remains legible and centered; no generated UI text or replacement font was introduced.
- Spacing and layout rhythm: the `233 × 414` machine slot keeps the stable vertical cabinet proportion, and the `38px`-wide center handle stays optically centered on the existing fixed mounting plate. Golden-ratio relationships were used as a starting guide, while optical centering and cabinet balance determined the final values.
- Colors and visual tokens: matte graphite cabinet, brushed silver lever, ivory capsules, lime capsules, tiny lime LEDs, and warm off-white surround match the reference hierarchy without adding a toy-like color set.
- Image quality and asset fidelity: the machine, fixed circular plate, and rotating handle are independent raster layers. The machine's crank area is plain graphite with its former square metal backing, screws, and ribbed slot removed. The fixed transparent `108 × 108` plate preserves the circular silhouette, inner ring, dark recess, center socket, and four screws; the clean transparent `108 × 40` handle contains no surrounding curved fragments. No CSS/div lever art or background halo is introduced.
- Copy and content: no app copy changed. Product, payment, readiness, and slider labels remain the existing Korean prototype copy.

### Comparison history

- P1 found on the first browser capture: the generic direct-child image selector forced the new lever PNG to the full `233 × 414` machine slot, obscuring the cabinet. Fix: assign the cabinet image its own `capsule-ready-machine-art` class and scope the lever selector separately. Post-fix evidence in `design-qa-phone.png` and `design-qa-comparison-normalized.png` shows the lever at the intended compact scale with the complete cabinet visible.
- Post-fix focused comparison: the cabinet silhouette, smoked chamber, lime/ivory capsule palette, DABBOBA marquee, lower outlet, fixed circular silver plate, and isolated horizontal handle remain visually balanced. The square backing is absent, so only the circular plate and separate rotating bar remain visible.

### Interaction and technical evidence

- Verified `catalog → product detail → quantity → checkout → payment complete → 가챠하러 가기` in the in-app browser.
- The slider and isolated handle use direct continuous coupling: `0–100%` slider travel maps linearly to `0–360deg` on the same pointer-update frames, without a separate transform delay. The circular plate and its four screws receive no transform. Completion enters `transitioning`, then mounts the 4-second capsule video.
- Exactly one ready machine rendered and zero retired `.capsule-machine` elements rendered.
- Browser error/warning log: zero entries.
- `npm run build`: passed after the final selector fix; protected runtime integrity passed for all 28 files. `git diff --check`: passed. The existing Vite chunk-size advisory remains non-blocking.

final result: passed

## 2026-08-24 — Home settings entry and settings detail flows

**Source visual truth**

- User-provided home reference retained outside the repository (`754 × 1510` px, supplied iPhone frame).
- Requested change: preserve the existing home composition while adding one line-style settings action beside search and building grouped footer-free settings pages.

**Rendered implementation evidence**

- Home content capture: `design-qa-settings-home.png` (`393 × 852` px).
- Settings hub capture: `design-qa-settings-main.png` (`393 × 852` px).
- Full-view comparison: `design-qa-settings-comparison-full.png` (`818 × 852` px). The supplied framed reference was scaled to `425 × 852`; the unframed app viewport remains `393 × 852`. The bezel mismatch is excluded from interface findings.
- Focused home-header comparison: `design-qa-settings-comparison-header.png` (`785 × 60` px). The source screen region (`694 × 106`) was normalized to `393 × 60` beside the implementation header crop (`393 × 60`).
- CSS viewport: `393 × 852`; device scale factor `1`; state: guest home followed by settings hub.

**Findings**

- No actionable P0, P1, or P2 mismatch was found in the first normalized comparison.
- Fonts and typography: the canonical pixel wordmark, 8-bit eyebrow labels, Korean UI hierarchy, weights, and wrapping remain consistent. Dense legal and form copy stays in the readable Korean UI font.
- Spacing and layout rhythm: the new 44 px gear target fits between search and points without moving or clipping the wordmark. Settings reuse the existing 16 px gutter, thin dividers, 68 px rows, and 9–10 px radius system.
- Colors and visual tokens: the warm off-white canvas, near-black copy, thin neutral borders, and restrained `#91E98E` accent remain unchanged. Destructive account deletion uses a muted red only where meaning requires it.
- Image quality and asset fidelity: no source image or brand asset was replaced. The wordmark, product art, and retro banner remain sharp and uncropped; new settings visuals use the existing line-icon library rather than substitute drawings.
- Copy and content: the requested 알림 수신설정, 사용자 설정, 고객센터, 기타, 로그아웃, 탈퇴 and all detailed destinations are present. Legal copy is explicitly labeled as a launch-structure draft with business-data and legal-review gaps, so prototype text is not presented as production-approved law.

**Interaction and technical evidence**

- Search → settings → points ordering and accessible gear label verified on the home header.
- 알림 수신설정 opens; the 교환방 switch changed from `true` to `false` and required notices remain separately identified.
- 공지사항 opened a full detail page for `DABBOBA 오픈 준비 안내`.
- 문의하기 accepted a category, title and 10+ character message, enabled submission, and showed the local completion state.
- 이용약관 및 정책 opened the legal hub and 개인정보 처리방침 detail.
- 탈퇴 요청 stayed disabled until the exact confirmation text `탈퇴` was entered, then enabled the second confirmation step.
- Browser console errors and warnings: zero.
- `git diff --check`, 34 structural tests, protected runtime check, production build, and Expo TypeScript check passed. The existing non-blocking Vite chunk-size advisory remains unrelated.

**Comparison history**

- First normalized full and focused comparison found no P0/P1/P2 issue, so no visual-fix iteration was required.

**Open Questions**

- Actual business identity, PG/shipping/cloud vendors, retention periods, draw disclosures, policy effective dates, and the Google Play external account-deletion URL still require production decisions before release.

**Implementation Checklist**

- [x] Add a 44 px line gear between search and points.
- [x] Group settings into notifications, user settings, support, and other.
- [x] Connect account, password, notices, inquiry, FAQ, legal, logout, and deletion flows.
- [x] Separate mandatory notices from optional activity and marketing choices.
- [x] Add launch-policy drafts and visible legal-review placeholders.
- [x] Verify mobile layout, interactions, console, tests, web build, and Expo type safety.

**Follow-up Polish**

- Replace bracketed legal placeholders and connect server-side inquiry, notification preference, logout, and account deletion APIs when production providers are selected.

final result: passed

## 2026-08-24 — Minimal capsule-machine navigation icon and exchange value hierarchy

**Source visual truth**

- User-selected capsule-machine reference retained outside the repository (`225 × 225` px).
- App asset derived from the supplied source: `public/assets/dabboba/ui/capsule-machine-nav.png` (`175 × 202` px, RGBA). Only blank outer margin and the white background were removed; the supplied machine geometry remains the visible mask.

**Rendered implementation evidence**

- Final navigation capture: `design-qa-navigation-focus.png` (`716 × 104` px), enlarged 2× from the browser-side phone preview for inspection.
- Focused icon crop: `design-qa-machine-focus.png` (`320 × 320` px).
- Same-input source/implementation comparison: `design-qa-machine-comparison.png` (`640 × 320` px), with the source and final navigation icon placed together.
- Exchange list evidence: `design-qa-exchange-screen.png` (`609 × 827` px).
- Exchange detail evidence: `design-qa-exchange-detail.png` (`609 × 827` px).
- Browser state: iPhone preview, `뽀바` selected for icon checks; authenticated local test state for exchange detail. The app-owned phone viewport remains `393 × 852` CSS px. The in-app browser scales the surrounding device preview to fit its desktop canvas, so focused captures were enlarged only for inspection; CSS measurements were taken from the live element.

**Required fidelity surfaces**

- Fonts and typography: no type treatment changed. Bottom-tab labels retain the existing size, weight, collapse behavior, and Korean UI font.
- Spacing and layout rhythm: the capsule machine now owns a true `23 × 23` CSS content box and a `23 × 23` mask, matching the square basis used by the other navigation icons. Existing touch targets, label spacing, floating-nav height, and safe-area spacing remain unchanged.
- Colors and visual tokens: the machine inherits the same neutral unselected color and `--db-green-ink` selected color as the existing line icons. No filled tile or decorative color was added.
- Image quality and asset fidelity: the supplied static machine artwork is used as a real source asset, not recreated as CSS art or inline SVG. Its simplified window, control strip, knob, slot, and outlet remain recognizable at navigation size.
- Copy and content: navigation order and labels remain `교환방 → 뽀바 → 홈 → 덕룸 → 프로필`. Exchange cards now surface the registered product image, product name, IP/category, and `앱 기준가`; the label avoids presenting prototype values as market prices.

**Findings and comparison history**

- [P2 fixed] The first integration used a `span`, so the shared bottom-tab label selector constrained the icon height to `13.5px`, making it narrower and smaller than the other square-based icons. The icon element was changed to a decorative `i`, the source margin was tightened, and both CSS width/height and mask size now resolve to exactly `23px`.
- [P2 fixed] The first custom line drawing felt visually busy and inconsistent with the selected source. It was removed and replaced with the user-supplied static machine silhouette.
- Post-fix comparison shows no actionable P0/P1/P2 mismatch. The selected icon is static, minimal, centered, and visually aligned with the existing 23 px icon set.

**Interaction and technical evidence**

- Bottom navigation switches to `뽀바`; live computed icon metrics are `23 × 23px`, selected color `rgb(23, 111, 42)`, and mask size `23 × 23px`.
- Exchange room list and authenticated detail display product-backed images and `앱 기준가`; guest detail access still shows `로그인이 필요합니다` with a `로그인` action.
- Browser error/warning log: zero entries.
- `git diff --check`: passed.
- `node --test tests/*.test.mjs`: 29/29 passed.
- `npm run check:runtime`: passed for all 28 protected files.
- `npm run build`: passed; only the existing non-blocking Vite bundle-size advisory remains.

**Follow-up Polish**

- None required for the requested icon proportion and exchange-card hierarchy.

final result: passed

## Latest focused QA — `IP SELECT` pixel-type wordmark (2026-08-24)

**Source visual truth**

- User-provided reference retained outside the repository (`162 × 36` px), specifically its uppercase `IP SELECT` Press Start 2P letter construction.
- The user requested the DABBOBA wordmark use the same typography while retaining the previously selected monochrome treatment.

**Rendered implementation evidence**

- Canonical web asset: `public/assets/dabboba/brand/dabboba-wordmark.png` (`1170 × 172` px, transparent RGBA).
- Mirrored Expo asset: `apps/mobile/assets/dabboba-wordmark.png` (`1170 × 172` px, byte-identical).
- Opening capture: `design-qa-logo-ipstyle-splash-full.png` (`1400 × 1200` px).
- Home capture: `design-qa-logo-ipstyle-home-full.png` (`1400 × 1200` px).
- Same-input focused comparison: `design-qa-logo-ipstyle-comparison.png` (`2010 × 220` px), with the source lettering and implemented DABBOBA wordmark normalized to the same 172 px height.
- Browser viewport: `1400 × 1200` CSS px at DPR 1; the protected iPhone app screen measured exactly `393 × 852` CSS px.
- State: opening splash and guest-first home header.

**Required fidelity surfaces**

- Fonts and typography: the asset is rendered from the exact bundled `Press Start 2P` font used by `.section-eyebrow`, with the same regular weight and tight letter rhythm. The home slot remains 16 px high and the opening slot remains 26 px high.
- Spacing and layout rhythm: the new natural aspect ratio renders at `108.84 × 16` CSS px in the home header and stays centered in the existing splash lockup. Search, points, slogan, and navigation spacing remain unchanged.
- Colors and visual tokens: every logo letter remains near-black `#111411`; the opening loader remains the existing `#91E98E` accent.
- Image quality and asset fidelity: both app surfaces consume one transparent raster source at full natural size (`1170 × 172`) and scale it proportionally. No background rectangle, clipping, or transparency halo is visible.
- Copy and content: only the letter construction changed. `DABBOBA`, `원하는 거 다 뽑아`, product copy, and navigation labels remain unchanged.

**Findings and comparison history**

- No actionable P0/P1/P2 mismatch was found. The source and implementation share the same stepped terminals, square counters, pixel stroke width, and tight arcade lettering rhythm.
- The implementation intentionally uses near-black instead of the source crop's muted green-grey because the latest brand decision keeps the complete DABBOBA wordmark monochrome.

**Interaction and technical evidence**

- The same asset loads completely on opening and home (`naturalWidth: 1170`, `naturalHeight: 172`) and the guest-first transition remains unchanged.
- Browser console error/warning entries: zero.
- `git diff --check`: passed.
- `npm run check:runtime`: passed for all 28 protected runtime files.
- `npm run build`: passed; only the existing non-blocking Vite bundle-size advisory remains.
- `npm --prefix apps/mobile exec tsc -- --noEmit`: passed.

final result: passed

## Latest focused QA — canonical wordmark from opening to home (2026-08-24)

- Source visual truth: `public/assets/dabboba/logo-concepts/dabboba-wordmark-dot-preview.png` (`2048 × 512` px), with the uppercase `DABBOBA` dot construction and `DaBboBa` color rhythm.
- Canonical implementation asset: `public/assets/dabboba/brand/dabboba-wordmark.svg` (`814 × 134` intrinsic px, tight `viewBox="105 60 814 134"`) and the native Expo raster counterpart `apps/mobile/assets/dabboba-wordmark.png` (`814 × 134` px with alpha).
- Browser-rendered implementation evidence: `design-qa-wordmark-splash.png` and `design-qa-wordmark-home.png`, each lossless PNG at `393 × 852` px.
- Combined full-view evidence: `design-qa-wordmark-comparison.png`, containing the source target above the stable opening and home states in one image.
- Focused logo evidence: `design-qa-wordmark-focus.png`, ordered source → opening → home after slot-specific crops and nearest-neighbour enlargement for inspection.
- Viewport and density: embedded Expo-style web state at `393 × 852` CSS px, DPR 1; the rendered app screen measured exactly `393 × 852` CSS px. No density normalization was required.
- State: opening wordmark captured at 850 ms, after its 720 ms entrance and before the 1050 ms exit; home captured after the splash fully unmounted.

### Required fidelity surfaces

- Fonts and typography: the logo is the supplied image asset rather than a font reconstruction. Supporting copy keeps the established Korean UI type. Opening label size is 26 px high and home is 16 px high, a golden-ratio-adjacent 1.625 relationship with optical stability taking priority.
- Spacing and layout rhythm: the opening logo measures `157.94 × 26` CSS px and is centered at x `117.53`; the home logo measures `97.19 × 16` CSS px at x `18` within the 58 px header. The slogan, search target, and point pill retain their existing hierarchy and do not collide or wrap.
- Colors and visual tokens: first `D`, third-position `B`, and sixth-position `B` resolve to canonical `#91E98E`; all other letters resolve to `#111411` on the warm `#F5F5F1` canvas.
- Image quality and asset fidelity: web uses the tight vector asset with `shape-rendering="crispEdges"`; Expo uses a transparent 814 × 134 PNG derived from that asset. No text, CSS art, inline SVG, placeholder, stretching, clipping, or transparency halo replaces the selected logo.
- Copy and content: `원하는 거 다 뽑아` remains intact below the opening and home wordmarks. Semantic copy such as page titles and `나의 DABBOBA` remains text instead of being incorrectly converted into branding artwork.
- Accessibility and motion: the home and login logos expose `DABBOBA` alt text, decorative nested marks use empty alt text under labelled containers, and the opening animation collapses to 1 ms under reduced-motion preference.

### Findings and comparison history

- No actionable P0, P1, or P2 mismatch was found in the final combined comparison. The same letter geometry, exact color positions, aspect ratio, and warm-background treatment continue from opening to home.
- The first evidence attempt captured a scaled preview shell and a partially animated logo. This was an evidence-normalization issue, not an implementation defect. The final pass reset the browser after applying the viewport, captured the embedded app at exact 1:1 size, waited for the stable logo state, and used lossless CDP PNG evidence.
- Focused magnification exposes normal subpixel antialiasing at the deliberately small 16 px home slot; the unscaled `393 × 852` capture remains legible and visually stable, so no fidelity fix is required.

### Interaction and technical evidence

- Verified the guest-first opening transitions naturally into the home catalog with the same canonical wordmark and without a login gate.
- Browser error/warning log: zero entries.
- `npm run check:runtime`: passed, 28 protected runtime files unchanged.
- `npm run build`: passed; only the existing non-blocking Vite chunk-size advisory remains.
- `npm --prefix apps/mobile run typecheck`: passed.
- `git diff --check` and both SVG XML parses: passed.

final result: passed

## Latest focused QA — monochrome wordmark and green opening loader (2026-08-24)

- Source visual truth: `public/assets/dabboba/brand/dabboba-wordmark.svg` (`814 × 134` intrinsic px), retaining the selected uppercase dot geometry with every dot changed to `#111411` by explicit user direction.
- Native counterpart: `apps/mobile/assets/dabboba-wordmark.png` (`814 × 134` px, transparent), regenerated directly from the canonical SVG.
- Browser evidence: `design-qa-wordmark-black-splash.png` and `design-qa-wordmark-black-home.png`, each lossless PNG at `393 × 852` px.
- Combined full-view comparison: `design-qa-wordmark-black-comparison.png`, containing the flattened canonical asset above the opening and home states in one image.
- Focused comparison: `design-qa-wordmark-black-focus.png`, ordered canonical asset → opening → home with nearest-neighbour inspection enlargement.
- Viewport and state: embedded app at `393 × 852` CSS px, DPR 1. Opening was captured at 850 ms after the logo entrance stabilized and before exit; home was captured after the splash unmounted.

### Required fidelity surfaces

- Fonts and typography: the selected dot geometry remains an image asset rather than font reconstruction. The opening logo remains `157.94 × 26` CSS px and the home logo remains `97.19 × 16` CSS px, preserving the approved 1.625 visual ratio.
- Spacing and layout rhythm: the opening logo stays centered at x `117.53`, while the home logo stays at x `18` inside the 58 px header. No slogan, search, points, or navigation spacing changed.
- Colors and visual tokens: every logo letter is monochrome `#111411`. All four opening loader pixels compute to `rgb(145, 233, 142)` (`#91E98E`); only opacity and vertical position animate, so the effect never switches to grey or black.
- Image quality and asset fidelity: the web keeps the tight SVG with crisp-edge rendering and Expo keeps the transparent raster derived from it. The final 1:1 captures show no stretching, clipping, colored-letter remnants, background box, or transparency halo.
- Copy and content: `원하는 거 다 뽑아` remains unchanged under the logo. No product, navigation, login, or commerce copy changed.
- Accessibility and motion: existing alt text and labelled-container behavior remain intact. Reduced-motion handling still collapses the opening animation duration without removing the green status cue.

### Findings and comparison history

- No actionable P0, P1, or P2 mismatch was found in the first normalized comparison. Opening and home use the same monochrome geometry, while green remains confined to the requested four-pixel loading effect and existing interaction states.
- Focused enlargement shows expected subpixel antialiasing at the 16 px home slot; the unscaled capture is sharp and legible, so no visual correction is required.

### Interaction and technical evidence

- Verified the guest-first opening transitions into home with the all-black wordmark and a four-pixel `#91E98E` loader.
- Browser error/warning log: zero entries.
- `npm run check:runtime`: passed, 28 protected runtime files unchanged.
- `npm run build`: passed; only the existing non-blocking Vite chunk-size advisory remains.
- `npm --prefix apps/mobile run typecheck`: passed.
- Expo public config resolves the updated splash asset and warm `#F5F5F1` background.
- `git diff --check`, SVG XML parsing, PNG dimensions, and alpha checks: passed.

final result: passed
## 2026-08-24 — Selected hybrid wordmark 01 app-wide rollout

**Source visual truth**

- Selected ImageGen result: `public/assets/dabboba/logo-concepts/dabboba-wordmark-hybrid-01-source.png` (`1586 × 992` px).
- Repository source copy: `public/assets/dabboba/logo-concepts/dabboba-wordmark-hybrid-01-source.png`.
- Canonical transparent implementation asset: `public/assets/dabboba/brand/dabboba-wordmark.png` (`1288 × 172` px, alpha), mirrored at `apps/mobile/assets/dabboba-wordmark.png` for Expo.

**Rendered implementation evidence**

- Home content screenshot: `design-qa-logo-home-content-2x-final.png` (`393 × 852` px).
- Splash content screenshot: `design-qa-logo-splash-content-full-final.png` (`393 × 852` px).
- Focused home-header crop: `design-qa-logo-home-focus-final.png` (`180 × 58` px).
- Same-input source/implementation comparison: `design-qa-logo-comparison-final.png`.
- Browser viewport and CSS app viewport: `393 × 852`; `devicePixelRatio: 1`; no density downsampling required.
- State: guest-first opening splash followed by the home root screen at `?embed=1`.

**Findings**

- No actionable P0/P1/P2 mismatch. The rendered logo preserves the selected geometric letter construction, stepped terminals, monochrome near-black treatment, and wide lockup.
- Fonts and typography: the wordmark is the selected image asset rather than a substituted font. The existing Korean tagline hierarchy and weights remain unchanged and readable.
- Spacing and layout rhythm: the splash uses a 26 px wordmark height and the home header uses 16 px; both retain optical breathing room without colliding with header actions or copy.
- Colors and tokens: the wordmark remains `#111411`; `#91E98E` remains limited to the four-pixel loader and interaction/status accents.
- Image quality and asset fidelity: the transparent export loads at its full `1288 × 172` natural size, reports complete in-browser, has no visible warm-background rectangle, and remains sharp at the home-header scale.
- Copy and content: `DABBOBA`, `원하는 거 다 뽑아`, and all semantic screen titles remain unchanged.

**Primary interaction and runtime evidence**

- `npm run check:runtime`: passed for all 28 protected runtime files.
- `npm run build`: passed; TypeScript and Vite production build completed. The existing bundle-size advisory remains non-blocking and is unrelated to this visual change.
- Expo TypeScript check: passed with `npm --prefix apps/mobile exec tsc -- --noEmit`.
- Home search action opened the IP search screen; its search field and back action were visible, and returning restored the home logo.
- Browser console errors: none.

**Comparison history**

- Initial and final visual comparison found no P0/P1/P2 issues, so no visual fix iteration was required. An early browser clip included the preview frame; the evidence above uses the supported `?embed=1` content-only viewport and a 1:1 `393 × 852` capture, so that capture normalization issue is excluded from fidelity findings.

**Open Questions**

- None for the selected app-owned wordmark surfaces. The capsule-machine illustration and cinematic contain their own in-world arcade marquee artwork and were intentionally not redrawn as UI logos.

**Implementation Checklist**

- [x] Preserve the exact selected 1번 source image.
- [x] Export one transparent canonical wordmark for web and Expo.
- [x] Apply it to splash, home, login, draw-header, and native loading/error surfaces through the existing shared consumers.
- [x] Preserve the green loader and all semantic text.
- [x] Pass runtime, build, Expo type, interaction, console, and visual checks.

**Follow-up Polish**

- None required for this rollout.

final result: passed
