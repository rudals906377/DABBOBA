import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4195';
const proof = fileURLToPath(new URL('../proof/', import.meta.url));
const reportName = process.env.DABBOBA_BROWSER_REPORT || 'browser-report.json';
if (!/^[a-z0-9-]+\.json$/.test(reportName)) throw new Error('Browser report name must be a local JSON basename');
const metrics = [];
let browser;

before(async () => {
  await mkdir(proof, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    args: [
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
});

after(async () => {
  await browser?.close();
  await writeFile(`${proof}/${reportName}`, JSON.stringify({
    environment: 'Local Chromium, headless SwiftShader; not native/physical-device evidence',
    origin: ORIGIN, metrics,
  }, null, 2));
});

async function openPreview(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1, ...options });
  const prohibited = [];
  const errors = [];
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== ORIGIN || !['GET', 'HEAD'].includes(request.method())) {
      prohibited.push({ url: request.url(), method: request.method() });
      await route.abort();
      return;
    }
    await route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.setDefaultTimeout(7000);
  t.after(async () => {
    await context.close();
    assert.deepEqual(prohibited, [], 'Preview must never POST or contact an external service');
    assert.deepEqual(errors, [], 'Browser and WebGL must have no runtime errors');
  });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
  // Shader compilation on software GPU is not part of the interaction clock.
  await expect(page.locator('#play')).toBeEnabled({ timeout: 15000 });
  await expect.poll(() => read(page, 'ready')).toBe(true);
  return { page, context };
}

async function read(page, key) {
  return page.evaluate(key => {
    const snapshot = window.drawPreview.inspect();
    return key ? key.split('.').reduce((value, part) => value[part], snapshot) : snapshot;
  }, key);
}
const hiddenResult = page => expect(page.locator('#result')).toHaveAttribute('aria-hidden', 'true');
const visibleResult = page => expect(page.locator('#result')).toHaveAttribute('aria-hidden', 'false');
async function waitComplete(page, timeout = 2500) {
  await expect.poll(() => read(page, 'complete'), { timeout }).toBe(true);
  await expect(page.locator('#status')).toContainText('개봉 완료');
  await visibleResult(page);
  await expect(page.locator('#gesture-help')).toHaveText('아래 버튼으로 다시 볼 수 있어요');
}
async function kuji(page) {
  await page.getByRole('tab', { name: '쿠지', exact: true }).click();
  await expect(page.locator('#ticket-hit')).toBeVisible();
  await expect(page.locator('#skip-gacha')).toBeHidden();
  return page.locator('#ticket-hit').boundingBox();
}
async function assertKujiFixture(page) {
  await visibleResult(page);
  const fixture = page.locator('#kuji-product');
  await expect(fixture).toBeVisible();
  await expect(page.locator('#sample-product')).toBeHidden();
  await expect(page.locator('.kuji-result')).toContainText('시안 예시 · 실제 당첨 아님');
  assert.ok(await fixture.evaluate(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0));
  assert.ok((await fixture.getAttribute('alt'))?.trim(), 'Kuji fixture needs an accessible description');
  assert.equal(await read(page, 'kuji.paperVisible'), false, 'Completed paper must not cover the product');
  const boxes = await page.evaluate(() => {
    const box = element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    };
    return {
      card: box(document.querySelector('#ticket-hit')), inner: box(document.querySelector('#result')),
      content: [...document.querySelectorAll('.kuji-result img, .kuji-result p, .kuji-result span')].map(box),
    };
  });
  const inside = (child, parent) => child.left >= parent.left - 1 && child.top >= parent.top - 1
    && child.right <= parent.right + 1 && child.bottom <= parent.bottom + 1;
  assert.ok(inside(boxes.inner, boxes.card), 'Result area must remain inside the original ticket');
  for (const box of boxes.content) assert.ok(inside(box, boxes.inner), 'Product and sample label must fit inside the ticket result area');
  return fixture.getAttribute('src');
}

