import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { inflateSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const paethPredictor = (left, up, upperLeft) => {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
};

const decodePngPixels = (asset) => {
  const width = asset.readUInt32BE(16);
  const height = asset.readUInt32BE(20);
  const bitDepth = asset[24];
  const colorType = asset[25];
  const interlace = asset[28];
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  assert.equal(bitDepth, 8);
  assert.notEqual(channels, 0);
  assert.equal(interlace, 0);

  const idatChunks = [];
  let chunkOffset = 8;
  while (chunkOffset < asset.length) {
    const chunkLength = asset.readUInt32BE(chunkOffset);
    const chunkType = asset.toString("ascii", chunkOffset + 4, chunkOffset + 8);
    if (chunkType === "IDAT") {
      idatChunks.push(asset.subarray(chunkOffset + 8, chunkOffset + 8 + chunkLength));
    }
    chunkOffset += chunkLength + 12;
  }

  const compressedRows = inflateSync(Buffer.concat(idatChunks));
  const rowStride = width * channels;
  const pixels = Buffer.alloc(rowStride * height);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = compressedRows[sourceOffset];
    sourceOffset += 1;
    const rowOffset = y * rowStride;
    for (let x = 0; x < rowStride; x += 1) {
      const raw = compressedRows[sourceOffset];
      sourceOffset += 1;
      const left = x >= channels ? pixels[rowOffset + x - channels] : 0;
      const up = y > 0 ? pixels[rowOffset - rowStride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[rowOffset - rowStride + x - channels] : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : filter === 4
                  ? paethPredictor(left, up, upperLeft)
                  : Number.NaN;
      assert.ok(Number.isFinite(predictor), `Unsupported PNG filter ${filter}`);
      pixels[rowOffset + x] = (raw + predictor) & 0xff;
    }
  }

  return { width, height, channels, pixels };
};

test("gacha and kuji share footer-free native product-open routes", () => {
  const revealRoute = read("apps/mobile/app/draw/reveal/[entitlementId].tsx");
  const previewRoute = read("apps/mobile/app/draw/preview/[productId].tsx");

  assert.match(revealRoute, /DrawRevealScreen/);
  assert.match(previewRoute, /DrawRevealScreen preview/);
  assert.doesNotMatch(`${revealRoute}\n${previewRoute}`, /RootFloatingTabBar/);
  assert.match(previewRoute, /if \(!__DEV__\) return <Redirect href="\/\(tabs\)\/ppoba" \/>/);
});

test("a real product reveal consumes only the explicitly opened server entitlement", () => {
  const api = read("apps/mobile/src/features/draw/draw-reveal-api.ts");
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  const state = read("apps/mobile/src/features/draw/draw-reveal-state.ts");

  assert.match(api, /POST\("\/v1\/draws\/\{entitlementId\}\/consume"/);
  assert.match(api, /token:\s*\(\)\s*=>\s*accessToken/);
  assert.match(api, /draw-reveal-\$\{entitlementId\}/);
  assert.match(screen, /onPress=\{handleAction\}/);
  assert.match(screen, /void openProduct\(\)/);
  assert.match(screen, /await consumeDrawEntitlement/);
  const mountEffect = screen.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[loadPreview\]\);/)?.[1] ?? "";
  assert.doesNotMatch(mountEffect, /consumeDrawEntitlement/);
  assert.match(state, /createKujiOpenMotionState/);
  assert.match(state, /transitionKujiOpenMotion/);
  // SQLite retains only purchase recovery identity; prizes/inventory stay server-owned.
  assert.doesNotMatch(screen, /Math\.random|recordInventoryUnit|INSERT INTO inventory|UPDATE inventory/);
});

test("a paid multi-kuji route reveals server entitlements one at a time and keeps the active entitlement in the URL", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  const sequence = read("apps/mobile/src/features/draw/draw-reveal-sequence.ts");

  assert.match(screen, /resolveCommittedDrawSequence/);
  assert.match(screen, /firstParam\(params\.entitlementIds\)/);
  assert.match(screen, /Math\.max\(1, committedSequence\.total\)/);
  assert.match(screen, /assertCommittedDrawResultMatchesRoute\(committed/);
  assert.match(screen, /committedSequence\.nextEntitlementId/);
  assert.match(screen, /prepareNextCommittedResult/);
  assert.match(screen, /router\.setParams\(\{ entitlementId: nextEntitlementId \}\)/);
  assert.match(screen, /setResult\(null\)[\s\S]*?setRevealResetSignal/);
  assert.match(screen, /accessibilityLabel="다음 가챠 캡슐 준비하기"/);
  assert.match(screen, />NEXT<\/Text>/);
  assert.doesNotMatch(screen, /Promise\.all\([\s\S]*?consumeDrawEntitlement/);
  assert.match(sequence, /pathId[\s\S]*?parsedIds\.findIndex/);
  assert.match(sequence, /nextEntitlementId: entitlementIds\[safeActiveIndex \+ 1\] \?\? null/);
});

test("preview sequencing stays bounded and never invents a prize", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  const kuji = read("apps/mobile/src/features/kuji/KujiDrawScreen.tsx");

  assert.match(screen, /preview && firstParam\(params\.mode\) === "all"/);
  assert.match(screen, /previewTickets\.length \|\| boundedCount\(firstParam\(params\.count\)\)/);
  assert.match(screen, /advancePreviewRevealState/);
  assert.match(screen, /completePreviewRevealState/);
  assert.match(screen, /Math\.min\(Math\.trunc\(parsed\), 50\)/);
  assert.match(screen, /RESULT \{String\(openedIndex\)\.padStart\(2, "0"\)\}/);
  assert.match(screen, /FlatList/);
  assert.match(screen, /summaryRail/);
  assert.doesNotMatch(screen, /가상 당첨|예시 당첨|획득 완료/);
  assert.match(kuji, /bindPaidKujiSlots/);
  assert.match(kuji, /paidKujiRevealPath/);
  assert.match(screen, /parseKujiTicketNumbers\(firstParam\(params\.tickets\)\)/);
  assert.match(screen, /KUJI \{featured\.ticketNumber\}/);
});

