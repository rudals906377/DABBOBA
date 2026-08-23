# DABBOBA Design QA

## Source visuals

- Commerce-flow references:
  - `/tmp/codex-remote-attachments/01a02a5a-2a47-7e01-bae1-7ac794055dd4/42B4ADB9-C03C-404E-AC6A-5F6B8F6676B2/1-사진-1.jpg`
  - `/tmp/codex-remote-attachments/01a02a5a-2a47-7e01-bae1-7ac794055dd4/42B4ADB9-C03C-404E-AC6A-5F6B8F6676B2/2-사진-2.jpg`
  - `/tmp/codex-remote-attachments/01a02a5a-2a47-7e01-bae1-7ac794055dd4/42B4ADB9-C03C-404E-AC6A-5F6B8F6676B2/3-사진-3.jpg`
  - `/tmp/codex-remote-attachments/01a02a5a-2a47-7e01-bae1-7ac794055dd4/42B4ADB9-C03C-404E-AC6A-5F6B8F6676B2/4-사진-4.jpg`
- Green direction: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_3HCUwL/스크린샷 2026-08-23 오전 3.34.34.png`
- Texture reference: `/var/folders/ym/kg6qcm917wv2wdk0qby6y6tw0000gn/T/TemporaryItems/NSIRD_screencaptureui_g8BR79/스크린샷 2026-08-23 오전 3.34.56.png`
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
  - `work/qa/nav-community-iphone.png`
  - `work/qa/nav-shop-iphone.png`
  - `work/qa/nav-duckroom-iphone.png`
  - `work/qa/nav-profile-iphone.png`
  - `work/qa/nav-home-pixel.png`
  - `work/qa/profile-detail-latest-browser.png`
  - `work/qa/purchase-complete-card-latest-browser.png`
  - `work/qa/purchase-complete-card-pixel.png`
  - `work/qa/community-detail-iphone.png`

## Visual review

- The full app uses warm off-white `#F5F5F1`, with `#FCFCF8` surfaces instead of pure white.
- Primary green `#91E98E` is reserved for selection, success, status, and primary actions; it does not flood the interface.
- The supplied retro-game collage appears only as a 9% texture in the catalog banner. It is not reused as layout, illustration, or draw-screen background.
- 8-bit styling is limited to the wordmark, short labels, and arcade status copy. Product and payment content use a restrained contemporary Korean UI hierarchy for adult customers.
- The IP test expansion uses 25 locally frozen official product references with full source-page and source-image provenance. These assets are prototype-only and must be licensed or replaced before commercial release.
- Product photography now uses `object-fit: contain` on quiet light surfaces so packaging, figures, and wide 쿠지 visuals are not cropped. The 4:3 detail hero keeps landscape promotion art readable without pushing all product facts below the first viewport.
- The draw state uses a compact black cabinet on a matching near-black stage, with no visible blend band or checkerboard boundary.
- iPhone and Pixel screens preserve the same structure, readable density, and bottom-safe-area treatment without horizontal clipping.
- The five equal-width bottom tabs follow the requested `커뮤니티 → 샵 → 홈 → 덕룸 → 프로필` order. Active state is expressed with icon fill, green tint, label weight, and `aria-current`, without a raised center button.
- Community remains a restrained text-first feed, Shop reuses the existing product grid, and Duckroom switches to a two-column collection gallery. All three preserve the accepted off-white, thin-line, and sparing lime visual language shown on Home.
- Profile detail follows the same restrained form language with a compact live preview, stable labels, local-only disclosure, and a representative-IP picker. The root navigation is intentionally absent while editing.
- Direct-purchase completion reuses the warm surfaces and lime confirmation accent without arcade imagery. It shows the purchased product, category-specific unit, mock order state, and a clear non-production disclosure.
- Community detail extends the accepted text-first feed into an open article layout rather than a nested card stack. Topic, author, title, body, reactions, example comments, and the local comment composer keep the same off-white, thin-line, and sparing lime system.
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

### Community detail fidelity ledger