async function scrubKuji(page, fraction = .35) {
  const slider = page.getByRole('slider', { name: '연출 진행 위치', exact: true });
  const box = await slider.boundingBox();
  await slider.click({ position: { x: box.width * fraction, y: box.height / 2 } });
  await page.locator('#ticket-hit').scrollIntoViewIfNeeded();
  return read(page, 'progress');
}
async function slowDrag(page, box, fraction, { waitBeforeUp = 120, yFraction = 0 } = {}) {
  const x = box.x + box.width * .15;
  const y = box.y + box.height * .5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(x + box.width * fraction * step / 8, y + box.height * yFraction * step / 8);
    await page.waitForTimeout(55);
  }
  await page.waitForTimeout(waitBeforeUp);
}

test('gacha completes its 4.2 s reveal with a persistent, accessibility-gated fixture result', { timeout: 30000 }, async t => {
  const { page } = await openPreview(t);
  await hiddenResult(page);
  await expect(page.locator('#skip-gacha')).toBeHidden();
  const start = Date.now();
  await page.getByRole('button', { name: '가챠 뽑기' }).click();
  await expect(page.locator('#draw-stage')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: '결과 바로 보기', exact: true })).toBeVisible();
  await expect.poll(() => read(page, 'time')).toBeGreaterThan(1);
  await hiddenResult(page);
  assert.equal(await read(page, 'complete'), false);
  await waitComplete(page, 6500);
  const durationMs = Date.now() - start;
  assert.equal(await read(page, 'time'), 4.2);
  const frameIntervals = await read(page, 'frameIntervals');
  await expect(page.locator('#play')).toHaveText(/다시 보기/);
  await expect(page.locator('#skip-gacha')).toBeHidden();
  const resultSnapshot = await page.getByRole('tabpanel').ariaSnapshot();
  assert.match(resultSnapshot, /시안 예시 · 실제 당첨 아님/);
  const fixture = page.locator('#sample-product');
  await expect(fixture).toBeVisible();
  assert.ok(await fixture.evaluate(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0), 'Fixed fixture product image must decode');
  assert.ok((await fixture.getAttribute('alt'))?.trim(), 'Fixture must have an accessible image description');
  await page.waitForTimeout(4300);
  await visibleResult(page);
  assert.equal(await read(page, 'time'), 4.2);
  assert.equal(await read(page, 'busy'), false);
  metrics.push({ scenario: 'gacha-complete', statusPollingWallClockMs: durationMs, expectedCompletionTimelineMs: 4200,
    finalTimelineSeconds: await read(page, 'time'), frameIntervals,
    endingFrameElapsedMs: frameIntervals.reduce((sum, interval) => sum + interval, 0),
    retainedAfterMs: 4300, fixtureDecoded: true,
    timingNote: 'Status waiter and software-GPU frame delays are observations, not a real-device timing guarantee.' });
  await page.locator('#draw-stage').screenshot({ path: `${proof}/gacha-white-result.png` });

  // The read-only seek seam is used only for reproducible proof images.
  await page.evaluate(() => window.drawPreview.seek('gacha', 1.2));
  await page.locator('#gacha-canvas').screenshot({ path: `${proof}/gacha-closed.png` });
  await page.screenshot({ path: `${proof}/desktop.png` });
  await page.evaluate(() => window.drawPreview.seek('gacha', 1.50));
  await page.locator('#gacha-canvas').screenshot({ path: `${proof}/gacha-focus-mid.png` });
  await page.evaluate(() => window.drawPreview.seek('gacha', 1.80));
  await page.locator('#gacha-canvas').screenshot({ path: `${proof}/gacha-focus-complete.png` });
  await page.evaluate(() => window.drawPreview.seek('gacha', 2.66));
  await page.locator('#gacha-canvas').screenshot({ path: `${proof}/gacha-open.png` });
  await page.evaluate(() => window.drawPreview.seek('gacha', 3.75));
  await page.locator('#draw-stage').screenshot({ path: `${proof}/gacha-white-transition.png` });
});