test("multi-gacha summaries keep gacha semantics and hide kuji ticket labels", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");

  assert.match(screen, /<PreviewResultSummary[\s\S]*?sourceCategory=\{sourceCategory\}/);
  assert.match(screen, /const isKuji = sourceCategory === "kuji"/);
  assert.match(screen, /sourceCategory === "gacha" \? "가챠"/);
  assert.match(screen, /isKuji && featured\.ticketNumber \? \(/);
  assert.match(screen, /isKuji && item\.ticketNumber \? \(/);
  assert.match(screen, /가챠 \$\{previewState\.openedCount\}번째 결과가 열렸어요/);
});

test("kuji selection enters reveal without an open-mode picker and reveal owns both actions", () => {
  const kuji = read("apps/mobile/src/features/kuji/KujiDrawScreen.tsx");
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");

  assert.match(kuji, /validateKujiSlotBinding/);
  assert.match(kuji, /selectedTickets\.length !== purchasedCount/);
  assert.match(kuji, /onPress=\{\(\) => void openSelectedTickets\(\)\}/);
  assert.doesNotMatch(kuji, /결제 금액 확인|buildKujiPaymentConfirmation/);
  assert.doesNotMatch(kuji, /오픈 방식 선택|chooseOpenMode|confirmOpenMode/);
  assert.match(screen, /buildPreviewOpenActions\(previewState\)/);
  assert.match(screen, /openAllLabel/);
  assert.match(screen, /onPress=\{handleOpenNextTicket\}/);
  assert.match(screen, /onPress=\{handleOpenAllRemaining\}/);
  assert.doesNotMatch(screen, /다음 쿠지 준비/);
});

test("each sequential kuji returns to a sealed ticket that can be dragged before opening", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  const ticket = read("apps/mobile/src/features/draw/KujiPeelTicket.tsx");

  assert.match(screen, /resolvePreviewNextTicketAction\(previewState\)/);
  assert.match(screen, /nextAction === "prepare"[\s\S]*?advancePreviewRevealState\(current\)[\s\S]*?return;/);
  assert.match(screen, /nextAction === "open"[\s\S]*?setRevealRequestSignal/);
  assert.doesNotMatch(screen, /setQueuedPreviewOpen\("single"\)/);
  assert.match(screen, /setQueuedPreviewOpen\("all"\)/);
  assert.match(ticket, /Gesture\.Pan\(\)[\s\S]*?resolveKujiPeelRelease/);
  assert.match(ticket, /phase === "sealed"/);
});

