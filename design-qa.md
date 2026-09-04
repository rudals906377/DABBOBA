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

## 2026-08-30 — Orange pull-tab kuji selection and peel-open flow

**Source and rendered evidence**

- Source visual truth: `work/audits/kuji-open-reference/frames/frame-01.png` (`440 × 960` px), extracted from the supplied kuji-opening video. The comparison target is the orange landscape ticket, cream inset frame, left pull control, rightward opening affordance, and restrained dark reveal stage; third-party logos, characters, Japanese copy, and prize data are excluded.
- Generated project asset: `apps/mobile/assets/kuji-ticket-front.png` (`1517 × 1037` px), created with the built-in image-generation tool as an original text-free, brand-free orange ticket face. The app overlays only the stable ticket number and contextual state.
- Native implementation: `work/audits/kuji-ticket-app/selection-v1.png`, `work/audits/kuji-ticket-app/reveal-sealed-v2.png`, and `work/audits/kuji-ticket-app/summary-v1.png` (`1206 × 2622` px each).
- Full-view comparison input: `work/audits/kuji-ticket-app/compare-sealed-v2.png` (`1206 × 1311` px). Source and implementation were each normalized to `603 × 1311` px and placed together before judgment.
- Focused comparison input: `work/audits/kuji-ticket-app/compare-ticket-focused-v2.png` (`1400 × 750` px). The source and implementation ticket regions were normalized to a common 700 px width and padded without stretching.
- Viewport and density: DABBOBA SDK54 iOS Simulator, `402 × 874` logical points at `3×`; the source is a separately recorded physical kiosk at a similar portrait ratio, so full-screen chrome and exact background geometry are intentionally not treated as fidelity targets.
- States: 50-ticket five-column customer selection board, one sealed ticket ready to open, and six-result open-all summary with one featured-left region plus a virtualized right rail.

**Findings and comparison history**

- Initial P1 in `reveal-sealed-v1.png`: the raster front face retained intrinsic image dimensions inside the animated layer, so the pull tab and left half were clipped and the inset border appeared in the middle of the ticket.
- Fix: explicitly bind the generated front-face image to `100% × 100%` of the animated ticket layer. The post-fix full and focused comparisons show the complete left pull tab, arrow, double frame, empty number field, and serial motif at the intended landscape proportion.
- Initial P2: a visible `임시 화면` badge made the development route look unlike the customer flow and repeated a prototype boundary inside the UI.
- Fix: remove the developer badge from both sealed and summary layouts while keeping the preview development-only, neutral, and inventory-free in code and QA documentation.
- Post-fix comparison found no actionable P0, P1, or P2 visual issue. The source brand and prize copy are intentionally replaced by neutral `KUJI` / `NO.` content, and the app's fixed black stage plus green accent remain the established DABBOBA design language.

**Required fidelity surfaces**

- Fonts and typography: short fixed `KUJI`, `NO.`, `READY`, and result codes use the bundled pixel face; Korean actions and product identity stay in the readable app typography. The selection-board numbers are bold tabular numerals and remain readable at five-column density.
- Spacing and layout rhythm: the existing 50-position, five-column wrap remains intact with 44 pt minimum targets. The large ticket is centered at the same landscape proportion as the source, the stage keeps the shared 12 pt gutter, and the floating action panel clears all scroll content.
- Colors and tokens: the ticket uses the requested warm orange/burnt-orange/cream/charcoal palette, while `#91E98E` remains reserved for selection, focus, primary action, and restrained reveal accents.
- Image quality and asset fidelity: the ticket front is a project-owned raster asset rather than CSS/View art or a copied source logo. It decodes sharply at `1517 × 1037`, fills both compact and large ticket slots without checkerboard or external shadow artifacts, and keeps the registered product media behavior unchanged.
- Copy and content: no tutorial paragraph or customer-facing developer label was added. Before commit the ticket exposes only its number/state; preview results remain neutral `RESULT` placeholders and do not name a prize or rarity.

**Interaction and technical evidence**

- The ticket front uses one horizontal `PanResponder`: vertical scroll intent is left to the parent, a rightward release opens at 58% travel or after an intentional positive fling, and shorter/leftward gestures spring back. The same `onOpen` seam powers the ticket tap and fixed bottom-button fallback.
- Reduced Motion is read and observed through `AccessibilityInfo`; it skips the wipe/aura travel and resolves the same state immediately. Result state changes announce through accessibility APIs.
- One-by-one and open-all preview states preserve selected ticket numbers. The all-open summary renders a large representative region on the left and the remaining items in a vertically virtualized right rail; it deliberately avoids claiming `최상위 결과` until a server-ranked `highestResultId` or committed tier rank exists.
- Native shell automation in this pass could open and capture every route/state but did not provide pointer-drag injection. Gesture thresholds, reset/open decisions, one-by-one transitions, all-open completion, explicit server-consume ownership, and tap fallback are covered by focused deterministic tests; the sealed, selection, and summary layouts were directly observed in the SDK54 simulator.
- Fresh verification: 24/24 focused kuji selection/reveal/slot tests and all 175 repository unit tests passed. Expo mobile TypeScript, protected-runtime integrity (28 files), production web/Sites build, and `git diff --check` also passed; the existing non-blocking Vite chunk-size advisory remains.
- Evidence is iOS Simulator/local Expo proof only; Android, physical-device, signed-store-build, production payment, atomic multi-entitlement commit, and authoritative highest-result selection are not claimed.

final result: passed

## 2026-08-30 — Paper-kuji ticket board redesign

**Source and rendered evidence**

- Kuji interaction reference: `/tmp/dabboba-kuji-video.xk8QFY/frame-01.png` (`880 × 1920` px), used for dense selectable-ticket rhythm and explicit picked/available states rather than exact kiosk geometry.
- Supplied defect screenshot: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_EMHd02/스크린샷 2026-08-30 오후 4.42.17.png` (`826 × 1356` px), showing the prior circular number seals and keypad-like cards.
- Revised native captures: `work/qa/kuji-paper-ticket-top.png`, `work/qa/kuji-paper-ticket-selected.png`, and `work/qa/kuji-paper-ticket-bottom.png` (`1206 × 2622` px each).
- Same-input full comparison: `work/qa/kuji-paper-ticket-redesign-comparison.png` (`2072 × 1356` px), containing the video reference, supplied defect crop, and revised native board together. Each panel was normalized to 1356 px height; the kiosk recording and supplied crop are not identical app viewports, so the comparison is intentionally limited to ticket anatomy, state contrast, density, and hierarchy.
- Viewport and state: DABBOBA SDK54 iOS Simulator, `402 × 874` logical points at `3×`; inspected with available, selected, and sold tickets, then scrolled through ticket 50 and the one-line remaining-tier row.

**Findings and iteration history**

- Initial P1: identical dark rounded rectangles with circular number seals read as a bingo board or keypad instead of physical kuji tickets.
- Fix: every slot is now a vertical warm-paper ticket with a large serial number, `NO.` marker, dashed tear line, and distinct bottom stub. The circular seal was removed while the five-column, 50-ticket structure remained unchanged.
- Initial P2: available, selected, and sold tickets depended heavily on low-contrast surface changes and a separate legend.
- Fix: available tickets use an ivory `쿠지` stub, selected tickets use a brand-green checked `선택` stub plus green outline, and sold tickets use gray paper plus an explicit `완료` stub. The redundant legend and instructional caption were removed.
- Post-fix comparison shows no actionable P0, P1, or P2 issue: the board reads as a dense rack of tear-off tickets, all three states remain explicit without color alone, and the final ticket and tier row clear the floating action panel.

**Required fidelity surfaces**

- Fonts and typography: serial numbers use bold tabular numerals for fast scanning; `NO.` stays subordinate; the short stub states use the approved readable Korean pixel face at a legible size.
- Spacing and layout rhythm: the existing five-column density is preserved with approximately 80 pt ticket height, compact 6 pt radii, an internal body/tear-line/stub split, and touch targets well above 44 pt.
- Colors and tokens: the near-black arcade board remains; warm ivory paper separates kuji selection from gacha, canonical `#91E98E` is reserved for the selected state, and sold tickets use neutral gray without reducing the whole control's opacity.
- Image quality and asset fidelity: no product asset was replaced or cropped. Ticket styling is the interactive control itself; existing Ionicons supplies the selected check mark, and no fake raster, emoji, handcrafted SVG, or placeholder asset was introduced.
- Copy and content: the board retains only `쿠지 선택`, counts, and the ticket-state labels `쿠지` / `선택` / `완료`; the instructional sentence and separate legend are absent. The 50-ticket count and one-line S/A/B/C/D quantities remain unchanged.

**Interaction and technical evidence**

- Simulator interaction confirmed that pressing an available ticket toggles the green checked stub and selection count, while sold tickets remain disabled and visually marked `완료`.
- Drag scrolling confirmed the complete 50-ticket board and compact remaining-tier row are reachable above the persistent floating `쿠지 뽑기` action.
- A focused regression test now requires the paper-ticket body, dashed perforation, and stub while rejecting the former circular `ticketSeal` and removed helper caption.
- Consolidated verification passed: Expo mobile TypeScript checking, all 174 unit tests, protected-runtime integrity, production build, and `git diff --check`.
- Evidence is iOS Simulator/local-preview proof only; Android, signed-native, physical-device, and store-build behavior is not claimed.

final result: passed

## 2026-08-30 — Native kuji 50-ticket selection and reveal flow

**Source and rendered evidence**

- Reference video: `/Users/kyoungmin/Desktop/KakaoTalk_Video_2026-08-30-15-41-51.mp4`; extracted interaction sheet: `/tmp/dabboba-kuji-video.xk8QFY/key-frames.png`.
- Native selection evidence: `work/qa/kuji-50-board-top.png` and `work/qa/kuji-50-board-tier-remaining.png`.
- Native reveal evidence: `work/qa/kuji-click-test.png`, `work/qa/kuji-50-all-ready.png`, and `work/qa/kuji-50-all-summary.png`.
- Flow comparison: `work/qa/kuji-video-flow-comparison.png`.
- Viewport and state: DABBOBA SDK54 iOS Simulator, `402 × 874` logical points at `3×`; the board top, board bottom, grade inventory, one-by-one opening, 50-ticket all-open readiness, and all-open summary were inspected.

**Findings and iteration history**