test('gacha reveals at 3.82–4.06 s over a spatially complete white frame, then holds to 4.2 s', { timeout: 15000 }, async t => {
  const { page } = await openPreview(t);
  const frames = await page.evaluate(() => {
    const samples = [];
    for (const time of [3.81, 3.82, 3.83, 3.94, 4.00, 4.06, 4.20]) {
      window.drawPreview.seek('gacha', time);
      const state = window.drawPreview.inspect().gacha.state;
      const canvas = document.querySelector('#gacha-canvas');
      const gl = canvas.getContext('webgl2');
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      // Read in the same task as the render; no preserveDrawingBuffer assumption.
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let minimumRGB = 255, minimumAlpha = 255;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        minimumRGB = Math.min(minimumRGB, pixels[offset], pixels[offset + 1], pixels[offset + 2]);
        minimumAlpha = Math.min(minimumAlpha, pixels[offset + 3]);
      }
      samples.push({ time, ...state, minimumRGB, minimumAlpha,
        overlayOpacity: Number(document.querySelector('#result').style.opacity),
        accessibilityHidden: document.querySelector('#result').getAttribute('aria-hidden') });
    }
    return samples;
  });
  for (const frame of frames) {
    // CSSOM serializes opacity to six decimal places; compare at that precision.
    assert.ok(Math.abs(frame.overlayOpacity - frame.resultOpacity) <= 0.0000005,
      'The product opacity must use the same pure sampler within CSS serialization precision');
    if (frame.time <= 3.82) assert.equal(frame.resultOpacity, 0, 'No early result');
    else {
      assert.ok(frame.resultOpacity > 0);
      assert.equal(frame.minimumRGB, 255, 'All rendered background pixels must be white before a product is visible');
      assert.equal(frame.minimumAlpha, 255, 'The product cannot appear over a transparent or incomplete reveal');
    }
    if (frame.time < 4.0) assert.ok(frame.whiteout < 1, 'Full spatial coverage precedes the scalar whiteout endpoint');
    if (frame.time >= 4.06) {
      assert.equal(frame.resultOpacity, 1);
      assert.equal(frame.accessibilityHidden, 'false');
    }
  }
  assert.equal(frames.find(frame => frame.time === 3.83).accessibilityHidden, 'true', 'Partially faded-in product remains accessibility-gated');
  metrics.push({ scenario: 'gacha-result-timing', revealStart: 3.82, revealEnd: 4.06, holdEnd: 4.2,
    frames: frames.map(({ time, resultOpacity, whiteout, minimumRGB, minimumAlpha }) => ({ time, resultOpacity, whiteout, minimumRGB, minimumAlpha })) });
});

test('gacha skip cancels motion and audio immediately, keeps the same final result, and supports Enter', { timeout: 25000 }, async t => {
  const { page } = await openPreview(t);
  const skip = page.getByRole('button', { name: '결과 바로 보기', exact: true });
  await expect(page.locator('#skip-gacha')).toBeHidden();
  await page.getByRole('button', { name: '소리 켜기', exact: true }).click();
  await page.getByRole('button', { name: '가챠 뽑기' }).click();
  await expect(skip).toBeVisible();
  await expect.poll(() => read(page, 'audio.activeSources')).toBeGreaterThan(0);
  const start = Date.now();
  await skip.click();
  await waitComplete(page, 1000);
  const skipMs = Date.now() - start;
  assert.ok(skipMs < 800, `Skip must not wait for the remaining timeline (${skipMs} ms)`);
  assert.equal(await read(page, 'time'), 4.2);
  assert.equal(await read(page, 'busy'), false);
  assert.equal(await read(page, 'audio.activeSources'), 0);
  await expect(page.locator('#skip-gacha')).toBeHidden();
  const finalFrame = await read(page, 'gacha.state');
  assert.equal(finalFrame.opening, 1);
  assert.equal(finalFrame.whiteout, 1);
  assert.equal(finalFrame.resultOpacity, 1);
  const expectedFinalFrame = await page.evaluate(async () => {
    const { sampleGacha } = await import('/motion.mjs');
    const final = sampleGacha(4.2);
    return Object.fromEntries(Object.keys(window.drawPreview.inspect().gacha.state).map(key => [key, final[key]]));
  });
  assert.deepEqual(finalFrame, expectedFinalFrame, 'Skip must show the identical normal 4.2 s final render state');
  const fixtureSrc = await page.locator('#sample-product').getAttribute('src');
  assert.match(fixtureSrc, /sample-maomao\.png$/, 'Skip must retain the same fixed example product');
  await page.waitForTimeout(4300);
  assert.deepEqual(await read(page, 'gacha.state'), finalFrame, 'Cancelled animation must never overwrite the final frame');
  assert.equal(await read(page, 'audio.activeSources'), 0, 'Cancelled cues must never replay');
  await visibleResult(page);
  await page.getByRole('button', { name: '처음으로' }).click();
  await expect(page.locator('#skip-gacha')).toBeHidden();
  await hiddenResult(page);
  await page.getByRole('button', { name: '가챠 뽑기' }).click();
  await skip.focus();
  await page.keyboard.press('Enter');
  await waitComplete(page, 1000);
  assert.equal(await read(page, 'time'), 4.2);
  assert.equal(await read(page, 'audio.activeSources'), 0);
  assert.equal(await page.locator('#sample-product').getAttribute('src'), fixtureSrc, 'Preview replay must use the same fixture, not random winnings');
  metrics.push({ scenario: 'gacha-skip', skipMs, finalTimelineSeconds: 4.2, activeSources: 0, retainedAfterMs: 4300, keyboard: 'complete', fixedFixture: true, normalFinalSamplerMatched: true });
});