test("kuji retains its ticket surface and pre-mounted committed result through the settled handoff", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  const start = screen.indexOf("<KujiPeelTicket");
  const end = screen.indexOf(') : sourceCategory === "gacha"', start);
  assert.ok(start >= 0 && end > start);
  const ticket = screen.slice(start, end);
  assert.match(screen, /sourceCategory === "kuji" \? \(\s*<KujiPeelTicket/);
  assert.doesNotMatch(screen, /kujiMotionVisible \? \(\s*<KujiPeelTicket/,
    "completion must not unmount the ticket/result surface and replay another entrance");
  assert.match(ticket, /settled=\{completed\}/);
  assert.match(ticket, /disabled=\{opening \|\| completed\}/);
  assert.match(ticket, /resultReady=\{preview \? previewResultReady : Boolean\(result\)\}/);
  assert.match(ticket, /onRequestOpen=\{\(\) => void openProduct\(\)\}/);
  assert.match(ticket, /onRevealSettled=\{handleRevealSettled\}/);
  assert.match(ticket, /resultContent=\{result \? \(\s*<CommittedResult[\s\S]*?result=\{result\}[\s\S]*?imageUri=\{resolveCatalogImageUrl\(result.prizeImageUrl, runtime.assetBaseUrl\)\}/);
  assert.match(ticket, /<CommittedResult[\s\S]*?\sreduceMotion\s*\/>/,
    "the ticket's shared progress owns appearance, not a second autonomous result animation");
  assert.match(ticket, /<PreviewResultStage[\s\S]*?\sopened\s[\s\S]*?\sreduceMotion\s*\/>/);
  assert.doesNotMatch(ticket, /snapshot\.product\.imageUrl|Math\.random|selectHighestRankedResultId/,
    "the hidden real card may only consume the immutable prize snapshot, not catalog art or a client draw");
  assert.match(ticket, /key=\{preview[\s\S]*?previewItems\[currentPreviewIndex\]\?\.ticketNumber[\s\S]*?: entitlementId \|\| productId\}/);
  assert.match(ticket, /requestSignal=\{revealRequestSignal\}/);
  assert.match(ticket, /resetSignal=\{revealResetSignal\}/);

  const ordinal = ticket.match(/openedIndex=\{([^}]+)\}/)?.[1];
  assert.ok(ordinal);
  for (const order of [1, 2, 7, 50]) {
    const evaluate = (openedCount, previewOpened) => runInNewContext(`(${ordinal})`, {
      previewState: { openedCount }, previewOpened,
    });
    assert.equal(evaluate(order - 1, false), order);
    assert.equal(evaluate(order, true), order,
      "the result's number must not jump when the completion callback increments openedCount");
  }
});

test("premium kuji presentation does not expand preview batch mode into a production consume loop", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  assert.match(screen, /requestedMode: RevealMode = preview && firstParam\(params.mode\) === "all" \? "all" : "single"/);
  const batch = screen.slice(screen.indexOf("const handleOpenAllRemaining ="), screen.indexOf("const handleAction ="));
  assert.match(batch, /if \(\s*!preview\s*\|\| sourceCategory !== "kuji"/);
  assert.match(batch, /startPreviewOpenAll\(current\)/);
  assert.match(batch, /setRevealResetSignal/);
  assert.match(batch, /setQueuedPreviewOpen\("all"\)/);
  assert.doesNotMatch(batch, /consumeDrawEntitlement|Promise\.all|fetch\(/);
  assert.match(screen, /total=\{preview && activeMode === "all" \? remainingPreviewCount : undefined\}/);
  const prepare = screen.slice(screen.indexOf("const prepareNextCommittedResult ="), screen.indexOf("const handleGachaSkip ="));
  assert.match(prepare, /if \(preview \|\| !result \|\| !revealSettled \|\| !nextEntitlementId\) return/);
  assert.match(prepare, /setResult\(null\)/);
  assert.match(prepare, /setRevealResetSignal/);
  assert.match(prepare, /router.setParams\(\{ entitlementId: nextEntitlementId \}\)/);
  assert.doesNotMatch(prepare, /consumeDrawEntitlement|openProduct\(|setRevealRequestSignal/,
    "preparing the next sealed ticket must never immediately consume it");
});

test("kuji parent settlement keeps a completed preview visible after clearing its temporary result-ready flag", async () => {
  const state = await import("../apps/mobile/src/features/draw/draw-reveal-state.ts");
  const motion = await import("../apps/mobile/src/features/draw/kuji-ticket-reveal-motion.ts");
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  const ticket = read("apps/mobile/src/features/draw/KujiPeelTicket.tsx");
  const settlement = screen.slice(screen.indexOf("const handleRevealSettled ="), screen.indexOf("const prepareNextCommittedResult ="));
  const completedExpression = screen.match(/const completed = ([^;]+);/)?.[1];
  assert.ok(completedExpression);
  assert.match(ticket, /isKujiResultGateOpen\(phase, resultReady, settled\)/);
  assert.match(ticket, /resultAccessible = resultGateOpen && settled/);

  // Execute the actual parent callback, not a replacement completion reducer.
  // A preview clears resultReady at the exact moment it marks the ticket settled.
  for (const mode of ["single", "all"]) {
    for (const count of [1, 3, 8]) {
      let previewState = state.createPreviewRevealState(mode, count);
      let previewResultReady = true;
      let revealSettled = false;
      const context = {
        ...state,
        preview: true,
        result: null,
        requestInFlightRef: { current: true },
        skipRequestedRef: { current: false },
        setPreviewResultReady: (value) => { previewResultReady = value; },
        setPreviewState: (update) => { previewState = update(previewState); },
        setRevealSettled: (value) => { revealSettled = value; },
      };
      runInNewContext(`${settlement}\nglobalThis.finish = handleRevealSettled;`, context);
      context.finish();
      context.finish();
      assert.equal(previewResultReady, false);
      assert.equal(revealSettled, false, "preview completion must not invent a committed server result");
      assert.equal(previewState.openedCount, mode === "all" ? count : 1,
        "a duplicate settlement must not advance another sealed ticket");
      const completed = runInNewContext(completedExpression, {
        committedResultPresented: false,
        previewOpened: previewState.phase === "revealed",
        previewCompleted: previewState.phase === "summary",
      });
      assert.equal(completed, true);
      const gate = motion.isKujiResultGateOpen("revealed", previewResultReady, completed);
      for (const reduceMotion of [false, true]) {
        const frame = motion.sampleKujiTicketRevealMotion(1, gate, reduceMotion);
        assert.equal(frame.resultOpacity, 1, "the finished preview must not disappear on its parent's rerender");
        assert.equal(frame.ticketOpacity, 0);
        assert.equal(frame.glowOpacity, 0, "completion must not restart the payoff glow");
      }
      if (mode === "single" && count > 1) {
        previewState = state.advancePreviewRevealState(previewState);
        assert.equal(previewState.phase, "sealed");
        const nextCompleted = runInNewContext(completedExpression, {
          committedResultPresented: false,
          previewOpened: false,
          previewCompleted: false,
        });
        assert.equal(nextCompleted, false);
        const nextGate = motion.isKujiResultGateOpen("sealed", false, nextCompleted);
        assert.equal(motion.sampleKujiTicketRevealMotion(1, nextGate).resultOpacity, 0,
          "a stale finished motion value cannot expose the next sealed result");
      }
    }
  }
});

test("the sequential kuji result footer distinguishes selecting from opening and stays visually flat", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  const state = read("apps/mobile/src/features/draw/draw-reveal-state.ts");

  assert.match(state, /state\.phase === "revealed"\s*\?\s*`\$\{nextPosition\}번째 쿠지 선택`\s*:\s*`\$\{nextPosition\}번째 쿠지 열기`/);
  assert.match(screen, /const showSplitOpenActions =/);
  assert.match(screen, /const footerPanelStyle = showSplitOpenActions[\s\S]*?styles\.footerSplitPanel/);
  assert.match(screen, /panelStyle=\{footerPanelStyle\}/);
  assert.match(screen, /variant="neutralWeak"/);
  assert.match(screen, /styles\.footerOpenAllAction/);
  assert.match(screen, /footerSplitPanel:[\s\S]*?backgroundColor:\s*seed\.color\.background\.transparent/);
  assert.match(screen, /footerOpenAllAction:[\s\S]*?backgroundColor:\s*seed\.color\.layer\.elevated/);
});

test("a one-item kuji purchase stops on its single product result", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");

  assert.match(screen, /const mode: RevealMode = count === 1 \? "single" : requestedMode/);
  assert.match(screen, /const singlePreviewFinished = preview && count === 1/);
  assert.match(screen, /drawSequenceFinished\s*\?\s*"상품으로 돌아가기"/);
  assert.match(screen, /if \(drawSequenceFinished\) \{\s*returnToSourceProduct\(\);\s*return;\s*\}/);
  assert.match(screen, /if \(items\.length === 1\) \{[\s\S]*?<PreviewResultStage/);
});

test("finished gacha and kuji reveals return to their source product detail", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  const agentGuide = read("AGENTS.md");

  assert.match(screen, /const sourceProductId = result\?\.productId \?\? snapshot\?\.product\.id \?\? productId/);
  assert.match(screen, /const returnToSourceProduct = async \(\) => \{[\s\S]*?router\.dismissTo\(\s*`\/product\/\$\{encodeURIComponent\(sourceProductId\)\}` as Href/);
  assert.match(screen, /const committedSequenceFinished = committedResultPresented[\s\S]*?committedSequence\.nextEntitlementId === null/);
  assert.match(screen, /const drawSequenceFinished = committedSequenceFinished \|\| previewCompleted \|\| singlePreviewFinished/);
  assert.match(screen, /onPress=\{drawSequenceFinished \? returnToSourceProduct : goBack\}/);
  assert.doesNotMatch(screen, /router\.replace\("\/\(tabs\)\/dukroom"\)/);
  assert.match(agentGuide, /completed gacha or kuji reveal sequence[\s\S]*source catalog product detail/);
});

test("the kuji presentation delegates release timing and one-shot settlement to the motion state machine", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  const kujiTicket = read("apps/mobile/src/features/draw/KujiPeelTicket.tsx");

  assert.match(kujiTicket, /createKujiOpenMotionState/);
  assert.match(kujiTicket, /transitionKujiOpenMotion/);
  assert.match(kujiTicket, /type:\s*"request"/);
  assert.match(kujiTicket, /type:\s*"travel-settled"/);
  assert.match(kujiTicket, /type:\s*"result-ready"/);
  assert.match(kujiTicket, /type:\s*"impact-settled"/);
  assert.match(kujiTicket, /type:\s*"reduce-motion"/);
  assert.match(kujiTicket, /resultReady/);
  assert.match(screen, /resultReady=\{/);
  assert.match(screen, /on(?:Reveal)?Settled=\{/);
  assert.doesNotMatch(kujiTicket, /Math\.random|SQLite|recordInventoryUnit/);
});

test("native draw motion keeps gesture frames on the UI thread and reveals complete result groups smoothly", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  const kujiTicket = read("apps/mobile/src/features/draw/KujiPeelTicket.tsx");
  const panStart = kujiTicket.indexOf("const pan = Gesture.Pan()");
  const panEnd = kujiTicket.indexOf("const tap = Gesture.Tap()", panStart);
  const panSource = kujiTicket.slice(panStart, panEnd);

  assert.ok(panStart >= 0 && panEnd > panStart);
  assert.doesNotMatch(panSource, /\.runOnJS\(true\)/);
  assert.match(panSource, /dragProgress\.value = resolveKujiDragProgress/);
  assert.match(panSource, /scheduleOnRN\(beginOpen\)/);
  assert.doesNotMatch(panSource, /setPhase|dispatchRef|setState/);
  assert.match(kujiTicket, /cancelAnimation\(dragProgress\)[\s\S]*?cancelAnimation\(impactProgress\)[\s\S]*?cancelAnimation\(cuePulse\)/);
  assert.match(screen, /function SmoothResultReveal/);
  assert.match(screen, /function SmoothResultImage/);
  assert.match(screen, /void Image\.prefetch\(committedImageUri\)/);
  assert.match(screen, /<SmoothResultReveal[\s\S]*?<ResultAura/);
  assert.match(screen, /translateY:[\s\S]*?scale:/);
});

test("the native gacha machine offers one clockwise turn or six taps with matching visible and accessible instructions", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  const machine = read("apps/mobile/src/features/draw/GachaLeverMachine.tsx");
  const motion = read("apps/mobile/src/features/draw/gacha-lever-motion.ts");
  const agentGuide = read("AGENTS.md");

  assert.match(screen, /<GachaLeverMachine/);
  assert.match(screen, /sourceCategory === "gacha"/);
  assert.doesNotMatch(screen, /sourceCategory === "gacha"\s*\?\s*"레버 돌리기"/);
  assert.doesNotMatch(screen, /레버 두 바퀴 돌리기/);
  assert.match(
    screen,
    /sourceCategory !== "gacha" \? \([\s\S]*?<FloatingBottomActionPanel/,
  );
  assert.doesNotMatch(screen, /footerGachaPanel/);
  assert.match(screen, /sourceCategory === "gacha" && styles\.gachaContent/);
  assert.match(screen, /sourceCategory === "gacha" && styles\.fullGachaStage/);
  assert.match(screen, /const gachaBottomInset = safeAreaInsets\.bottom \+ seed\.spacing\.x4/);
  assert.match(screen, /snapshot && sourceCategory !== "gacha"/);
  assert.match(
    screen,
    /opacity: gachaMotionVisible && !gachaRevealInProgress \? 1 : 0[\s\S]*?<SeedInlineGuidance[\s\S]*?레버 6회 연속 터치 또는 시계 방향 1바퀴 드래그[\s\S]*?<\/SeedInlineGuidance>/,
  );
  assert.match(screen, /resultReady=\{preview \? previewResultReady : Boolean\(result\)\}/);
  assert.match(screen, /onRequestOpen=\{\(\) => void openProduct\(\)\}/);
  assert.match(screen, /onRevealSettled=\{handleRevealSettled\}/);
  assert.match(screen, /sourceCategory === "kuji" && ticketNumber/);
  assert.match(machine, /Gesture\.Pan\(\)/);
  assert.match(machine, /capsule-machine-front-empty\.png/);
  assert.doesNotMatch(machine, /MACHINE_PRESENTATION_SCALE/);
  assert.match(machine, /MACHINE_SLOT_HEIGHT = 390/);
  assert.match(machine, /style=\{styles\.machineSlot\}/);
  assert.match(machine, /scale: camera\.presentationScale \* camera\.scale/);
  assert.match(machine, /resolveGachaLeverTouchStart\(/);
  assert.match(machine, /resolveGachaLeverPointAngle\(event\.x, event\.y/);
  assert.match(machine, /advanceGachaLeverRadians/);
  assert.match(machine, /advanceGachaLeverTapRadians/);
  assert.match(machine, /gestureTravel\.value <= GESTURE_TAP_SLOP/);
  assert.match(machine, /const gestureAccepted = useSharedValue\(0\)/);
  assert.match(
    machine,
    /gestureAccepted\.value = 0;[\s\S]*?if \(!start\.accepted\) \{[\s\S]*?manager\.fail\(\)[\s\S]*?gestureAccepted\.value = 1/,
  );
  assert.match(machine, /\.onFinalize\(\(_event, success\) => \{[\s\S]*?if \(gestureEnded\.value\) return/);
  assert.match(machine, /if \(success && gestureTravel\.value <= GESTURE_TAP_SLOP\)/);
  assert.match(machine, /scheduleOnRN\(beginOpen, run\)/);
  assert.doesNotMatch(machine, /scheduleOnRN\(updateProgress/);
  assert.match(machine, /manualActivation\(true\)/);
  assert.match(machine, /withTiming\(gestureStartRadians\.value, \{ duration: 220/);
  assert.match(machine, /withTiming\(GACHA_LEVER_TARGET_RADIANS/);
  assert.match(machine, /transitionGachaLeverMotion/);
  assert.match(machine, /onAccessibilityTap=\{autoCompleteLever\}/);
  assert.match(
    machine,
    /accessibilityHint="레버를 6회 연속 터치하거나 둘레를 시계 방향으로 한 바퀴 드래그합니다"/,
  );
  assert.doesNotMatch(machine, /Math\.random|runOnJS/);
  assert.match(motion, /GACHA_LEVER_REQUIRED_TURNS = 1/);
  assert.match(motion, /GACHA_LEVER_REQUIRED_TAPS = 6/);
  assert.match(motion, /Math\.atan2\(Math\.sin\(delta\), Math\.cos\(delta\)\)/);
  assert.match(agentGuide, /one clockwise circle[\s\S]*?gacha lever/);
  assert.doesNotMatch(`${screen}\n${machine}`, /레버 8회|레버를 8회|시계 방향 2바퀴|시계 방향으로 두 바퀴/);
});

test("gacha skip is a top-right action that reveals only the server-consumed result", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");

  assert.match(screen, /accessibilityLabel="가챠 애니메이션 건너뛰기"/);
  assert.match(screen, />SKIP<\/Text>/);
  assert.match(screen, /const handleGachaSkip = \(\) => \{/);
  assert.match(screen, /skipRequestedRef\.current = true/);
  assert.match(screen, /await consumeDrawEntitlement\(/);
  assert.match(
    screen,
    /committedCategory === "gacha" && skipRequestedRef\.current[\s\S]*?setRevealSettled\(true\)/,
  );
  assert.doesNotMatch(screen, /const handleGachaSkip[\s\S]*?Math\.random/);
});

test("gacha hands off the validated server prize through light before the final completion state", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  const machine = read("apps/mobile/src/features/draw/GachaLeverMachine.tsx");

  assert.match(machine, /testID="gacha-capsule-cinematic"/);
  assert.match(machine, /styles\.capsuleLightWash/);
  assert.match(machine, /<GachaPrizeReveal/);
  assert.match(machine, /settled=\{settled\}/);
  assert.doesNotMatch(machine, /entryProgress|entryStyle/);
  assert.match(machine, /motionStateRef.current = \{ \.\.\.motionStateRef.current, phase: "revealed" \}/);
  assert.match(
    machine,
    /revealProgress\.value = withDelay\([\s\S]*?scheduleOnRN\(handleRevealSettled/,
  );
  assert.match(screen, /const committedResultPresented = Boolean\(result && revealSettled\)/);
  assert.match(screen, /committedResultPresented[\s\S]*?<CommittedResult/);
  assert.match(screen, /result=\{result\}/);
  assert.match(screen, /result\.prizeName/);
  assert.match(screen, /result\.prizeImageUrl/);
  assert.match(screen, /result\.rarity/);
  assert.doesNotMatch(screen, /Math\.random/);
});

test("gacha and kuji share the same measured thirty-six-ember field and one clock", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");
  const fireflyMotion = read("apps/mobile/src/features/draw/kuji-firefly-motion.ts");

  assert.match(screen, /const isDrawCategory = sourceCategory === "kuji" \|\| sourceCategory === "gacha"/);
  assert.match(screen, /const showStageHeader = !isDrawCategory/);
  assert.match(screen, /showStageHeader \? \([\s\S]*?styles\.stageHeader/);
  assert.match(screen, /previewCompleted \? \([\s\S]*?styles\.summaryContent[\s\S]*?styles\.stageHeader/);
  assert.match(
    screen,
    /styles\.stage,[\s\S]*?isDrawCategory && styles\.expandedDrawStage,[\s\S]*?sourceCategory === "gacha" && styles\.fullGachaStage/,
  );
  assert.match(screen, /expandedDrawStage: \{ minHeight: 496 \}/);
  assert.match(screen, /<StageAmbient[\s\S]*?sourceCategory=\{sourceCategory\}[\s\S]*?reduceMotion=\{reduceMotion\}/);
  assert.match(screen, /sourceCategory === "kuji" \|\| sourceCategory === "gacha"/);
  assert.match(screen, /return <DrawEmbers seed=\{seed\} reduceMotion=\{reduceMotion\} \/>/);
  assert.match(screen, /createGachaFireflyConfigs\(seed, stageSize\)/);
  assert.match(fireflyMotion, /export const GACHA_FIREFLY_COUNT = 36/);
  assert.match(screen, /function DrawEmberLoop[\s\S]*?useEmberPhase\(GACHA_FIREFLY_DURATION_MS\)/);
  assert.doesNotMatch(screen, /KujiEmberLoop|createKujiFireflyConfigs/);
  assert.match(screen, /function DrawEmbers[\s\S]*?if \(reduceMotion\) return null;/);
  assert.match(screen, /withRepeat\([\s\S]*?withTiming\(1[\s\S]*?-1,/);
  assert.match(screen, /sampleKujiFireflyMotion\(particle, localProgress\)/);
  assert.match(screen, /return \(\) => cancelAnimation\(phase\)/);
  assert.doesNotMatch(screen, /setTimeout\(|setInterval\(/);
  assert.doesNotMatch(screen, /Math\.random/);
  assert.match(fireflyMotion, /export const KUJI_FIREFLY_COUNT = 12/);
  assert.match(fireflyMotion, /laneIndex/);
  assert.match(fireflyMotion, /startOffset/);
  assert.match(fireflyMotion, /Math\.sin\(curvedProgress \* Math\.PI\)[\s\S]*?curveAmplitude/);
  assert.match(fireflyMotion, /const translateY = -boundedProgress \* particle\.riseDistance/);
  assert.match(fireflyMotion, /createSeededUnitInterval/);
});

test("the sealed kuji ticket moves its built-in orange direction arrow without a green circular cue", () => {
  const kujiTicket = read("apps/mobile/src/features/draw/KujiPeelTicket.tsx");

  assert.doesNotMatch(kujiTicket, /styles\.pullCue/);
  assert.doesNotMatch(kujiTicket, /styles\.pullCueText/);
  assert.match(kujiTicket, /styles\.pullArrowWindow/);
  assert.doesNotMatch(kujiTicket, /styles\.pullArrowImage/);
  const pullArrowWindow = kujiTicket.match(/pullArrowWindow: \{([\s\S]*?)\n  \},\n  pullArrowMotion/)?.[1] ?? "";
  assert.doesNotMatch(pullArrowWindow, /backgroundColor|overflow/);
  assert.match(kujiTicket, /styles\.pullArrowEraserShaft/);
  assert.match(kujiTicket, /styles\.pullArrowEraserHead/);
  assert.match(kujiTicket, /styles\.pullArrowShaftOutline/);
  assert.match(kujiTicket, /styles\.pullArrowHeadOutline/);
  assert.match(kujiTicket, /styles\.pullArrowShaftFill/);
  assert.match(kujiTicket, /styles\.pullArrowHeadFill/);
  assert.match(kujiTicket, /pullArrowShaftOutline: \{[\s\S]*?top: 14,[\s\S]*?height: 12,/);
  assert.match(kujiTicket, /pullArrowHeadOutline: \{[\s\S]*?borderTopWidth: 12,/);
  assert.match(kujiTicket, /pullArrowShaftFill: \{[\s\S]*?top: 15,[\s\S]*?height: 10,/);
  assert.match(kujiTicket, /pullArrowHeadFill: \{[\s\S]*?top: 10,[\s\S]*?borderTopWidth: 10,/);
  assert.match(kujiTicket, /translateX: interpolate\(cuePulse\.value, \[0, 1\], \[0, 5\]\)/);
  assert.match(kujiTicket, /if \(reduceMotion \|\| phase !== "sealed"\)/);
});

test("the sealed kuji ticket uses ten smaller left-edge perforation marks", () => {
  const kujiTicket = read("apps/mobile/src/features/draw/KujiPeelTicket.tsx");

  assert.match(kujiTicket, /Array\.from\(\{ length: 10 \}/);
  assert.match(kujiTicket, /tearTooth: \{[\s\S]*?width: 9,[\s\S]*?height: 9,/);
  assert.match(kujiTicket, /tearTooth: \{[\s\S]*?transform: \[\{ rotate: "45deg" \}\]/);
});

test("the sealed kuji reveal keeps its outer background still while the complete inner ticket layer peels", () => {
  const kujiTicket = read("apps/mobile/src/features/draw/KujiPeelTicket.tsx");
  const agentGuide = read("AGENTS.md");
  const frontAsset = readFileSync(path.join(root, "apps/mobile/assets/kuji-ticket-front.png"));
  const outerAsset = readFileSync(path.join(root, "apps/mobile/assets/kuji-ticket-outer-layer.png"));
  const peelAsset = readFileSync(path.join(root, "apps/mobile/assets/kuji-ticket-peel-layer.png"));
  const pngHeader = (asset) => ({
    width: asset.readUInt32BE(16),
    height: asset.readUInt32BE(20),
    colorType: asset[25],
  });

  assert.deepEqual(pngHeader(outerAsset), { width: 1517, height: 1037, colorType: 6 });
  assert.deepEqual(pngHeader(peelAsset), { width: 1517, height: 1037, colorType: 6 });
  assert.match(kujiTicket, /KUJI_TICKET_OUTER_LAYER = require\("\.\.\/\.\.\/\.\.\/assets\/kuji-ticket-outer-layer\.png"\)/);
  assert.match(kujiTicket, /KUJI_TICKET_PEEL_LAYER = require\("\.\.\/\.\.\/\.\.\/assets\/kuji-ticket-peel-layer\.png"\)/);
  assert.match(kujiTicket, /<View pointerEvents="none" style=\{styles\.ticketOuterLayer\}>[\s\S]*?source=\{KUJI_TICKET_OUTER_LAYER\}[\s\S]*?styles\.tearEdge/);
  assert.match(kujiTicket, /<Animated\.View style=\{\[styles\.ticketPeelLayer, peelLayerStyle\]\}>[\s\S]*?source=\{KUJI_TICKET_PEEL_LAYER\}[\s\S]*?styles\.ticketCopy[\s\S]*?styles\.pullArrowWindow/);
  assert.doesNotMatch(kujiTicket, /ticketOuterLayer, peelLayerStyle/);
  assert.match(agentGuide, /two-layer reveal composition[\s\S]*?outer orange background[\s\S]*?moving inner peel layer/);

  const front = decodePngPixels(frontAsset);
  const outer = decodePngPixels(outerAsset);
  const peel = decodePngPixels(peelAsset);
  let alphaComplementMismatches = 0;
  let sourceRgbMismatches = 0;
  let opaquePeelPixels = 0;
  let orangeBleedPixels = 0;
  let peelMinX = peel.width;
  let peelMinY = peel.height;
  let peelMaxX = -1;
  let peelMaxY = -1;

  for (let y = 0; y < front.height; y += 1) {
    let firstWhiteX = front.width;
    let lastWhiteX = -1;
    for (let x = 0; x < front.width; x += 1) {
      const frontOffset = (y * front.width + x) * front.channels;
      const outerOffset = (y * outer.width + x) * outer.channels;
      const peelOffset = (y * peel.width + x) * peel.channels;
      const red = front.pixels[frontOffset];
      const green = front.pixels[frontOffset + 1];
      const blue = front.pixels[frontOffset + 2];
      const isWhiteContour = red >= 245 && green >= 180 && blue >= 140;
      if (isWhiteContour) {
        firstWhiteX = Math.min(firstWhiteX, x);
        lastWhiteX = Math.max(lastWhiteX, x);
      }

      const outerAlpha = outer.pixels[outerOffset + 3];
      const peelAlpha = peel.pixels[peelOffset + 3];
      if (outerAlpha + peelAlpha !== 255) alphaComplementMismatches += 1;
      for (let channel = 0; channel < 3; channel += 1) {
        if (
          outer.pixels[outerOffset + channel] !== front.pixels[frontOffset + channel] ||
          peel.pixels[peelOffset + channel] !== front.pixels[frontOffset + channel]
        ) {
          sourceRgbMismatches += 1;
          break;
        }
      }
      if (peelAlpha > 0) {
        opaquePeelPixels += 1;
        peelMinX = Math.min(peelMinX, x);
        peelMinY = Math.min(peelMinY, y);
        peelMaxX = Math.max(peelMaxX, x);
        peelMaxY = Math.max(peelMaxY, y);
      }
    }

    for (let x = 0; x < front.width; x += 1) {
      const peelAlpha = peel.pixels[(y * peel.width + x) * peel.channels + 3];
      if (peelAlpha > 0 && (lastWhiteX < 0 || x < firstWhiteX || x > lastWhiteX)) {
        orangeBleedPixels += 1;
      }
    }
  }

  assert.equal(alphaComplementMismatches, 0);
  assert.equal(sourceRgbMismatches, 0);
  assert.equal(orangeBleedPixels, 0);
  assert.equal(opaquePeelPixels, 1_256_638);
  assert.deepEqual([peelMinX, peelMinY, peelMaxX, peelMaxY], [39, 52, 1453, 971]);
  assert.equal(peel.pixels[(100 * peel.width + 110) * peel.channels + 3], 0);
  assert.equal(peel.pixels[(500 * peel.width + 35) * peel.channels + 3], 0);
});

test("the sealed kuji ticket centers the canonical DABBOBA wordmark instead of KUJI text", () => {
  const kujiTicket = read("apps/mobile/src/features/draw/KujiPeelTicket.tsx");
  const agentGuide = read("AGENTS.md");

  assert.match(kujiTicket, /const DABBOBA_WORDMARK = require\("\.\.\/\.\.\/\.\.\/assets\/dabboba-wordmark\.png"\)/);
  assert.match(kujiTicket, /source=\{DABBOBA_WORDMARK\}/);
  assert.match(kujiTicket, /styles\.ticketWordmark/);
  assert.doesNotMatch(kujiTicket, /<Text style=\{styles\.kujiLabel\}>KUJI<\/Text>/);
  assert.match(agentGuide, /center ticket brand mark is the canonical DABBOBA wordmark image, not `KUJI` text/);
});

test("the settled reveal displays only committed server snapshot fields", () => {
  const screen = read("apps/mobile/src/features/draw/DrawRevealScreen.tsx");

  assert.match(screen, /result\.prizeName/);
  assert.match(screen, /result\.prizeImageUrl/);
  assert.match(screen, /result\.rarity/);
  assert.match(screen, /상품으로 돌아가기/);
  assert.match(screen, /router\.dismissTo\(\s*`\/product\/\$\{encodeURIComponent\(sourceProductId\)\}` as Href/);
  assert.match(screen, /KujiPeelTicket/);
  assert.match(screen, /AccessibilityInfo\.isReduceMotionEnabled/);
  assert.match(screen, /reduceMotionChanged/);
  assert.match(screen, /announceForAccessibility/);
  assert.doesNotMatch(screen, /Math\.random|recordInventoryUnit|INSERT INTO inventory|UPDATE inventory/);
});