- The customer selection screen now presents a stable 50-ticket board in five columns, distinguishes available, selected, and sold tickets, keeps the five-minute pixel timer, and derives payment confirmation from the selected count and product unit price.
- The requested grade inventory is placed immediately below the board. It shows the remaining quantity per published grade in server order; the current local development catalog has no published grade inventory, so its fallback is explicitly marked `화면 예시` and is unavailable in production builds.
- The reveal decision remains after payment confirmation: `한 장씩 오픈` advances through sealed tickets one at a time, while `한 번에 오픈` reveals the complete set in one action.
- Multi-open results place the explicitly highest-ranked committed result in the large left card and the remaining results in a readable vertical rail on the right. Product media uses `contain` to preserve the registered image ratio.
- Intentional safety divergence from the reference: hidden grade/prize mappings never appear on customer ticket positions before payment. Public selection exposes only ticket identity and availability.

**Interaction and server boundaries**

- The current 50-result visual path is a development-only preview with neutral `RESULT` placeholders; it does not claim that 50 paid results were committed by the current one-entitlement reveal API.
- A validated server utility now expands operator-entered grade quantities, requires their sum to equal the total, assigns every position exactly once with cryptographic randomness, preserves explicit lower-is-higher `tierRank`, and strips the hidden mapping from the public availability projection.
- Production wiring still requires a sealed-slot persistence model, idempotent publish transaction, slot reservation, payment-to-result binding, and an API snapshot that returns authoritative availability and aggregate grade counts without leaking position mappings.
- Consolidated verification passed: mobile and API TypeScript checks, 173 unit tests, protected-runtime integrity, production web build, iOS Expo export, and `git diff --check`.
- Evidence is iOS Simulator/local-preview proof only; physical-device, signed-store-build, production payment, and production persistence behavior are not claimed.

final result: passed

## 2026-08-30 — Remove generic explanatory copy from 뽀바 and Product Detail

**Source and rendered evidence**

- Source visual truth: `work/qa/explanatory-copy-ppoba-reference.png` (`854 × 658` px) and `work/qa/explanatory-copy-detail-reference.png` (`838 × 1746` px). These are defect references: the intended change is the removal of the visible generic explanatory paragraphs, not pixel-for-pixel preservation of those paragraphs.
- Rendered implementation: `work/qa/explanatory-copy-ppoba-native.png` and `work/qa/explanatory-copy-detail-native.png`, each `1206 × 2622` px from the DABBOBA SDK54 iOS Simulator (`402 × 874` logical points at `3×`).
- Combined comparison inputs: `work/qa/explanatory-copy-ppoba-comparison.png` (`1708 × 658` px) and `work/qa/explanatory-copy-detail-comparison.png` (`1676 × 1746` px). Each file places the supplied defect reference on the left and the revised native implementation on the right.
- Density normalization: the 뽀바 implementation used a `1206 × 930` top crop scaled to the reference's `854 × 658`; the Product Detail implementation was scaled to `838` px wide and top-cropped to `1746` px. The comparison is limited to app-owned content; simulator bezel and clock differences are not evaluated.
- State: 뽀바 root above the first catalog rows, and the same 죠죠의 기묘한 모험 쿠지 Product Detail. The supplied 뽀바 capture had 쿠지 selected while the native capture had 가챠 selected; category-specific product content is outside this copy-removal judgment.

**Findings and comparison history**

- Initial P2: the 뽀바 root placed a two-line generic introduction between the compact header and search, delaying the primary search and category controls.
- Fix: removed the introduction component, its exclusive typography import, and its style. The search now follows the header with the existing tokenized top margin.
- Initial P2: Product Detail inserted a generic registration/helper paragraph after price, duplicating the factual workflow rows beneath it.
- Fix: removed the description paragraph and its exclusive style. The real product identity and price now lead directly into the required draw, storage, and shipping facts.
- Post-fix evidence: both combined comparison images show the unwanted paragraphs absent, the vacated vertical space collapsed, and no overlapping or clipped content. No actionable P0/P1/P2 differences remain for this request.

**Required fidelity surfaces**

- Fonts and typography: the existing Galmuri11 screen titles and Noto Sans KR product/content hierarchy are unchanged; removed body copy leaves no orphaned line or fallback font.
- Spacing and layout rhythm: the search shell and fact card move upward through normal layout flow; screen gutters, control heights, radii, and section spacing remain token-based and symmetric.
- Colors and visual tokens: the off-white canvas, muted IP line, near-black primary text, and canonical green controls are unchanged.
- Image quality and asset fidelity: product images retain their complete source aspect ratios and native `contain` behavior. No asset was replaced or synthesized.
- Copy and content: generic introduction/registration/helper prose is removed. Product title, IP, category, stock, price, workflow facts, probability state, and primary actions remain.

**Interaction and verification**

- Search, category controls, filter drawer, wishlist, quantity controls, and `뽑으러 가기` remain present and visually unobstructed.
- Fresh checks passed: protected-runtime integrity (`28` files), Expo mobile TypeScript, production build, `139` unit tests, focused structural regression, and `git diff --check`.
- Evidence is native iOS Simulator proof only; no physical-device or signed-store-build claim is made.

final result: passed

## 2026-08-30 — 보관함 배송 안내 한글 줄바꿈

**Source and implementation evidence**

- Source visual truth: `work/qa/shipping-text-wrap-reference.png` (`768 × 494` px), copied from the supplied screenshot. It shows `교환` split as `교` / `환` and `포함되면` split as `포함` / `되면`.
- Revised native screen: `work/qa/shipping-text-wrap-after-top-native.png` (`1206 × 2622` px), captured from the DABBOBA SDK54 iOS Simulator at a `402 × 874` pt viewport and `3×` density.
- Focused same-input comparisons:
  - `work/qa/shipping-text-wrap-info-comparison.png` (`1536 × 160` px), supplied state on the left and revised 안내 박스 on the right.
  - `work/qa/shipping-text-wrap-policy-comparison.png` (`1536 × 279` px), supplied state on the left and revised 무료배송 카드 on the right.
- State: root `보관함`, `배송 신청` selected, no stored inventory, scroll position at the top.

**Findings and comparison history**

- Initial P2: this screen rendered fixed Korean explanatory copy with the ordinary text primitive, so iOS could break individual Hangul words and leave `교` or `포함` at the end of a line.
- Fix: the shared balanced-description primitive now renders the section lead, eligibility notice, shipping introduction, free-shipping explanation, and empty policy guidance. It keeps iOS on Hangul word boundaries and Android on balanced wrapping without adding forced breaks to product names or user-authored content.
- Revised result: `교환` and `포함되면` remain intact. Card geometry, font sizing, colors, actions, and shipping policy wording are unchanged. No actionable P0/P1/P2 issue remains.

**Required fidelity surfaces**

- Fonts and typography: Noto Sans KR remains the readable body face; only the shared line-breaking strategy changed. No pixel font or synthetic weight was introduced into explanatory copy.
- Spacing and layout rhythm: existing gutters, card padding, radii, line heights, tab dimensions, and vertical spacing remain unchanged; text containers continue to size naturally.
- Colors and tokens: the warm canvas, muted body text, neutral cards, and DABBOBA green guidance remain unchanged.
- Image quality: the affected region contains no replacement image assets; product and navigation imagery are unaffected.
- Copy and content: every customer-facing sentence, amount, category, and shipping rule remains verbatim. Only word-boundary layout changed.

**Interaction and technical evidence**

- Root `/dukroom` opened directly in the running iOS Simulator and retained the selected `배송 신청` tab, bottom navigation, and scroll behavior.
- The focused regression test first failed on the missing balanced text primitive, then passed after the affected descriptions were connected.
- Consolidated verification passed: protected-runtime integrity (28 files), Expo mobile TypeScript checking, all 139 unit tests, and `git diff --check`.
- Existing non-blocking Node module-type warnings remain unrelated to this change. Physical-device and signed-store-build behavior are not claimed from Simulator evidence.

final result: passed

## 2026-08-30 — Home 쿠지 wide card

**Evidence and normalization**

- Source visual truth: `work/qa/home-kuji-wide-reference.png` (`796×590`), copied byte-for-byte from the user-provided screenshot for this QA pass.
- Pre-change native evidence: `work/qa/home-six-section-layout.png` (`1206×2622`), where 쿠지 used the same compact square card geometry as the other categories.
- Revised native evidence: `work/qa/home-kuji-wide-native.png` (`1206×2622`), iOS Simulator Home with the 쿠지 filter selected.
- Focused implementation crop: `work/qa/home-kuji-wide-focus.png` (`368×275`). The native capture was normalized to the Xcode screenshot viewport of `368×800`, then cropped to the 쿠지 image and copy region.
- Combined comparison input: `work/qa/home-kuji-wide-comparison.png` (`760×275`), with the source on the left and revised implementation on the right. The source was normalized to `368×275`; a 24 px neutral gap separates the two artifacts.
- State: Home root, 쿠지 category selected, first product at the leading edge of the one-row horizontal rail. Evidence is local iOS Simulator output, not a signed build or physical-device result.

**Findings and iteration history**

- Initial P1: the pre-change Home treated 쿠지 as a compact 164 px square card, materially changing the wide promotional-art proportion shown in the source and cropping landscape artwork.
- Fix: 쿠지 cards now use the available viewport width after the standard side gutters, capped at 520 px on wider layouts. Both 오늘의 뽀바 and IP collection cards measure the source image, preserve its original aspect ratio, and use native `contain`; other categories remain 164 px wide.
- Post-fix evidence: the focused board shows the same near-full-width landscape hierarchy, rounded image surface, top-left 쿠지 badge, small IP line, and larger subject title. No actionable P0/P1/P2 mismatch remains.
- Expected product difference: the DABBOBA card retains its existing price line and horizontal next-card hint because the request changes 쿠지 presentation width, not product information or carousel behavior.

**Required fidelity surfaces**

- Fonts and typography: the existing Noto Sans KR product hierarchy is retained. The muted IP line remains smaller than the bold product subject, matching the source hierarchy without changing app-wide typography.
- Spacing and layout rhythm: the revised card keeps the 16 px Home gutter and nearly fills the phone width, matching the source's proportional side margin. Image-to-IP and IP-to-title spacing remain optically aligned with the reference.
- Colors and tokens: the warm off-white canvas, canonical green 쿠지 badge, near-black title, and muted IP text remain on existing design tokens.
- Image quality and asset fidelity: the registered product image is used directly, with no generated substitute. Original-ratio measurement plus `contain` shows the complete landscape artwork without square cropping or distortion.
- Copy and content: the canonical IP appears once in the small line and the product subject remains the large title. Existing price information is intentionally preserved.