test('reset and tab switch cancel a playing gacha without a stale result', { timeout: 30000 }, async t => {
  const { page } = await openPreview(t);
  await page.locator('#play').click();
  await expect.poll(() => read(page, 'time')).toBeGreaterThan(.25);
  await page.getByRole('button', { name: '처음으로' }).click();
  await expect.poll(() => read(page, 'busy')).toBe(false);
  await expect(page.locator('#skip-gacha')).toBeHidden();
  await page.waitForTimeout(4300);
  assert.equal(await read(page, 'time'), 0);
  assert.equal(await read(page, 'complete'), false);
  await hiddenResult(page);
  await page.locator('#play').click();
  await expect.poll(() => read(page, 'time')).toBeGreaterThan(.25);
  await kuji(page);
  await expect(page.locator('#skip-gacha')).toBeHidden();
  await page.waitForTimeout(4300);
  assert.equal(await read(page, 'mode'), 'kuji');
  assert.equal(await read(page, 'progress'), 0);
  assert.equal(await read(page, 'complete'), false);
  await hiddenResult(page);
  await page.locator('#kuji-canvas').screenshot({ path: `${proof}/kuji-sealed.png` });
  metrics.push({ scenario: 'gacha-cancellation', reset: 'no stale result after 4.3 s', tabSwitch: 'no stale result after 4.3 s', skipHidden: true });
});

test('short slow kuji drag springs back; long drag finishes according to its remaining peel distance', { timeout: 30000 }, async t => {
  const { page } = await openPreview(t);
  let box = await kuji(page);
  await slowDrag(page, box, .34);
  assert.ok(Math.abs(await read(page, 'progress') - .34) < .015);
  await hiddenResult(page);
  await page.locator('#kuji-canvas').screenshot({ path: `${proof}/kuji-curl.png` });
  const springStart = Date.now();
  await page.mouse.up();
  await expect.poll(() => read(page, 'progress'), { timeout: 2000, intervals: [20, 30, 50] }).toBe(0);
  const springMs = Date.now() - springStart;
  assert.ok(springMs >= 140, `Spring-back unexpectedly skipped its transition (${springMs} ms)`);
  assert.equal(await read(page, 'complete'), false);
  await hiddenResult(page);
  box = await page.locator('#ticket-hit').boundingBox();
  await slowDrag(page, box, .62);
  assert.ok(await read(page, 'progress') >= .58);
  const startProgress = await read(page, 'progress');
  const expectedCompletionMs = (.36 + .36 * (1 - startProgress)) * 1000;
  const previousFrameCount = (await read(page, 'frameIntervals')).length;
  const finishStart = Date.now();
  await page.mouse.up();
  await waitComplete(page, 2500);
  const completionMs = Date.now() - finishStart;
  const endingFrameIntervals = (await read(page, 'frameIntervals')).slice(previousFrameCount);
  await assertKujiFixture(page);
  const completedFrame = await read(page, 'kuji.state');
  const expectedFinalFrame = await page.evaluate(async start => {
    const { sampleKujiCompletion, kujiCompletionDuration } = await import('/motion.mjs');
    return sampleKujiCompletion(start, kujiCompletionDuration(start));
  }, startProgress);
  assert.deepEqual(completedFrame, expectedFinalFrame, 'UI ending must finish at the exact dynamic sampler result');
  await page.waitForTimeout(900);
  assert.deepEqual(await read(page, 'kuji.state'), completedFrame);
  await visibleResult(page);
  metrics.push({ scenario: 'kuji-short-and-long-drag', springMs, expectedSpringTimelineMs: 180,
    statusPollingWallClockMs: completionMs, expectedCompletionTimelineMs: expectedCompletionMs,
    endingFrameIntervals, endingFrameElapsedMs: endingFrameIntervals.reduce((sum, interval) => sum + interval, 0),
    finalSamplerMatched: true, retainedAfterMs: 900,
    timingNote: 'Status polling includes waiter latency; frame intervals include software-GPU stalls. Neither is a real-device 720 ms guarantee.' });
  await page.evaluate(() => window.drawPreview.seek('kuji', .4));
  await page.locator('#draw-stage').screenshot({ path: `${proof}/kuji-curl-04.png` });
  await page.evaluate(() => window.drawPreview.seek('kuji', 1.62));
  await page.locator('#draw-stage').screenshot({ path: `${proof}/kuji-inside-result.png` });
});