- Copy and hierarchy: the selected feed title and body become the detail H1 and full body without renaming or adding an unrelated headline.
- Palette: the rendered detail keeps `#F5F5F1` canvas, `#FCFCF8` composer surface, dark ink, muted secondary text, and lime only for topic/avatar emphasis.
- Container model: the accepted feed's open rows and hairline dividers continue through the article and comments; no nested dashboard-style card stack was introduced.
- Typography: title, body, metadata, reaction labels, and comment text preserve the feed's heavy Korean heading and restrained compact UI type rhythm.
- Icons and controls: the existing monochrome heart, comment, person, chevron, and back treatments are reused at the same optical weight; like and comment targets remain at least 44 px.
- Responsive spacing: iPhone and Pixel captures preserve 16 px gutters, safe-area clearance, readable line lengths, and zero horizontal overflow.
- Intentional extension: comments and a keyboard-aware composer are new because a usable post-detail workflow requires them; they are local fixtures and are disclosed as non-persistent.

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
- Community check: title/body entry, keyboard dismissal, local post submission, count update, and post persistence across root-tab switches all passed.
- Community-detail check: all four seeded posts and a newly authored local post open a pushed `게시글` screen; the root navigation is hidden, back restores the feed, likes and newly written comments remain synchronized with the feed count, and empty-comment state works for new posts.
- Community-detail responsive check: iPhone 393 × 852 and Pixel 10 427 × 952 both report `scrollWidth === clientWidth`; long titles, post body, comment rows, and the composer remain readable without horizontal clipping.
- Shop navigation check: 가챠 8 / 피규어 8 / 쿠지 7 / 카드 2. The 가챠 and 쿠지 routes reach `DABBOBA ARCADE`; the 피규어 and 카드 routes reach `주문 완료` with `개` and `팩` units respectively. The root navigation stays hidden on every commerce subroute and returns with 샵 selected.
- Profile detail check: stable `닉네임` and `한 줄 소개` labels, 2–12 character nickname validation, representative-IP selection, save-and-return behavior, and session persistence across root-tab switches passed. The screen also states that changes reset because no account backend is connected.
- Direct-purchase wording check: active figure and card screens contain no app-draw wording. Card stock, quantity, checkout, and completion consistently use `팩`; figure uses `개`; 가챠 uses `회`; 쿠지 uses `장`.
- iPhone root-screen check: all five pages reported zero horizontal overflow and one 70 px app footer.
- iPhone pushed-screen check: profile detail and card purchase completion both report `scrollWidth === clientWidth` at 393 × 852, with the fixed action area clearing the iOS home indicator.
- Pixel check: profile detail and card purchase completion report `scrollWidth === clientWidth` at 427 × 952, and the purchase footer clears the Android navigation surface.
- Fresh browser reload console check after navigation implementation: zero error and warning entries.
- Capsule animation check: iPhone ready/mix/drop/open/result captures and Pixel open capture passed; both machine bounds remained inside the stage, the result sheet appeared after the full 3.2-second sequence, and the protected device chrome remained intact.
- `npm run check:runtime`: passed, 28 protected runtime files unchanged.
- `npm run build`: passed; only the existing non-blocking Vite chunk-size advisory remains.
- `npm run test:runtime`: 8/8 passed.
- `npm run test:sites`: 4/4 passed.
- `node --test tests/ip-catalog-data.test.mjs`: 3/3 passed, including product count, category distribution, card restriction, IP linkage, and local file checks.
- `node --test tests/navigation-structure.test.mjs`: 3/3 passed, covering order, accessibility state, root-only nav ownership, and commerce footer separation.
- `node --test tests/profile-purchase-structure.test.mjs`: 5/5 passed, covering category-mode mapping, 15 draw / 10 purchase fixtures, profile detail ownership, keyboard-aware fields, checkout branching, and purchase-completion isolation.
- `node --test tests/community-detail-structure.test.mjs`: 3/3 passed, covering comment fixtures for every seed post, footer-free detail ownership, full-post rendering, shared reactions, and keyboard-aware local comments.

final result: passed