**Interaction and verification**

- The 쿠지 category control was tapped in the Simulator and the wide state rendered immediately.
- The Home product rail was swiped left; the next wide 쿠지 card moved into view while the vertical feed and floating navigation remained usable.
- Focused home tests, mobile TypeScript checking, and the final workspace verification cover the category-specific width rule and both Home card variants.

final result: passed

## 2026-08-30 — Ppoba catalog media follows each source aspect ratio

This section supersedes only the Ppoba-list portion of the older “Edge-to-edge catalog product photography” decision. Home 쿠지 cards follow the preceding wide-card rule; other Home categories, Exchange feed items, Product History, account, and compact fixed thumbnail slots continue to use `cover`. Ppoba product cards follow the latest explicit request to show the complete registered photograph.

**Source and rendered evidence**

- Source visual truth: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_5VDbEh/스크린샷 2026-08-30 오전 4.53.49.png` (`972 × 1798` px), showing a landscape Tokyo Revengers asset cropped into a square Ppoba card.
- Rendered implementation: `work/qa/ppoba-kuji-adaptive-after-default.png` (`409 × 848` px), captured from the open `localhost:3200` DABBOBA SDK54 Simulator stream with Ppoba → Kuji selected.
- Full-view combined comparison: `work/qa/ppoba-kuji-adaptive-full-comparison.png` (`1944 × 1798` px). The implementation capture was scaled proportionally from `409 × 848` to `868 × 1798` and centered in a `972 × 1798` black comparison column; the source column remained at native pixels. This normalizes the browser canvas height without interpreting either stream capture as physical-device density proof.
- Focused media comparison: `work/qa/ppoba-kuji-adaptive-media-comparison.png` (`1376 × 688` px). The source square media region remained `688 × 688`; the rendered `292 × 164` landscape media region was scaled proportionally to `688 × 386` and centered without cropping.
- Viewport and state: source `972 × 1798` browser capture; implementation default in-app-browser viewport/capture `409 × 848`; signed-in native Ppoba Kuji catalog with one full-width card per row. The live API fixture changed from Tokyo Revengers to Evangelion, so the comparison evaluates the same catalog surface and landscape-media rule, not product identity.

**Findings and iteration history**

- Initial P1: a fixed `1:1` frame plus `cover` materially removed both side edges of every landscape Kuji asset, hiding subjects and artwork text.
- Fix: Ppoba cards now reset the measured ratio when the URI changes, read the source dimensions with `Image.getSize`, confirm dimensions again on load, bind `width / height` to the frame, and render the registered asset with `contain`. The existing Gacha two-column and Kuji one-column widths remain unchanged.
- Post-fix evidence: both visible Kuji cards render as landscape frames. The Evangelion card keeps the far-left artwork, central title art, and far-right characters visible simultaneously; no stretching, crop, letterbox band inside the media frame, or synthetic replacement asset is present.
- Revised result: no actionable P0, P1, or P2 finding remains. If image dimensions are temporarily unavailable, the card safely starts at `1:1`; after load it adopts the source ratio, and `contain` prevents image-edge loss during that fallback.

**Required fidelity surfaces**

- Fonts and typography: the pixel Ppoba heading and Noto Sans KR product metadata, weights, line heights, wrapping, and truncation remain unchanged.
- Spacing and layout rhythm: only media height now follows its source. Card gutter, full-width Kuji column, two-column Gacha grid, category badge, radii, metadata spacing, and floating navigation remain unchanged.
- Colors and visual tokens: the warm page canvas, neutral stroke, green category badge, and navigation tokens are unchanged.
- Image quality and asset fidelity: original catalog assets render directly at their intrinsic landscape, portrait, or square ratio with all edges visible and no distortion. No generated, approximated, or duplicated background asset was introduced.
- Copy and content: IP, subject title, price, stock, category labels, description, and search/filter wording are unchanged.

**Interaction and technical evidence**

- Ppoba navigation and the Kuji category control were exercised in the live Simulator stream; both remained responsive after the image-frame change.
- Browser console error check returned no errors in the verified state.
- Structural coverage protects URI reset, valid-dimension guards, race cleanup, dynamic aspect-ratio binding, `contain`, and removal of the fixed-square Ppoba frame while preserving `cover` on compact non-Ppoba thumbnails.
- Consolidated verification passed: Expo mobile TypeScript, all 138 unit tests, protected-runtime integrity, production web build, and `git diff --check`. The existing Vite chunk-size advisory remains non-blocking and is unrelated to this media change.
- Evidence is local in-app-browser and iOS Simulator-stream proof only; physical-device, signed-native, and store-build behavior is not claimed.
- A separate focused region was necessary because full-view scaling makes the complete image edges and aspect-ratio change harder to judge.

final result: passed

## 2026-08-29 — Checkout payment-connection guide

**Source and rendered evidence**

- Source visual truth: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_ftoErK/스크린샷 2026-08-29 오후 9.06.40.png` (`694 × 1518` px), showing the approved local checkout-preparation confirmation and its explicit no-PG/no-order boundary.
- Alert interaction proof: `/tmp/dabboba-checkout-alert-flow-proof.png` (`1206 × 2622` px), captured after pressing `결제 준비 완료` in the running native app.
- Next-screen implementation proof: `/tmp/dabboba-checkout-confirm-to-connection-proof.png` (`1206 × 2622` px), captured after pressing the alert's `확인` action rather than opening the destination by deep link.
- Exit interaction proof: `/tmp/dabboba-checkout-connection-return-proof.png` (`1206 × 2622` px), showing that `뽀바로 돌아가기` returns to the native shop root.
- Full normalized comparison: `work/qa/native-checkout-connection-guide-comparison.png` (`742 × 3168` px). The implementation capture was normalized from `1206 × 2622` to the source's `694 × 1518` dimensions before stacking.
- Viewport and density: DABBOBA SDK54 iOS Simulator at `402 × 874` logical points and `3×` native screenshot density.

**Findings and comparison history**

- The source is the preceding alert state, not a mock of the new destination, so this pass evaluates flow continuity, visual-system fidelity, and truthful state communication rather than pretending the two screens should be pixel-identical.
- No actionable P0, P1, or P2 issue remains. The new screen inherits the same safe-area header, pixel-title hierarchy, warm canvas, card geometry, green selection language, product data, and fixed amount footer.
- The first rendered implementation already preserved the required commerce boundary, kept all status labels at `결제 전` or `대기`, and avoided presenting a payment, order number, or draw entitlement. No visual correction loop was required.
- A separate focused crop was unnecessary because the full normalized board keeps the header, status hero, product card, selected-payment summary, amount footer, typography, and imagery readable at the same source width.

**Required fidelity surfaces**

- Fonts and typography: the single `결제 연결 안내` interface title and section headings use the shared Galmuri pixel system; product names, amounts, instructions, and button labels remain in Noto Sans KR with readable weight and wrapping.
- Spacing and layout rhythm: the destination keeps the existing 14–16 px native gutter, compact 12 px section rhythm, rounded SEED card geometry, 44 px header target, and footer separated from the scroll region.
- Colors and tokens: the established warm basement/default surfaces, near-black safety hero, canonical `#91E98E` brand accent, neutral strokes, and muted supporting copy all map to existing SEED tokens.
- Image quality and asset fidelity: the server product image is reloaded and rendered through the existing catalog URL resolver with the approved edge-to-edge `cover` thumbnail treatment; no placeholder or generated substitute appears in the verified state.
- Copy and content: the page explicitly says the current state is `결제 전`, explains `가격·재고 재확인 → PG 결제 승인 → 서버 주문 확정 → 추첨권 발급`, and states that the local app sends no PG request and creates no payment, order number, or entitlement.

**Interaction and technical evidence**

- Pressing `결제 준비 완료` opened the approved native alert. Pressing its `확인` action opened the new footer-free route with the selected product, quantity, payment method, and point intent.
- The destination reloaded live product data, recomputed the displayed total from the server product price, and clamped query-supplied quantity and point values before display.
- Pressing `뽀바로 돌아가기` replaced the route with the native shop root; the app was then reopened on the new guide for handoff.
- No payment, order, inventory, or draw mutation endpoint is called from the new screen.
- Physical-device, real PG-provider, signed-webhook, production-order, and signed-store-build verification remain outside this local Simulator pass.

final result: passed

## 2026-08-29 — Root-header capsule stroke alignment

**Source and rendered evidence**

- Source visual truth: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_dGcVCq/스크린샷 2026-08-29 오후 8.56.13.png` (`270 × 68` px), where the capsule contour and seams read materially thinner than search and notifications.
- Revised iOS Simulator evidence: `/tmp/dabboba-header-capsule-stroke-after.png` (`1206 × 2622` px), captured on the 교환방 root screen.
- Focused comparison: `work/qa/root-header-capsule-stroke-comparison.png` (`318 × 230` px), normalizing the before and after action rows for direct optical review.
- State and density: DABBOBA SDK54 iOS Simulator at native `1206 × 2622` screenshot density. The header keeps the existing 23 px Ionicons and 25 px capsule slot.

**Findings and implementation**

- Initial P2: the raster capsule asset used hairline source strokes, so downsampling it to 25 px made the outline and both shell seams visually lighter than the adjacent search and bell icons.
- Fix: the approved transparent capsule asset remains the visual source, with eight subpixel neutral-tinted outline passes behind it to reinforce only the downsampled outer contour. The established 25 px slot, two curved parallel source seams, 15-degree clockwise tilt, green upper shell, white lower shell, and restrained highlight remain intact.
- Revised result: the three actions now share one optical line-weight family at normal header viewing size. The capsule remains distinct without text, center latch, or monster-ball construction.

**Required fidelity surfaces**

- Fonts and typography: unchanged; the header title keeps its pixel treatment and this icon contains no text.
- Spacing and layout rhythm: unchanged; all three actions retain their shared 44 px targets and fixed search → notifications → product-history order.
- Colors and tokens: the shell uses the canonical brand token `#91E98E`; contour and seams use the shared neutral foreground token; the lower shell and highlight use the elevated white layer token.
- Image quality and asset fidelity: the original transparent capsule asset remains the foreground source; the outline reinforcement prevents its silhouette from disappearing during 25 px downsampling without replacing the approved artwork.
- Copy and content: unchanged.

**Interaction and technical evidence**