test('kuji re-grab continues from a scrubbed partial peel without jumping and can reverse or commit', { timeout: 20000 }, async t => {
  const { page } = await openPreview(t);
  await kuji(page);
  let startProgress = await scrubKuji(page);
  assert.ok(startProgress > .25 && startProgress < .45);
  let box = await page.locator('#ticket-hit').boundingBox();
  let x = box.x + box.width * .2, y = box.y + box.height * .5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  assert.ok(Math.abs(await read(page, 'progress') - startProgress) < .001, 'Pointer-down must not reset a partial peel');
  await page.mouse.move(x + box.width * .12, y);
  assert.ok(Math.abs(await read(page, 'progress') - (startProgress + .12)) < .015, 'A new drag must add displacement to the existing peel');
  await page.mouse.move(x + box.width * .05, y);
  assert.ok(Math.abs(await read(page, 'progress') - (startProgress + .05)) < .015, 'Reversing must unwind from the same baseline');
  await page.mouse.move(x - box.width * .15, y);
  assert.ok(Math.abs(await read(page, 'progress') - (startProgress - .15)) < .015);
  await page.waitForTimeout(120);
  await page.mouse.up();
  await expect.poll(() => read(page, 'progress')).toBe(0);
  assert.equal(await read(page, 'complete'), false);
  await hiddenResult(page);

  startProgress = await scrubKuji(page);
  box = await page.locator('#ticket-hit').boundingBox();
  x = box.x + box.width * .2; y = box.y + box.height * .5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * .3, y);
  const releaseProgress = await read(page, 'progress');
  assert.ok(releaseProgress >= .58 && Math.abs(releaseProgress - (startProgress + .3)) < .015);
  await page.waitForTimeout(120);
  await page.mouse.up();
  let previous = { progress: releaseProgress, settle: 0, resultOpacity: 0 };
  const observed = [];
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => {
      const value = window.drawPreview.inspect();
      return { complete: value.complete, state: value.kuji.state };
    });
    for (const name of ['progress', 'settle', 'resultOpacity']) {
      assert.ok(snapshot.state[name] >= previous[name], `${name} must not move backwards during the quick ending`);
    }
    observed.push(snapshot.state.progress);
    previous = snapshot.state;
    if (snapshot.complete) break;
    await page.waitForTimeout(20);
  }
  await waitComplete(page);
  await assertKujiFixture(page);
  await expect(page.locator('#skip-gacha')).toBeHidden();
  metrics.push({ scenario: 'kuji-regrab', startProgress, releaseProgress, noJump: true, reverse: 'sealed', observedEndingProgress: observed, ending: 'monotonic', resultInsideCard: true });
});