- Search, notifications, and product-history routes remain unchanged; this is a visual-only icon implementation change.
- Structural coverage fixes the 25 px asset and frame, neutral outline reinforcement, and 15-degree tilt while preserving the approved source artwork.
- Consolidated verification passed: native TypeScript, all 119 unit tests, protected-runtime integrity, production web build, Expo iOS export, `git diff --check`, Metro health, and the `localhost:3201` preview.
- Simulator evidence confirms the revised line weight; physical-device and signed-store-build verification remain outside this pass.

final result: passed

## 2026-08-29 — Intrinsic-ratio Product Detail photography

**Source and rendered evidence**

- Source visual truth: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_6nm1Fp/스크린샷 2026-08-29 오후 8.33.38.png` (`696 × 646` px), showing the supplied landscape Tokyo Revengers artwork forced into a square crop.
- Intermediate spacing reference: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_EEra9m/스크린샷 2026-08-29 오후 8.39.10.png` (`706 × 376` px), where the complete landscape artwork was visible but the side gutters still felt too large.
- Final iOS Simulator evidence: `/tmp/dabboba-landscape-product-detail-centered-after-v2.png` (`1206 × 2622` px).
- Same-product focused comparison: `work/qa/product-detail-intrinsic-landscape-comparison.png` (`1200 × 1596` px), with the supplied square crop above and the final original-ratio hero below.
- State and density: Tokyo Revengers Product Detail on the DABBOBA SDK54 iOS Simulator at native `1206 × 2622` screenshot density. The 8 px logical app gutter renders as 24 native pixels at this density.

**Findings and iteration history**

- Initial P2: the fixed square hero combined with `cover` cropped both sides of the registered `1280 × 720` landscape asset, removing one subject and cutting visual text.
- First fix: the hero began measuring the source with `Image.getSize` and rendered with `contain`, which restored the whole photo and removed the fixed square frame, border, and synthetic background.
- Intermediate P2: the ratio-driven view resolved its width from the previous layout and left an oversized right gutter despite symmetric margin intent.
- Final fix: a dedicated full-width outer container now owns the symmetric 8 px page gutter, while the inner hero explicitly fills 100% of that container and derives only its height from the source aspect ratio.
- Revised result: no actionable P0, P1, or P2 issue remains. All four characters, the title art, and the copyright line remain visible without crop, stretch, or letterbox space; the photograph is centered and uses nearly the full screen width.

**Required fidelity surfaces**

- Fonts and typography: Product Detail typography and the pixel header remain unchanged.
- Spacing and layout rhythm: the hero keeps 8 px horizontal gutters and the existing 16 px vertical rhythm. The detail copy naturally moves upward for landscape media.
- Colors and tokens: the warm page canvas and existing product colors remain unchanged; no new frame, border, or background has been added around the image.
- Image quality and asset fidelity: the original `1280 × 720` asset renders at its intrinsic `16:9` ratio with no blur, crop, distortion, or replacement asset.
- Copy and content: product IP, subject title, price, stock, and metadata remain unchanged.

**Interaction and technical evidence**

- Back, wishlist, quantity, commerce, and cross-link behavior remain unchanged.
- Compact catalog, exchange, and account thumbnails intentionally retain edge-to-edge `cover` behavior because those surfaces remain fixed thumbnail slots; this intrinsic-ratio rule applies to Product Detail media.
- Consolidated verification passed: Expo native TypeScript, all 118 unit tests, protected-runtime integrity, production web build, Expo iOS export, `git diff --check`, Metro health, and the `localhost:3201` preview. The existing Node module-type and Vite chunk-size advisories remain non-blocking and are unrelated to this change.
- Physical-device and signed-store-build verification remain outside this Simulator QA.

final result: passed

## 2026-08-29 — Product-row title hierarchy

**Source and rendered evidence**

- Source visual truth: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_QTPDfh/스크린샷 2026-08-29 오후 8.29.59.png` (`676 × 968` px), showing Product History rows where the small IP title was repeated again inside the large product title.
- Revised iOS Simulator evidence: `/tmp/dabboba-product-row-title-hierarchy-after.png` (`1206 × 2622` px), showing the same Product History list after the shared subject-title rule was applied.
- Focused normalized comparison: `work/qa/product-row-title-hierarchy-comparison.png` (`676 × 1705` px), with the supplied list above and revised list below.
- State and density: `내가 본 상품` on the DABBOBA SDK54 iOS Simulator. The live recently viewed order changed after opening products during verification; the comparison evaluates the same registered rows and hierarchy, not their history order.

**Findings and iteration history**

- Initial P2: the small muted line already established the IP, but large row titles repeated `원피스`, `도쿄 리벤저스`, and the full Slime IP. This weakened the intended `작품명 → 상품 내용` hierarchy and spent horizontal space on duplicate words.
- Fix: the reusable catalog row now uses the same exact-match subject-title formatter as Product Detail. It removes one canonical IP occurrence from the large product title, preserves qualifiers such as `극장판`, and falls back to the registered title when the IP is not an exact match or removal would leave no subject.
- Revised result: no actionable P0, P1, or P2 mismatch remains. Visible examples now read `원피스 / 카드게임 OP-13 계승되는 의지`, `도쿄 리벤저스 / 천축편 이치방쿠지`, and `전생했더니 슬라임이었던 건에 대하여 / 극장판 창해의 눈물편 이치방쿠지`.

**Required fidelity surfaces**

- Fonts and typography: the small Noto Sans KR IP line remains muted and regular; the large subject remains the existing strong row title. Size, weight, line height, and two-line limit are unchanged.
- Spacing and layout rhythm: thumbnail, copy column, category badge, price, card padding, radius, and row gaps are unchanged. Removing duplicate text only improves available line space.
- Colors and tokens: unchanged; the warm card surface, neutral metadata, near-black subject, and green category badge retain their existing tokens.
- Image quality: unchanged; product images remain full-bleed `cover` crops in the existing rounded thumbnail frame.
- Copy and content: no registered product data was altered. The formatter changes presentation only and preserves the full original title as its fallback.

**Interaction and technical evidence**

- The row accessibility label still uses the complete registered product name, and every row still opens the shared Product Detail route.
- Unit coverage verifies subject extraction and fallback behavior; structural coverage fixes the shared row to the formatter so history, draw, and wishlist modes keep the same hierarchy.
- Consolidated verification passed: native TypeScript checking, 118 unit tests, protected-runtime integrity, production web build, Expo iOS export, `git diff --check`, Metro health, and the `localhost:3201` Simulator preview.
- The production web build retains its existing non-blocking chunk-size advisory, and the unit run retains its existing non-blocking Node module-type warning for `product-title.ts`; neither warning comes from this hierarchy change.
- Physical-device and signed-store-build verification remain outside this Simulator QA.

final result: passed

## 2026-08-29 — Wishlist in Product History

**Source and rendered evidence**

- Source visual truth: `/Users/kyoungmin/Desktop/스크린샷 2026-08-29 오후 8.22.00.png` (`690 × 242` px), showing the existing two-segment Product History header.
- Revised iOS Simulator evidence: `/tmp/dabboba-product-history-wishlist-after.png` (`1206 × 2622` px), showing the same header with the added `찜한 상품` segment and the existing recently viewed list.
- Focused normalized comparison: `work/qa/product-history-wishlist-tab-comparison.png` (`690 × 517` px), with the supplied reference above and revised implementation below.
- State and density: Product History with `내가 본 상품` selected on the DABBOBA SDK54 iOS Simulator. The implementation crop was normalized from native screenshot density to the supplied 690 px width before comparison.

**Findings and iteration history**

- Initial gap: Product History exposed only viewed and drawn products even though the authenticated wishlist already existed elsewhere in the account experience.
- Fix: the segment row now contains `내가 본 상품`, `내가 뽑은 상품`, and `찜한 상품` at equal flexible widths. Wishlist mode reads the existing profile snapshot, renders the real account wishlist with the shared catalog row, records the wished date, and opens the shared Product Detail route.
- Revised result: no actionable P0, P1, or P2 mismatch remains. All three Korean labels fit on one line at the target width, share the same 36 px minimum height and 8 px radius, and retain the existing green selected state without increasing the header height.

**Required fidelity surfaces**

- Fonts and typography: the pixel `상품 기록` title and Noto Sans KR segment/body copy are unchanged; the new label uses the same weight and line treatment as its siblings.
- Spacing and layout rhythm: header, content gutter, segment gap, description offset, and list geometry remain unchanged. Only the segment widths redistribute evenly from two to three columns.
- Colors and tokens: the canonical green selected fill, warm surface, neutral border, and muted inactive text remain unchanged.
- Image quality: the shared product row continues to use full-bleed `cover` product imagery; no new or replacement asset was needed.
- Copy and content: the new mode uses concise wishlist-specific guidance and a dedicated empty state. Existing viewed/drawn wording is preserved.

**Interaction and technical evidence**

- The new mode is backed by `/v1/account/wishlist` through the existing authenticated profile snapshot rather than a duplicated local-only fixture.
- Each wishlist row routes to `/product/{productId}`. The visible segment control and its selected-state behavior were inspected in the running Simulator, while structural coverage protects the wishlist branch, server snapshot binding, empty copy, and product-detail connection.
- Consolidated verification passed: native TypeScript checking, 118 unit tests, protected-runtime integrity, production web build, Expo iOS export, `git diff --check`, Metro health, and the `localhost:3201` Simulator preview.
- The production web build retains its existing non-blocking chunk-size advisory, and the unit run retains its existing non-blocking Node module-type warning for `product-title.ts`; neither warning comes from this Product History change.
- Physical-device and signed-store-build verification remain outside this Simulator QA.

final result: passed

## 2026-08-29 — Edge-to-edge catalog product photography

**Source and rendered evidence**

- Supplied catalog-grid reference: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_Cd702l/스크린샷 2026-08-29 오후 8.19.33.png` (`694 × 500` px), where wide product art was letterboxed inside square cards.
- Supplied product-detail reference: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_PFfXF7/스크린샷 2026-08-29 오후 8.19.43.png` (`704 × 664` px), where the same image treatment left large blank bands above and below the artwork.
- Revised iOS Simulator grid evidence: `/tmp/dabboba-product-cover-grid-after.png` (`1206 × 2622` px).
- Revised iOS Simulator detail evidence: `/tmp/dabboba-product-cover-detail-after.png` (`1206 × 2622` px).
- Focused comparisons: `work/qa/catalog-product-cover-grid-comparison.png` (`696 × 901` px) and `work/qa/catalog-product-cover-detail-comparison.png` (`696 × 1200` px).
- State and density: Home catalog and Product Detail on the DABBOBA SDK54 iOS Simulator at native screenshot density. The supplied and revised detail captures contain different fixture products, so the comparison evaluates the shared image-frame behavior rather than content identity.

**Findings and iteration history**

- Initial P2: native `contain` sizing preserved the full wide image but exposed large neutral bands inside the fixed product frame, making the catalog look unfinished and reducing the visual weight of the merchandise.
- Historical fix at the time of this pass: customer-facing product photography used centered native `cover` sizing across the listed surfaces. The later Product Detail intrinsic-ratio pass and the 2026-08-30 Ppoba intrinsic-ratio pass supersede that choice on those two surfaces only.
- Current result: Home, Exchange, reusable catalog/history rows, and profile account thumbnails still fill their fixed rounded slots with `cover`. Product Detail and Ppoba catalog cards instead preserve every source edge at the original ratio, as recorded in their newer QA sections.

**Required fidelity surfaces**

- Fonts and typography: unchanged; Noto Sans content text and isolated pixel-display titles retain their existing roles.
- Spacing and layout rhythm: the historical fixed-thumbnail geometry remains applicable only to the compact surfaces named above; newer Product Detail and Ppoba sections document their adaptive media geometry.
- Colors and tokens: unchanged; no synthetic backdrop, blur fill, or new color layer was introduced.
- Image quality: compact fixed thumbnails still render the original asset directly with native `cover`; Product Detail and Ppoba use their newer intrinsic-ratio rules. No surface uses an enlarged duplicate background, placeholder, or generated replacement.
- Copy and content: unchanged.

**Interaction and technical evidence**

- Home product cards still open Product Detail, and the revised full-bleed hero was inspected in the running Simulator stream.
- Structural coverage now protects the per-surface rule: compact thumbnails retain `cover`, while Product Detail and Ppoba retain intrinsic-ratio `contain` behavior.
- Consolidated verification passed: native TypeScript checking, 118 unit tests, protected-runtime integrity, production web build, Expo iOS export, `git diff --check`, Metro health, and the `localhost:3201` Simulator preview.
- The production web build retains its existing non-blocking chunk-size advisory, and the unit run retains its existing non-blocking Node module-type warning for `product-title.ts`; neither warning comes from this image-fit change.
- Physical-device and signed-store-build verification remain outside this Simulator QA.

final result: passed

## 2026-08-29 — Smoother root-navigation expansion and collapse

**Source and rendered evidence**

- Source motion reference: `/Users/kyoungmin/Desktop/KakaoTalk_Video_2026-08-29-18-48-16.mp4`, sampled in `/tmp/dabboba-nav-reference-every-second.png` (`2012 × 1457` px).
- Revised motion capture: `/tmp/dabboba-nav-smooth-after.mp4` (`1206 × 2622` px, 5.78 seconds) recorded from the running iOS Simulator while collapsing and re-expanding the Home navigation through scroll gestures.
- Detailed implementation contact sheet: `/tmp/dabboba-nav-smooth-after-detail.png` (`2468 × 1456` px), sampled at 8 fps and cropped to the navigation region.
- Side-by-side motion board: `work/qa/root-navigation-smoother-motion-comparison.png` (`4480 × 1456` px), with the reference sequence on the left and the DABBOBA implementation sequence on the right.
- State and density: Home root catalog on the SDK54 iOS Simulator at native `1206 × 2622` screenshot density. No browser frame was used as native motion proof.

**Findings and iteration history**

- Initial P2: the bar used a fixed 220 ms timing curve while the active selection-track width and position were recalculated from `onLayout`. Bar size, label visibility, and selection geometry could therefore update on different frames and make quick direction changes feel abrupt.
- Fix: expansion and collapse now share one interruptible, overshoot-clamped spring. Width, height, radius, vertical offset, label reveal, tab width, and selection-track geometry all derive continuously from the same animated value.
- Revised result: the sampled frames show intermediate sizes in both directions without a skipped endpoint, stacked animation, or rebound. The active Home track remains centered while the capsule width changes.

**Required fidelity surfaces**

- Typography: Noto Sans KR labels are unchanged; their reveal now fades and clips gradually instead of dropping out at the end of an unrelated layout pass.
- Spacing and geometry: the expanded and compact resting sizes are unchanged. Only interpolation and damping changed, so safe-area position and 44 px touch targets remain intact.
- Colors and surfaces: the translucent warm capsule, neutral active track, and canonical green selection indicator are unchanged.
- Motion accessibility: reduced-motion continues to set the requested resting state immediately, bypassing the spring.

**Interaction and technical evidence**

- Verified collapse while scrolling down and re-expansion while scrolling up in the running iOS Simulator.
- Native TypeScript checking and the root-navigation structural regression test passed after the motion change.
- Consolidated verification passed: 118 unit tests, protected-runtime integrity, production web build, Expo iOS export, `git diff --check`, Metro health, and the `localhost:3201` Simulator preview.
- The production web build still emits its existing non-blocking chunk-size advisory; the unit run still emits its existing non-blocking Node module-type warning for `product-title.ts`. Neither warning originates from this navigation motion change.
- Physical-device and signed-store-build verification remain outside this Simulator QA.

final result: passed

## 2026-08-29 — Home discovery order and Dukroom preview

**Source and rendered evidence**

- Removal reference: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_0IyFbP/스크린샷 2026-08-29 오후 7.40.25.png` (`1017 × 234` px), showing the black API-status introduction card that must no longer appear.
- Final home-top iOS Simulator capture: `/tmp/dabboba-home-top-final.png` (`1206 × 2622` px).
- Final lower-home iOS Simulator capture: `/tmp/dabboba-home-dukroom-final.png` (`1206 × 2622` px).
- Dukroom navigation proof: `/tmp/dabboba-home-dukroom-detail-proof.png` (`1206 × 2622` px).
- Same-input comparison board: `work/qa/home-section-order-comparison.png` (`2400 × 1400` px).
- State: native Expo Home feed on the DABBOBA SDK54 iOS Simulator, with the local catalog API available.

**Findings**

- No actionable P0, P1, or P2 issue remains.
- The former black `원하는 거 다 뽑아` API-status introduction card is absent.
- The native Home feed now follows the requested order exactly: `다뽀바 인기 작품`, `오늘의 뽀바`, then `다뽀바 덕룸`.
- `오늘의 뽀바` deliberately presents a compact four-product set so the community preview is reachable without turning Home into the full shop catalog. Category chips continue to filter this compact set.
- The Home Dukroom rail combines available community posts with the existing registered-product example content and preserves the established image, author, IP, title, like, and comment presentation.

**Required fidelity surfaces**

- Fonts and typography: the DABBOBA wordmark and Korean pixel section-title system remain unchanged; product, author, price, and community metadata continue to use the shared Noto text system.
- Spacing and layout rhythm: removing the hero closes the dead area above discovery while retaining the existing Home gutter, section spacing, horizontal rails, and transparent floating-navigation inset.
- Colors and tokens: the warm page surface, near-black text, canonical green rank/category accents, and quiet card borders remain unchanged.
- Image quality: the existing catalog and Dukroom assets render at native Simulator density without a replacement placeholder in the inspected states.
- Copy and content: the three requested Korean section titles are the only Home discovery headings in this flow; the technical API/cache source note was removed from customer-facing UI.

**Interaction and technical evidence**

- Tapping the first Home Dukroom card opened the existing native `덕룸 상세` route and displayed the matching post content.
- The structural regression test fixes the hero removal, exact three-section order, four-product Home limit, Dukroom preview fetch, and detail-route connection.
- Physical-device and signed-store-build verification remain outside this Simulator QA.

final result: passed

## 2026-08-29 — Product-detail IP and subject hierarchy

**Source and rendered evidence**