test('reset and tab switch cancel the short kuji ending without stale product or audio', { timeout: 15000 }, async t => {
  const { page } = await openPreview(t);
  await kuji(page);
  await page.getByRole('button', { name: '소리 켜기', exact: true }).click();
  await page.locator('#play').click();
  await expect(page.locator('#draw-stage')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#skip-gacha')).toBeHidden();
  await page.locator('#reset').click();
  await page.waitForTimeout(850);
  assert.equal(await read(page, 'progress'), 0);
  assert.equal(await read(page, 'complete'), false);
  assert.equal(await read(page, 'kuji.paperVisible'), true);
  assert.equal(await read(page, 'audio.activeSources'), 0);
  await hiddenResult(page);
  await page.locator('#play').click();
  await page.getByRole('tab', { name: '가챠', exact: true }).click();
  await page.waitForTimeout(850);
  assert.equal(await read(page, 'mode'), 'gacha');
  assert.equal(await read(page, 'time'), 0);
  assert.equal(await read(page, 'complete'), false);
  assert.equal(await read(page, 'audio.activeSources'), 0);
  await expect(page.locator('#skip-gacha')).toBeHidden();
  await hiddenResult(page);
  metrics.push({ scenario: 'kuji-cancellation', reset: 'sealed after 850 ms', tabSwitch: 'no stale result after 850 ms', activeSources: 0, noKujiSkip: true });
});

test('rightward flick beyond 18% commits; reverse and vertical input never open', { timeout: 15000 }, async t => {
  const { page, context } = await openPreview(t);
  let box = await kuji(page);
  const x = box.x + box.width * .2, y = box.y + box.height * .5;
  // Trusted browser input with explicit physical timestamps prevents a slow
  // software-GPU round trip from turning an intended fast flick into a hold.
  const cdp = await context.newCDPSession(page);
  const timestamp = Date.now() / 1000;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, timestamp });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, timestamp: timestamp + .001 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + box.width * .14, y, button: 'left', buttons: 1, timestamp: timestamp + .016 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + box.width * .28, y, button: 'left', buttons: 1, timestamp: timestamp + .031 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + box.width * .28, y, button: 'left', buttons: 0, clickCount: 1, timestamp: timestamp + .041 });
  await waitComplete(page);
  await page.locator('#reset').click();
  box = await page.locator('#ticket-hit').boundingBox();
  await slowDrag(page, box, -.32);
  await page.mouse.up();
  await expect.poll(() => read(page, 'busy')).toBe(false);
  assert.equal(await read(page, 'progress'), 0);
  assert.equal(await read(page, 'complete'), false);
  await hiddenResult(page);
  const startX = box.x + box.width * .5, startY = box.y + box.height * .5;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 2, startY + 45, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  assert.equal(await read(page, 'progress'), 0);
  assert.equal(await read(page, 'complete'), false);
  await hiddenResult(page);
  metrics.push({ scenario: 'kuji-flick-reverse-vertical', flick: 'committed below distance threshold', flickFraction: .28, inputVelocityPxPerSecond: box.width * .28 / .03, reverse: 'sealed', vertical: 'sealed' });
});

test('touch cancellation stays sealed and a long touch drag opens', { timeout: 12000 }, async t => {
  const { page, context } = await openPreview(t, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const box = await kuji(page);
  const cdp = await context.newCDPSession(page);
  const x = box.x + box.width * .16, y = box.y + box.height * .5;
  const touch = async (type, tx = x, ty = y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x: tx, y: ty, radiusX: 5, radiusY: 5, force: 1, id: 1 }],
  });
  await touch('touchStart');
  await touch('touchMove', x + box.width * .3);
  await touch('touchCancel');
  await expect.poll(() => read(page, 'progress'), { timeout: 2000, intervals: [30, 50, 100] }).toBe(0);
  assert.equal(await read(page, 'complete'), false);
  assert.equal(await read(page, 'progress'), 0);
  await hiddenResult(page);
  await touch('touchStart');
  for (let step = 1; step <= 5; step++) {
    await touch('touchMove', x + box.width * .63 * step / 5);
    await page.waitForTimeout(35);
  }
  await touch('touchEnd');
  await waitComplete(page);
  await assertKujiFixture(page);
  metrics.push({ scenario: 'touch-native-browser-input', cancelled: 'sealed', longDrag: 'complete' });
});