- Source title crop: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_iLmdwm/스크린샷 2026-08-29 오후 7.46.05.png` (`1017 × 234` px).
- Final iOS Simulator capture: `/tmp/dabboba-product-title-after-2.png` (`1206 × 2622` px).
- Focused implementation crop: `/tmp/dabboba-product-title-after-focus.png` (`1140 × 360` px).
- Same-input focused comparison: `work/qa/product-title-hierarchy-comparison.png` (`2200 × 520` px).
- State: `전생했더니 슬라임이었던 건에 대하여` 쿠지 상품 상세, native Expo app on the DABBOBA SDK54 iOS Simulator.

**Findings and iteration history**

- Initial P2: the canonical IP name appeared both in the small metadata line and again inside the large product heading, weakening hierarchy and forcing an avoidable extra line.
- Fix: the detail screen now removes one exact occurrence of the loaded IP name from the registered product title and uses the remaining subject as the large heading. Qualifiers before the IP name are preserved.
- Revised result: no actionable P0, P1, or P2 mismatch remains. The small line contains `전생했더니 슬라임이었던 건에 대하여`; the large line contains only `극장판 창해의 눈물편 이치방쿠지`.

**Required fidelity surfaces**

- Fonts and typography: the small line retains the shared muted Noto Sans KR metadata treatment, while the subject retains the existing large, heavy Noto Sans KR product-title treatment.
- Spacing and layout rhythm: the existing 4 px title gap, product-detail gutter, badge row, price rhythm, and footer placement are unchanged; removing repeated copy reduces the heading from three lines to one in the inspected state.
- Colors and tokens: the warm surface, muted IP color, near-black subject color, and green category badge are unchanged.
- Image quality: the existing licensed/prototype product asset remains untouched and renders with the same contain treatment.
- Copy and content: only duplicated IP text is removed from the large heading. Registered product data, descriptions, price, stock, and commerce copy remain unchanged.

**Interaction and technical evidence**

- Exact-prefix, in-title, separator, no-match, and whole-title fallbacks are covered by the product-title unit tests.
- The title is derived at render time; catalog source data and API contracts are not rewritten.
- Physical-device and signed-store-build verification remain outside this Simulator QA.

final result: passed

## 2026-08-29 — Scroll-responsive floating root navigation

**Source and rendered evidence**

- Motion reference: `/Users/kyoungmin/Desktop/KakaoTalk_Video_2026-08-29-18-48-16.mp4` (`1320 × 306`, 24 fps, 27 seconds).
- Reference contact sheet: `/tmp/dabboba-nav-reference-every-second.png`.
- Expanded iOS Simulator state: `/tmp/dabboba-nav-expanded-final.png` (`1206 × 2622` px).
- Compact iOS Simulator state: `/tmp/dabboba-nav-compact-v1.png` (`1206 × 2622` px).
- Same-input comparison: `work/qa/root-navigation-motion-comparison.png` (`1600 × 1620` px), with the video states above and DABBOBA expanded/compact states below.
- Viewport and state: DABBOBA SDK54 iOS Simulator, top/root expanded state and the compact visual state used after downward scrolling.

**Findings**

- No actionable P0, P1, or P2 visual mismatch remains. The implementation preserves the reference's floating translucent surface, stable five-item layout, neutral moving selection track, and compact icon-only state without copying the reference brand.
- Typography: the expanded labels remain Noto Sans KR; compact mode removes the labels instead of scaling them into illegibility.
- Spacing and layout: the expanded bar is 66 px high and uses the available mobile width; the compact bar reduces to 54 px high and at most 304 px wide. Both remain centered above the bottom safe area.
- Colors and tokens: selection uses the existing DABBOBA green only for the icon and thin two-pixel indicator. The larger moving track stays neutral, keeping the adult, restrained SEED-derived direction.
- Accessibility: every tab keeps a minimum 44 × 44 px target in both states, and reduced-motion preference collapses transition duration while preserving state changes.
- Image quality: no new raster or placeholder asset was introduced; existing line icons and the shared Ppoba icon remain sharp and optically balanced.

**Interaction and technical evidence**

- All five root scroll screens share the same direction-aware handler. Downward movement accumulates 18 px before compacting; upward movement accumulates 10 px before expanding; returning within 12 px of the top expands immediately.
- A tab change expands the bar and moves the neutral selection track with a damped spring (`damping: 23`, `stiffness: 230`). The bar itself uses a 220 ms cubic-bezier transition and never fully hides.
- The compact screenshot was produced as a deterministic visual-state capture; transition behavior is covered by the shared implementation and structural regression assertions rather than claimed as physical-device gesture proof.
- Physical-device and signed-store-build validation remain outside this local iOS Simulator QA.

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

## 2026-08-29 — Root header action order and capsule balance

**Source and rendered evidence**

- User-selected order: `검색 → 알림 → 캡슐`, with the capsule fixed at the far right.
- Before capture: `/tmp/dabboba-title-capsule-live-2.png` (`1206 × 2622` px).
- Final iOS Simulator capture: `/tmp/dabboba-header-order-final.png` (`1206 × 2622` px).
- Same-input focused comparison: `work/qa/root-header-actions-order-comparison.png` (`1206 × 210` px), with before on the left and final on the right.
- State: Home root screen, iPhone simulator, development catalog loaded.

**Findings**

- No actionable P0, P1, or P2 issue remains.
- The final header visibly follows `검색 → 알림 → 캡슐`; all five root screens consume the same shared action component, so the order stays consistent across categories.
- Search and notification remain 23 px line icons. The 25 px capsule has a darker outline with comparable optical weight, a canonical green upper shell, exactly two curved seams, no wordmark or center latch, and a restrained 15-degree clockwise tilt.
- The three controls keep their existing 44 px touch targets and vertical alignment. Moving the capsule to the far right does not shift the Home wordmark or reduce header breathing room.

**Interaction and technical evidence**

- The updated order was bundled by Expo and inspected in the running iOS Simulator.
- Expo iOS export, native TypeScript checking, protected-runtime checking, and the production web build passed.
- The structural test now fixes the requested action order to prevent regression.

final result: passed

## 2026-08-29 — Transparent root-navigation overlay

**Source and rendered evidence**

- Source motion reference: `/Users/kyoungmin/Desktop/KakaoTalk_Video_2026-08-29-18-48-16.mp4`, represented by `/tmp/dabboba-nav-reference-every-second.png` (`2012 × 1457` px).
- Initial implementation evidence: `/tmp/dabboba-nav-expanded-final-live.png` (`1206 × 2622` px), where the tab bar still occupied a separate footer region.
- Revised iOS Simulator evidence: `/tmp/dabboba-nav-transparent-footer-v1.png` (`1206 × 2622` px).
- Same-input focused comparison: `work/qa/root-navigation-transparent-overlay-comparison.png` (`1600 × 1840` px), with the source states above and the revised DABBOBA navigation overlay below.
- State and density: scrolled root catalog on the DABBOBA SDK54 iOS Simulator at native screenshot density; no cross-density measurement was used for spacing judgments.

**Findings and iteration history**

- Initial P2: the custom tab bar participated in the bottom-tab flex layout, leaving an opaque page-colored footer around the floating capsule. This visually stopped the feed before the navigation and weakened the requested floating-over-content effect.
- Fix: the outer footer is now absolutely positioned on all four bottom edges, fully transparent, and layered above the root scene. Every root feed receives a shared 124 px content inset so its final item can still scroll clear of the control.
- Revised result: no actionable P0, P1, or P2 mismatch remains. Product cards, images, and text visibly continue beneath and around the navigation capsule while the capsule surface remains readable.

**Required fidelity surfaces**

- Fonts and typography: Noto Sans KR tab labels and the isolated pixel-title system are unchanged.
- Spacing and layout rhythm: the previous rectangular footer reservation is gone; the floating capsule remains centered and safe-area aligned without changing its expanded or compact dimensions.
- Colors and tokens: the outer overlay is fully transparent, while the navigation capsule retains its restrained translucent warm surface and canonical green selection indicator.
- Image quality: existing product images remain visible behind the overlay without a new mask, placeholder, or raster asset.
- Copy and content: no labels or app copy changed.

**Interaction and technical evidence**

- Pointer handling remains `box-none` outside the capsule, so uncovered page content stays scrollable and tappable.
- All five root screens use the same bottom content inset and shared floating-navigation component.
- Physical-device and signed-store-build verification remain outside this Simulator QA.

final result: passed

## 2026-08-29 — Balanced Korean explanatory copy

**Source and rendered evidence**

- Source visual truth: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_xSFfgK/스크린샷 2026-08-29 오후 8.12.55.png` (`650 × 244` px), showing the Exchange Room introduction with `여러` split across lines as `여` / `러`.
- Initial native evidence: `/tmp/dabboba-exchange-copy-before.png` (`1206 × 2622` px).
- Revised native evidence: `/tmp/dabboba-exchange-copy-after.png` (`1206 × 2622` px).
- Focused same-width comparison: `work/qa/exchange-intro-copy-wrap-comparison.png` (`650 × 478` px), with the supplied state above and the corrected state below.
- State and density: Exchange Room root screen on the SDK54 iOS Simulator at native `1206 × 2622` screenshot density. The focused implementation crop was normalized to the supplied image width; judgments are limited to the app-owned card content.

**Findings and iteration history**

- Initial P2: iOS character-based Hangul wrapping left the first syllable of `여러` on the first line and the second syllable on the next line. The split interrupted reading rhythm in a short, fixed callout.
- Fix: the shared text layer now offers balanced explanatory wrapping (`hangul-word` on iOS and `balanced` on Android). This fixed callout also receives one semantic break after the complete first clause, keeping `여러` intact.
- Revised result: the first line ends at the comma and the second line begins with the complete word `여러`; line height and slight tracking adjustment keep the two-line block optically even without changing the card or action geometry.

**Required fidelity surfaces**

- Fonts and typography: Noto Sans KR remains the content face. The description stays at 14 px with a relaxed 22 px line height and `-0.15` tracking; no pixel-display font enters body copy.
- Spacing and layout rhythm: the black card, 16 px internal gutter, callout-to-button gap, button height, and corner radii are unchanged.
- Colors and tokens: the muted description, inverted card surface, and canonical green action remain unchanged.
- Image quality: this callout contains no image asset; surrounding product imagery is unaffected.
- Copy and content: wording is unchanged. Only a semantic line break was added after `올리고,`.

**Interaction and technical evidence**

- The `교환 상품 올리기` action remains in its original location and retains its existing behavior.
- Native TypeScript checking passed after the shared text primitive was added; the structural test fixes the platform wrapping strategy and semantic break to prevent regression.
- Consolidated verification passed: 118 unit tests, protected-runtime integrity, production web build, Expo iOS export, `git diff --check`, Metro health, and the `localhost:3201` Simulator preview.
- The production web build retains its existing non-blocking chunk-size advisory, and the unit run retains its existing non-blocking Node module-type warning for `product-title.ts`; neither warning comes from this copy-layout change.
- Physical-device and signed-store-build verification remain outside this Simulator QA.

final result: passed
## 2026-08-29 — Native checkout preparation flow

- Request: preserve the approved Product Detail confirmation wording and build the screen shown after `OK`.
- Visual sources:
  - approved alert: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_M8sZDZ/스크린샷 2026-08-29 오후 8.42.31.png` (`656×452`)
  - existing web checkout structure: `/tmp/dabboba-legacy-checkout-reference.png` (`1280×720`)
- Native implementation evidence: `/tmp/dabboba-native-checkout-preparation.png` (`1206×2622`)
- Comparison board: `work/qa/native-checkout-preparation-comparison.png` (`2000×1500`)
- Verified state: 도쿄 리벤저스 쿠지, 수량 3개, 결제 예정 금액 29,700원.
- Handoff: the Product Detail alert keeps the approved `뽑기 주문 준비 완료` copy and the single `OK` action opens `/checkout/[productId]` with product ID and quantity.
- Fidelity: the native screen retains the established checkout information order—product, coupon/points, payment method, total—and applies the current Expo SEED-compatible spacing, Noto body copy, pixel titles, off-white background, and DABBOBA green.
- Interaction: payment method and all-points controls are selectable locally; the product and point balance are refreshed from the API on entry.
- Commerce boundary: the screen explicitly states that local PG payment and order creation do not occur. No payment success, order, or draw entitlement is fabricated.
- Automated verification: focused structure test and Expo mobile TypeScript check passed before the full workspace verification.
- Evidence scope: verified in the iOS simulator and local preview only; no physical-device, signed-native, payment-provider, or store-build proof is claimed.
- Final result: passed.

## 2026-08-29 — Exchange Room main rule card

**Evidence**

- Source visual truth: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_yRR1Q2/스크린샷 2026-08-29 오후 8.54.33.png` (`660×202`).
- Rendered implementation: `/tmp/dabboba-exchange-rule-main.png` (`1206×2622`, iOS Simulator screenshot; approximately `402×874` logical points at `3×`).
- Focus crop: implementation pixels `(35,385)–(1171,905)`, resulting in `1136×520`.
- Combined comparison input: `work/qa/exchange-main-rule-card-comparison.png` (`1200×1000`). Both rule-card regions were normalized to the same `1040 px` comparison width; the main-screen action below the copy is an intentional extension of the source card.
- State: Exchange Room root, all categories selected, eight API-backed example listings, signed-in local development session.

**Findings**

- No actionable P0/P1/P2 differences remain. The source card's near-black surface, rounded corners, green `교환 규칙` label, muted readable copy, and exact rule wording are preserved on the Exchange Room main screen.
- Fonts and typography: Noto Sans KR remains the readable face for the rule label and body. The hierarchy is restrained and the two-clause rule remains legible without using the pixel display font for instructional copy.
- Spacing and layout rhythm: the card uses the existing 16 px screen gutter, 16 px internal padding, 16 px radius, and established spacing tokens. The retained 44 px `교환 상품 올리기` action fits inside the card without crowding the rule copy.
- Colors and tokens: the card uses the existing inverted SEED layer, canonical `#91E98E` title/action accent, and muted light body copy.
- Image quality: the rule card contains no image asset or substitute artwork; surrounding product images remain unchanged.
- Copy and content: the main screen now states that only app-purchased products registered in storage can be listed and that displayed amounts are gacha-shop reference prices, not seller-defined prices.

**Interaction and verification**

- The existing `교환 상품 올리기` action remains connected to its original authentication-aware handler.
- The category filters and listing routes remain below the rule card and unchanged.
- Focused structural regression test and Expo mobile TypeScript check passed before consolidated verification.
- Evidence is iOS Simulator/local-preview proof only; physical-device and signed-store-build behavior is not claimed.

final result: passed

## 2026-08-30 — Brand-green native search borders

**Source and rendered evidence**

- Source crop: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_7EIJzH/스크린샷 2026-08-30 오후 1.06.49.png` (`786 × 158` px). The supplied geometry and copy are the layout reference; the explicit requested override is the canonical green border.
- Resting-state implementation: `work/qa/search-border-shop.png` and `work/qa/search-border-exchange.png` (`1206 × 2622` px each).
- Focused-state implementation: `work/qa/search-border-product-search.png` (`1206 × 2622` px).
- Same-input focused comparison: `work/qa/search-border-comparison.png` (`1572 × 158` px), with the supplied crop on the left and the revised native search field on the right.
- Viewport and state: DABBOBA SDK54 iOS Simulator, `402 × 874` logical points at `3×`; 뽀바 and 교환방 are resting, while 전체 검색 is focused.

**Findings and iteration history**

- Initial P2: equivalent native search fields did not share one resting border rule; two used the neutral input border and one owned duplicate search-shell styling.
- Fix: the shared input shell now exposes a search variant. Resting search fields use a 1 px canonical green border, focus increases the same border to 2 px, and validation errors retain the higher-priority critical border.
- Revised result: no actionable P0, P1, or P2 mismatch remains across 뽀바, 교환방, and 전체 검색. The requested green reads consistently without changing the existing field geometry.

**Required fidelity surfaces**

- Fonts and typography: placeholder wording, Noto Sans KR sizing, icon size, and text alignment are unchanged.
- Spacing and layout rhythm: field height, corner radius, internal padding, screen gutter, and adjacent toolbar spacing remain on the shared SEED tokens.
- Colors and tokens: all native search borders derive from `seed.color.stroke.brand` (`#91E98E`); non-search inputs remain neutral and error borders remain critical red.
- Image quality: search fields contain no raster image asset; the existing Ionicons search glyph remains crisp at native density.
- Copy and content: `상품명·작품 검색` and all surrounding product content remain unchanged.

**Interaction and technical evidence**

- Simulator inspection covered the two resting root search fields and the auto-focused full-search screen.
- A structural regression test discovers every native search input by its search return key and requires the shared search variant, state precedence, and critical error override.
- Consolidated verification passed: 141 unit tests, mobile TypeScript checking, protected-runtime integrity, production build, and `git diff --check`.
- Evidence is iOS Simulator/local-preview proof only; physical-device and signed-store-build behavior is not claimed.

final result: passed

## 2026-08-30 — Product Detail floating commerce panel

**Source and rendered evidence**

- Supplied source crop: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_KOWXWb/스크린샷 2026-08-30 오후 1.55.01.png` (`856 × 246` px).
- Initial native implementation: `work/qa/product-detail-floating-action-native.png` (`1206 × 2622` px).
- Scrolled native implementation: `work/qa/product-detail-floating-action-scrolled.png` (`1206 × 2622` px).
- Focus crop: `work/qa/product-detail-floating-action-focus.png` (`1206 × 422` px).
- Same-input comparison: `work/qa/product-detail-floating-action-comparison.png` (`1206 × 844` px); the supplied footer is above and the revised floating panel is below.
- Viewport and state: DABBOBA SDK54 iOS Simulator, `402 × 874` logical points at `3×`; 도쿄 리벤저스 쿠지 Product Detail, quantity 1, total 9,900원, inspected both initially and after scrolling to the final probability card.

**Findings and iteration history**

- Initial P2: the full-width white footer and top divider visually reserved the entire bottom strip, so it did not share the Home navigation's floating-over-content behavior.
- Fix: the quantity, total, and CTA now sit inside one centered rounded panel. Its outer absolute layer is transparent, the warm panel is lightly translucent with a hairline and soft elevation, and the scrolling page remains visible behind it.
- Revised result: no actionable P0, P1, or P2 issue remains. The final content clears the panel at maximum scroll, while the panel stays optically detached from the screen edge.

**Required fidelity surfaces**

- Fonts and typography: existing Noto Sans KR weights, amount hierarchy, and `뽑으러 가기` wording are unchanged.
- Spacing and layout rhythm: the panel uses the established 12 px horizontal screen inset, 8 px internal padding, 22 px corner radius, and real bottom Safe Area; both quantity controls retain at least a 44 px touch width.
- Colors and tokens: the existing canonical green CTA remains unchanged; only the enclosing surface adopts the root navigation's restrained translucent warm layer, neutral hairline, and soft shadow.
- Image quality: no product or icon asset was resized or substituted by this footer change; the content underneath remains rendered at native density.
- Copy and content: quantity, computed total, and category-specific CTA copy remain the same, and no new helper or preview explanation was added.

**Interaction and technical evidence**

- Simulator interaction confirmed that the plus control updates quantity 1 → 2 and total 9,900원 → 19,800원, then the minus control restores the original state.
- A drag through the Product Detail content confirmed that the last probability/status card can scroll completely above the floating panel.
- The existing commerce action handler and category branch remain unchanged, and the Product Detail-to-checkout structural regression continues to pass.
- Consolidated verification passed: 142 unit tests, mobile TypeScript checking, protected-runtime integrity, production build, and `git diff --check`.
- Evidence is iOS Simulator/local-preview proof only; physical-device and signed-store-build behavior is not claimed.

final result: passed

## 2026-08-30 — Shared native frame gutter alignment

**Source and rendered evidence**

- Supplied edge crops: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_VjHmgc/스크린샷 2026-08-30 오후 2.04.32.png` (`42 × 116` px) and `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_8k1M4f/스크린샷 2026-08-30 오후 2.04.38.png` (`32 × 62` px).
- Supplied content-frame reference: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_UaJgD2/스크린샷 2026-08-30 오후 2.05.10.png` (`516 × 278` px).
- Pre-change Product Detail crop: `work/qa/product-detail-floating-action-focus.png` (`1206 × 422` px).
- Revised Product Detail: `work/qa/global-frame-gutter-product-detail.png` (`1206 × 2622` px) and `work/qa/global-frame-gutter-product-detail-edge.png` (`1206 × 422` px).
- Revised root and checkout screens: `work/qa/global-frame-gutter-ppoba.png`, `work/qa/global-frame-gutter-exchange.png`, and `work/qa/global-frame-gutter-checkout.png` (`1206 × 2622` px each).
- Geometry comparison: `work/qa/global-frame-gutter-comparison.png` (`1206 × 844` px); the pre-change Product Detail crop is above and the revised crop is below. Product content differs between states, so the comparison is limited to horizontal geometry.
- Viewport and state: DABBOBA SDK54 iOS Simulator, `402 × 874` logical points at `3×`; Product Detail, 뽀바, 교환방, and 결제 준비 were inspected.

**Findings and iteration history**

- Initial P2: shared content frames were inset 16 px per side while the expanded floating root navigation and Product Detail action panel were inset 12 px, producing a visible 4 px step on each edge.
- Fix: the shared native outer frame gutter is now 12 px. Content frames expand outward to the existing navigation width; the navigation and Product Detail action panel retain their prior width and derive it from the same token.
- Vertical rhythm was preserved by separating prior shorthand spacing into 12 px horizontal and unchanged 16 px vertical values where required.
- Revised result: no actionable P0, P1, or P2 mismatch remains on the inspected screens. Cards, search shells, checkout frames, the expanded root navigation, and the Product Detail action panel now share one straight edge.

**Required fidelity surfaces**

- Fonts and typography: existing Noto Sans KR and pixel-title roles, weights, and line heights are unchanged.
- Spacing and layout rhythm: the app-wide outer horizontal frame is 12 px, while component inner padding, compact navigation geometry, true full-bleed media, and existing vertical spacing remain unchanged.
- Colors and tokens: no color or elevation treatment changed; only the shared horizontal frame token and its consumers were aligned.
- Image quality: product images and icons were not resized or substituted; image aspect-ratio behavior remains unchanged.
- Copy and content: no customer-facing wording, labels, counts, or commerce rules changed.

**Interaction and technical evidence**

- Simulator navigation covered Product Detail, the 뽀바 root, the 교환방 root, and 결제 준비; no clipping, lost touch target, or bottom-panel overlap was observed.
- A structural regression test now requires the shared 12 px frame token and verifies that the expanded root navigation, Product Detail action panel, and both checkout screens consume it.
- Consolidated verification passed: 143 unit tests, mobile TypeScript checking, protected-runtime integrity, production build, and `git diff --check`.
- Evidence is iOS Simulator/local-preview proof only; physical-device and signed-store-build behavior is not claimed.

final result: passed

## 2026-08-30 — App-wide floating route action frame

**Source and rendered evidence**

- Supplied checkout reference: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_uSwQMH/스크린샷 2026-08-30 오후 2.21.34.png` (`886 × 1828` px).
- Normalized reference crop: `work/qa/app-wide-floating-action-reference-crop.png` (`1206 × 2622` px).
- Revised checkout: `work/qa/app-wide-floating-action-checkout.png` and `work/qa/app-wide-floating-action-checkout-scrolled.png` (`1206 × 2622` px each).
- Additional route samples: `work/qa/app-wide-floating-action-kuji.png` and `work/qa/app-wide-floating-action-exchange-create.png` (`1206 × 2622` px each).
- Same-screen comparison: `work/qa/app-wide-floating-action-comparison.png` (`2412 × 2622` px), with the supplied checkout on the left and the revised native checkout on the right.
- Viewport and state: DABBOBA SDK54 iOS Simulator, `402 × 874` logical points at `3×`; checkout was inspected near the supplied scroll position and at the final disclosure, with kuji draw and exchange creation inspected as representative sibling routes.