test('keyboard Enter opens the ticket; reduced motion finishes immediately and stays stable', { timeout: 10000 }, async t => {
  const { page } = await openPreview(t);
  await kuji(page);
  assert.equal(await read(page, 'kuji.paperVisible'), true);
  await page.getByRole('button', { name: '쿠지 티켓 열기', exact: true }).focus();
  await page.keyboard.press('Enter');
  await waitComplete(page);
  await page.locator('#reduce').check();
  await page.getByRole('tab', { name: '가챠', exact: true }).click();
  const start = Date.now();
  await page.locator('#play').click();
  await waitComplete(page, 1000);
  assert.ok(Date.now() - start < 800);
  const reducedFrame = await read(page, 'gacha.state');
  assert.equal(reducedFrame.opening, 0);
  assert.equal(reducedFrame.seal, 0);
  assert.equal(reducedFrame.rattle, 0);
  assert.equal(reducedFrame.dropHeight, 0);
  assert.equal(reducedFrame.light, 0);
  await page.waitForTimeout(250);
  assert.deepEqual(await read(page, 'gacha.state'), reducedFrame);
  await kuji(page);
  await page.locator('#play').click();
  await waitComplete(page, 1000);
  assert.equal(await read(page, 'kuji.state.progress'), 0);
  assert.equal(await read(page, 'kuji.paperVisible'), false);
  await assertKujiFixture(page);
  await page.locator('#draw-stage').screenshot({ path: `${proof}/kuji-reduced-result.png` });
  metrics.push({ scenario: 'keyboard-reduced-motion', keyboard: 'complete', reducedGacha: 'stable no travel/light', reducedKuji: 'stable result with paper hidden' });
});

test('audio is muted by default and both mute/reset stop scheduled sources', { timeout: 10000 }, async t => {
  const { page } = await openPreview(t);
  assert.equal(await read(page, 'audio.muted'), true);
  assert.equal(await read(page, 'audio.activeSources'), 0);
  await expect(page.locator('#sound')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '소리 켜기', exact: true }).click();
  await expect(page.locator('#sound')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#play').click();
  await expect.poll(() => read(page, 'audio.activeSources')).toBeGreaterThan(0);
  await page.getByRole('button', { name: '소리 끄기', exact: true }).click();
  assert.equal(await read(page, 'audio.activeSources'), 0);
  await page.locator('#reset').click();
  await page.getByRole('button', { name: '소리 켜기', exact: true }).click();
  await page.locator('#play').click();
  await expect.poll(() => read(page, 'audio.activeSources')).toBeGreaterThan(0);
  await page.locator('#reset').click();
  assert.equal(await read(page, 'audio.activeSources'), 0);
  await page.waitForTimeout(1700);
  assert.equal(await read(page, 'audio.activeSources'), 0);
  metrics.push({ scenario: 'audio', defaultMuted: true, muteActiveSources: 0, resetActiveSources: 0, delayedReplay: false });
});

for (const viewport of [{ width: 320, height: 740 }, { width: 360, height: 800 }, { width: 390, height: 844 }]) {
  test(`responsive ${viewport.width}×${viewport.height}: no overflow, 44 px buttons and an in-card kuji result`, { timeout: 12000 }, async t => {
    const { page } = await openPreview(t, { viewport, deviceScaleFactor: 1 });
    const pageWidth = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(pageWidth.document <= pageWidth.viewport, JSON.stringify(pageWidth));
    const targetSizes = await page.locator('button:visible').evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect();
      return { id: button.id, width: box.width, height: box.height };
    }));
    for (const target of targetSizes) {
      assert.ok(target.width >= 43.5 && target.height >= 43.5, `${target.id} is ${target.width}×${target.height}, below 44 px`);
    }
    await page.locator('#play').click();
    await expect(page.locator('#skip-gacha')).toBeVisible();
    const skipBox = await page.locator('#skip-gacha').boundingBox();
    assert.ok(skipBox.width >= 43.5 && skipBox.height >= 43.5, 'Skip must be at least 44 px in both dimensions');
    targetSizes.push({ id: 'skip-gacha', width: skipBox.width, height: skipBox.height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Playing controls must not cause horizontal overflow');
    await page.locator('#reset').click();
    if (viewport.width === 390) {
      await page.evaluate(() => window.drawPreview.seek('gacha', 2.66));
      await page.screenshot({ path: `${proof}/mobile.png`, fullPage: true });
    }
    await kuji(page);
    await page.locator('#play').click();
    await waitComplete(page);
    await assertKujiFixture(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Kuji result must not cause horizontal overflow');
    if (viewport.width === 390) await page.locator('#draw-stage').screenshot({ path: `${proof}/kuji-mobile-result.png` });
    metrics.push({ scenario: 'responsive', viewport, pageWidth, targetSizes, kujiResultInsideCard: true });
  });
}