**Findings and iteration history**

- Initial P2: Product Detail already floated over scrolling content, but six sibling route actions still reserved an opaque full-width footer. Their edges and visual behavior therefore diverged from the shared 12 px frame and floating navigation language.
- Fix: one shared Safe-Area-aware action panel now owns the transparent absolute layer, 12 px outer inset, centered 520 px maximum width, restrained translucent warm surface, hairline, 22 px radius, and soft elevation. Checkout preparation, checkout connection, kuji draw, exchange creation, exchange offer selection, open visitor exchange detail, and Product Detail all consume it.
- Scroll bodies now receive the shared bottom clearance, the exchange-detail clearance remains conditional on the visible visitor action, and loading/error frames use the same outer gutter.
- Revised result: no actionable P0, P1, or P2 mismatch remains on the inspected screens. Route content stays visible behind the panel, the final disclosure clears it at maximum scroll, and the panel shares one straight side edge with the page cards.

**Required fidelity surfaces**

- Fonts and typography: route-specific amount, button, and pixel-title roles remain unchanged; the shared panel adds no text styling of its own.
- Spacing and layout rhythm: every mounted route action uses 12 px outer inset and 8 px internal padding, while each screen retains its existing internal button geometry and vertical content rhythm.
- Colors and tokens: existing canonical green actions and disabled states remain intact; only the enclosing route-action surface is normalized to the shared warm translucent layer, neutral hairline, and shadow.
- Image quality: product and ticket imagery is untouched and continues to render at native density and its existing aspect-ratio rule.
- Copy and content: every route retains its original CTA label and handler. No new helper paragraph, fake transaction result, or preview-only commerce claim was introduced by the shared frame.

**Interaction and technical evidence**

- Native interaction confirmed checkout scrolling with both the payment and amount cards visible behind the panel, complete final-disclosure clearance, and the `결제 준비 완료` alert continuing into `결제 연결 안내`.
- Kuji draw retained its ticket board and five-minute countdown under the floating `쿠지 뽑기` action. Exchange creation retained its empty-inventory state and disabled `상품을 선택해 주세요` action on the same frame.
- The exchange-create panel remains inside `KeyboardAvoidingView`; the current simulator account had no eligible inventory, so a focused form-field keyboard state was not available for direct visual evidence in this pass.
- Structural regression coverage enumerates all seven route-owned fixed actions, requires the shared component and content inset, protects the conditional exchange-detail behavior, and checks loading/error gutters.
- Consolidated verification passed: 145 unit tests, mobile TypeScript checking, protected-runtime integrity, production build, and `git diff --check`.
- Evidence is iOS Simulator/local-preview proof only; physical-device and signed-store-build behavior is not claimed.

final result: passed

## 2026-08-30 — Compact kuji prize row and helper-copy removal

**Source and rendered evidence**

- Supplied remaining-prize defect reference: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_Lkz1Dv/스크린샷 2026-08-30 오후 4.25.09.png` (`800 × 390` px).
- Supplied helper-card defect reference: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_T3fJsI/스크린샷 2026-08-30 오후 4.25.30.png` (`798 × 424` px).
- Revised native implementation: `work/qa/kuji-prize-row-no-helper-copy.png` (`1206 × 2622` px).
- Focused comparison inputs: `work/qa/kuji-prize-row-comparison.png` (`1600 × 390` px) and `work/qa/kuji-helper-copy-removal-comparison.png` (`1596 × 424` px).
- Viewport and state: DABBOBA SDK54 iOS Simulator, `402 × 874` logical points at `3×`; the customer kuji selection screen was inspected at the board bottom where tier inventory and the floating action meet.

**Findings and iteration history**

- Initial P2: the five tier counts occupied a 3+2 wrapped grid, making a simple inventory summary substantially taller than necessary. A `화면 예시` status also competed with the requested information.
- Fix: the title and all five S/A/B/C/D counts now occupy one compact horizontal row. Each count uses an equal flexible segment with one-line grade and quantity text, retaining grouped accessibility labels.
- Initial P2: two large helper cards repeated the already-visible five-minute timer and ten-second notification behavior below the board; the timer itself also repeated its duration in a caption.
- Fix: the helper cards, timer caption, and customer-facing preview bar were removed. The live countdown, ticket selection, expired-entry state, queue return, payment amount confirmation, and open-mode actions remain unchanged.
- Post-fix comparison shows no actionable P0, P1, or P2 mismatch: all five counts fit without truncation at 402 pt width and the explanatory-card area has collapsed completely.

**Required fidelity surfaces**

- Fonts and typography: the `남은 상` label and grades retain the approved Korean pixel family; quantities remain in the readable app font with tabular numerals. No paragraph text was added.
- Spacing and layout rhythm: the summary is reduced to a 60 pt minimum card with a single row, equal tier segments, and the shared 12 pt outer gutter. The removed helper blocks leave direct clearance above the floating action.
- Colors and tokens: the existing warm layer, neutral hairline, brand-weak tier surfaces, green grade labels, and near-black quantities are preserved.
- Image quality: product and ticket imagery are unchanged; this update introduces no new image or icon asset.
- Copy and content: `화면 예시`, `50 TICKETS`, the timer helper sentence, and both long rule paragraphs are absent. Required loading, error, expiry, transaction, and action copy remains contextual.

**Interaction and technical evidence**

- The five-minute state machine and one-second countdown continue running in the simulator; removing the helper copy does not alter lease or queue calculations.
- Structural regression coverage now requires the horizontal tier row and rejects the removed preview bar, timer caption, helper-card styles, and long explanations.
- Consolidated verification passed: mobile TypeScript checking, 17 focused kuji/frame/reveal tests, all 173 unit tests, protected-runtime integrity, production build, and `git diff --check`.
- Evidence is iOS Simulator/local-preview proof only; physical-device and signed-store-build behavior is not claimed.

final result: passed

## 2026-08-30 — Physical mustard kuji marker redesign

**Source and rendered evidence**

- Latest supplied source of truth: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_ziYZPL/스크린샷 2026-08-30 오후 4.58.53.png` (`470 × 814` px). The user's follow-up explicitly limits the reference to each individual kuji marker and preserves the existing five-column, 50-ticket spread.
- Focused source crop: `work/qa/kuji-reference-cells-crop.png` (`1230 × 1260` px), enlarged from the physical board's ivory-and-mustard numbered stock markers.
- Revised native captures: `work/qa/kuji-mustard-ticket-final.png`, `work/qa/kuji-mustard-ticket-selected.png`, `work/qa/kuji-mustard-ticket-sold-disabled.png`, and `work/qa/kuji-mustard-ticket-bottom.png` (`1206 × 2622` px each).
- Same-input full comparison: `work/qa/kuji-mustard-full-comparison.png` (`2412 × 2622` px), with the full physical board reference and the selected native state normalized to equal panel width and height.
- Same-input focused comparison: `work/qa/kuji-mustard-focused-comparison.png` (`2460 × 1260` px), comparing the enlarged source markers with the revised five-column native slots at equal height.
- Viewport and state: DABBOBA SDK54 iOS Simulator, `402 × 874` logical points at `3×`; available, selected, sold/disabled, all 50 positions, the tier row, and the floating action were inspected.

**Findings and iteration history**

- Superseded P1: the immediately prior warm-paper `NO.` ticket with a dashed tear line and bottom stub followed an earlier interpretation, but it did not match the user's newer physical kuji-board reference.
- Fix: the five-column wrapped layout and all 50 positions remain unchanged. Each individual slot now uses a compact ivory face between flat mustard top and bottom bands, minimal 3 px corners, a prominent number, and a small visible `쿠지` state.
- Selected slots replace the mustard bands with canonical green and add both a check and `선택`. Sold slots use a dark face and readable `완료`; neither state relies on color alone.
- The reference's connected horizontal arrangement, prize-grade labels, prize imagery, and slot-to-tier implication were intentionally not copied because the follow-up preserved the existing spread and sealed prize allocation must remain hidden.
- Post-fix full and focused comparisons show no actionable P0, P1, or P2 mismatch for the selected target. The physical ivory/mustard marker language is recognizable while the requested grid density, touch geometry, and independent slot states remain intact.

**Required fidelity surfaces**

- Fonts and typography: slot numbers retain the readable app face with bold tabular numerals; the small state uses the approved Galmuri pixel family. No `NO.` marker or extra helper copy remains.
- Spacing and layout rhythm: the existing five-column wrap, 18.4% slot width, 80 pt minimum height, row gaps, near-black board, 50-slot order, and floating-panel clearance are preserved.
- Colors and tokens: physical marker bands use restrained mustard `#D4B84E`, faces use warm ivory `#F4EDCF`, selected bands use app green `#91E98E`, and sold markers use a high-contrast dark neutral.
- Image quality and asset fidelity: the supplied photograph is used only as the visual reference; existing catalog product imagery remains a real source asset rendered with `contain`. No placeholder raster, handcrafted SVG, or emoji asset was introduced.
- Copy and content: each slot contains only its stable number and contextual `쿠지`, `선택`, or `완료` state. Tier counts remain in the separate one-line panel, and no tutorial, preview legend, grade label, or prize mapping was added to the board.

**Interaction and technical evidence**

- Native interaction selected ticket `02`, changed the visible count from 0 to 1, enabled the floating `쿠지 뽑기` action, and preserved the dark sold states. Scrolling exposed positions `46–50` and the entire one-line S/A/B/C/D remaining-prize row above the floating panel.
- Every slot remains a checkbox with explicit `checked` and `disabled` accessibility state and at least an 80 pt visible height; the source-level regression rejects horizontal strips, carousels, `NO.`, dashed tear lines, and paper stubs.
- Consolidated verification passed: all 174 unit tests, mobile TypeScript checking, protected-runtime integrity, production build, and `git diff --check`.
- Evidence is iOS Simulator/local-preview proof only; physical-device and signed-store-build behavior is not claimed.

final result: passed
