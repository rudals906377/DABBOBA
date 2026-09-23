import { createGachaScene } from './scenes/gacha.mjs';
import { createKujiScene } from './scenes/kuji.mjs';
import { nativeTicketFront } from './artwork.mjs';
import { DrawAudio } from './audio.mjs';
import { GACHA_DURATION, clamp, smooth, sampleGacha, sampleKujiCompletion, sampleKujiDemo, kujiCompletionDuration, dragProgress, shouldOpen } from './motion.mjs';

const $ = (id) => document.getElementById(id);
const stage = $('draw-stage'), device = document.querySelector('.device');
const audio = new DrawAudio();
const reducedPreference = matchMedia('(prefers-reduced-motion: reduce)');
let mode = 'gacha', ready = false, busy = false, complete = false;
let epoch = 0, raf = 0, dragging = null, progress = 0, lastTime = 0, frictionIdle = 0;
let reduced = reducedPreference.matches;
let scenes = {};
let recentFrames = [];
$('reduce').checked = reduced;

function status(text) { if ($('status').textContent !== text) $('status').textContent = text; }
function result(opacity) {
  $('result').style.opacity = opacity;
  $('result').setAttribute('aria-hidden', String(opacity < .999));
}
function renderGacha(t) {
  lastTime = t;
  const frame = sampleGacha(t, reduced);
  scenes.gacha?.render(frame); result(frame.resultOpacity);
  stage.style.setProperty('--corner-opacity', 1 - frame.whiteout);
  $('scrub').value = t; $('scrub-value').textContent = `${t.toFixed(2)}s`;
  const phase = ['착지', '잠깐 멈춤'].includes(frame.phase) ? '낙하' : frame.phase;
  for (const item of $('beats').children) item.classList.toggle('active', item.dataset.phase === phase && t > 0);
}
function renderKuji(state) {
  progress = state.progress;
  scenes.kuji?.render(state); result(state.resultOpacity);
  stage.style.setProperty('--corner-opacity', 1);
  $('scrub').value = progress; $('scrub-value').textContent = `${Math.round(progress * 100)}%`;
}
function updateInput() {
  $('skip-gacha').hidden = mode !== 'gacha' || !busy || !ready;
  $('play').disabled = !ready || busy;
  $('play-label').textContent = complete ? '다시 보기' : mode === 'gacha' ? '가챠 뽑기' : '버튼으로 열기';
  $('ticket-hit').disabled = !ready || busy || complete;
  $('gesture-help').textContent = complete
    ? '아래 버튼으로 다시 볼 수 있어요'
    : mode === 'kuji' ? (busy ? '티켓이 열리고 있어요' : '티켓을 오른쪽으로 당겨보세요')
      : busy ? '캡슐 안의 상품을 확인하고 있어요' : '버튼을 누르면 캡슐이 떨어져요';
  stage.setAttribute('aria-busy', String(!ready || busy));
}
function cancel() {
  epoch++; cancelAnimationFrame(raf); raf = 0; clearTimeout(frictionIdle); audio.stop();
  if (dragging && $('ticket-hit').hasPointerCapture(dragging.id)) $('ticket-hit').releasePointerCapture(dragging.id);
  dragging = null; busy = false;
}
function reset() {
  cancel(); complete = false; progress = 0; lastTime = 0; recentFrames = [];
  if (mode === 'gacha') renderGacha(0);
  else renderKuji({ progress: 0, settle: 0, resultOpacity: 0, reducedMotion: reduced });
  status(ready ? '준비 완료' : '준비 중'); updateInput();
}
// Only the interactive harness reads a browser clock. Each render call receives
// a pure snapshot; the capture entries drive these same samplers by hf-seek.
function animate(duration, onFrame, onDone) {
  const token = epoch;
  const start = performance.now();
  let previous = start;
  const tick = (stamp) => {
    if (token !== epoch) return;
    recentFrames.push(stamp - previous); previous = stamp;
    const t = Math.min(duration, Math.max(0, (stamp - start) / 1000));
    onFrame(t);
    if (t < duration) raf = requestAnimationFrame(tick);
    else { raf = 0; onDone?.(); }
  };
  onFrame(0); raf = requestAnimationFrame(tick);
}
function done() {
  busy = false; complete = true; audio.friction(0); status('개봉 완료'); updateInput();
}
function beginKuji(start = 0, releaseVelocity = 0) {
  cancel(); busy = true; complete = false; updateInput(); status('티켓 개봉 중');
  const duration = kujiCompletionDuration(start);
  if (reduced) { renderKuji(sampleKujiCompletion(start, duration, true)); done(); return; }
  audio.tear();
  animate(duration, (t) => renderKuji(sampleKujiCompletion(start, t, false, releaseVelocity)), done);
}
function beginGacha() {
  cancel(); busy = true; complete = false; recentFrames = []; updateInput(); status('캡슐 개봉 중');
  if (reduced) { renderGacha(GACHA_DURATION); done(); return; }
  audio.startGacha();
  animate(GACHA_DURATION, renderGacha, done);
}
function play() {
  if (!ready || busy) return;
  if (mode === 'gacha') beginGacha(); else beginKuji(complete ? 0 : progress);
}

const beatLabels = {
  gacha: [['낙하','통—톡, 여유 있는 착지','0.00—1.20'],['가까이 보기','캡슐로 천천히 가까이','1.20—1.80'],['개봉','천천히 열리며 차오르는 빛','1.80—3.30'],['결과 공개','하얀 화면에서 상품 공개','3.30—4.20']],
  kuji: [['드래그','손끝에 붙는 종이 말림','DRAG'],['개봉','당긴 만큼 짧아지는 개봉','RELEASE'],['결과 공개','티켓 안에서 상품 공개','≤ 0.72s']],
};
function switchScene(next, focus = false) {
  if (next === mode) return;
  cancel(); mode = next; device.dataset.scene = next;
  for (const name of ['gacha', 'kuji']) {
    const tab = $(`tab-${name}`); tab.setAttribute('aria-selected', String(name === mode)); tab.tabIndex = name === mode ? 0 : -1;
    $(`${name}-canvas`).hidden = name !== mode;
  }
  $('ticket-hit').hidden = mode !== 'kuji';
  stage.setAttribute('aria-labelledby', `tab-${mode}`);
  $('scene-heading').textContent = mode === 'gacha' ? '가챠' : '쿠지';
  $('scene-duration').textContent = mode === 'gacha' ? '4.2 SEC' : 'DRAG TO OPEN';
  $('scene-lede').textContent = mode === 'gacha'
    ? '통—톡, 여유 있는 두 번의 착지. 캡슐이 천천히 열리고 안쪽에 차오른 빛이 상품 공개로 이어집니다.'
    : '종이의 결, 접힌 틈의 빛. 손을 놓으면 남은 부분만 빠르게 열리고 상품은 티켓 안에 남습니다.';
  $('gesture-help').textContent = mode === 'gacha' ? '버튼을 누르면 캡슐이 떨어져요' : '티켓을 오른쪽으로 당겨보세요';
  $('scrub').max = mode === 'gacha' ? String(GACHA_DURATION) : '1';
  $('beats').replaceChildren(...beatLabels[mode].map(([phase, label, time], i) => {
    const row = document.createElement('li'); row.dataset.phase = phase;
    const number = document.createElement('span'), title = document.createElement('strong'), value = document.createElement('small');
    number.textContent = `0${i + 1}`; title.textContent = label; value.textContent = time;
    row.append(number, title, value); return row;
  }));
  resize(); reset(); if (focus) $(`tab-${mode}`).focus();
}
function resize() {
  const box = stage.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  scenes.gacha?.resize(box.width, box.height, ratio);
  scenes.kuji?.resize(box.width, box.height, ratio);
  const rect = scenes.kuji?.getHitRect() || { x: .1, y: .3, width: .8, height: .4 };
  Object.assign($('ticket-hit').style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });
  const resultRect = mode === 'kuji'
    ? scenes.kuji?.getResultRect?.() || { x: .20, y: .34, width: .60, height: .32 }
    : { x: 0, y: 0, width: 1, height: 1 };
  Object.assign($('result').style, { left: `${resultRect.x * 100}%`, top: `${resultRect.y * 100}%`, width: `${resultRect.width * 100}%`, height: `${resultRect.height * 100}%` });
}

$('play').addEventListener('click', play);
$('reset').addEventListener('click', reset);
$('skip-gacha').addEventListener('click', () => {
  if (mode !== 'gacha' || !ready || !busy) return;
  cancel(); renderGacha(GACHA_DURATION); done(); $('play').focus();
});
for (const name of ['gacha', 'kuji']) {
  $(`tab-${name}`).addEventListener('click', () => switchScene(name));
  $(`tab-${name}`).addEventListener('keydown', (event) => {
    if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault(); switchScene(event.key === 'Home' ? 'gacha' : event.key === 'End' ? 'kuji' : mode === 'gacha' ? 'kuji' : 'gacha', true);
    }
  });
}
let soundOperation = 0;
$('sound').addEventListener('click', async () => {
  const operation = ++soundOperation;
  if ($('sound').getAttribute('aria-pressed') === 'true') {
    audio.setMuted(true); $('sound').setAttribute('aria-pressed', 'false'); $('sound').setAttribute('aria-label','소리 켜기');
    $('sound-wave').setAttribute('d','m16 9 5 6m0-6-5 6'); return;
  }
  const unlocked = await audio.unlock();
  if (operation !== soundOperation) return;
  if (!unlocked) { status('이 브라우저에서는 소리를 켤 수 없어요'); return; }
  audio.setMuted(false); $('sound').setAttribute('aria-pressed','true'); $('sound').setAttribute('aria-label','소리 끄기');
  $('sound-wave').setAttribute('d','M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14');
});
$('reduce').addEventListener('change', () => { reduced = $('reduce').checked; reset(); });
reducedPreference.addEventListener('change', (event) => { reduced = event.matches; $('reduce').checked = reduced; reset(); });
$('scrub').addEventListener('input', () => {
  cancel(); complete = false;
  const value = Number($('scrub').value);
  if (mode === 'gacha') renderGacha(value); else renderKuji({ progress: value, settle: 0, resultOpacity: 0, reducedMotion: reduced });
  status('장면 확인 중'); updateInput();
});

const hit = $('ticket-hit');
hit.addEventListener('pointerdown', (event) => {
  if (mode !== 'kuji' || busy || complete || !ready || dragging || (event.pointerType === 'mouse' && event.button !== 0)) return;
  cancel();
  dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, startProgress: progress, width: hit.getBoundingClientRect().width, active: false, lastX: event.clientX, lastTime: event.timeStamp, velocity: 0, history: [{ x: event.clientX, t: event.timeStamp }] };
  hit.setPointerCapture(event.pointerId);
});
hit.addEventListener('pointermove', (event) => {
  if (!dragging || event.pointerId !== dragging.id) return;
  const d = dragging, dx = event.clientX - d.x, dy = event.clientY - d.y;
  if (!d.active && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { reset(); return; }
  if (!d.active && Math.abs(dx) < 4) return;
  d.active = true; event.preventDefault();
  const dt = event.timeStamp - d.lastTime;
  if (dt > 0) d.velocity = (event.clientX - d.lastX) / dt * 1000;
  d.lastX = event.clientX; d.lastTime = event.timeStamp;
  d.history.push({ x: event.clientX, t: event.timeStamp });
  d.history = d.history.filter(item => event.timeStamp - item.t <= 80);
  const p = dragProgress(d.startProgress * d.width + dx, d.width);
  renderKuji({ progress: p, settle: 0, resultOpacity: 0, reducedMotion: reduced });
  audio.friction(clamp(Math.abs(d.velocity) / 800));
  clearTimeout(frictionIdle); frictionIdle = setTimeout(() => audio.friction(0), 65);
  status('오른쪽으로 당기는 중');
});
function release(event, cancelled = false) {
  if (!dragging || event.pointerId !== dragging.id) return;
  const d = dragging; dragging = null;
  if (hit.hasPointerCapture(event.pointerId)) hit.releasePointerCapture(event.pointerId);
  audio.friction(0);
  const last = d.history[0];
  const velocity = event.timeStamp - d.lastTime > 90 ? 0 : d.lastTime > last.t ? (d.lastX - last.x) / (d.lastTime - last.t) * 1000 : d.velocity;
  if (!cancelled && d.active && shouldOpen(progress, velocity)) { beginKuji(progress, velocity / d.width); return; }
  const from = progress; cancel(); busy = true; updateInput();
  animate(.18, t => renderKuji({ progress: from * (1 - smooth(t / .18)), settle: 0, resultOpacity: 0, reducedMotion: reduced }), () => { busy = false; status('준비 완료'); updateInput(); });
}
hit.addEventListener('pointerup', event => release(event));
hit.addEventListener('pointercancel', event => release(event, true));
hit.addEventListener('lostpointercapture', event => { if (dragging) release(event, true); });
hit.addEventListener('click', event => { if (event.detail === 0 && ready && !busy && !complete) beginKuji(progress); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { soundOperation++; reset(); status('다시 재생할 준비가 됐어요'); }
});
window.addEventListener('pagehide', () => { cancel(); audio.stop(); });
window.addEventListener('resize', resize);

// Local QA entry: never connected to the app's draw/payment APIs.
window.drawPreview = {
  inspect: () => ({ ready, mode, busy, complete, progress, time: lastTime, reduced, audio: audio.inspect(), gacha: scenes.gacha?.inspect(), kuji: scenes.kuji?.inspect(), frameIntervals: recentFrames.slice(-240) }),
  seek: (scene, seconds) => {
    switchScene(scene); cancel(); complete = false;
    if (scene === 'gacha') renderGacha(seconds); else renderKuji(sampleKujiDemo(seconds));
    updateInput();
  },
};

try {
  scenes = { gacha: createGachaScene($('gacha-canvas')), kuji: createKujiScene($('kuji-canvas')) };
  const [, , ticket] = await Promise.all([scenes.gacha.ready, scenes.kuji.ready, nativeTicketFront(), $('sample-product').decode(), $('kuji-product').decode()]);
  scenes.kuji.setFrontTexture(ticket);
  device.dataset.scene = mode;
  ready = true; resize(); $('loading').hidden = true; reset();
} catch (error) {
  audio.stop(); $('loading').textContent = '장면을 불러오지 못했어요. 페이지를 새로고침해 주세요.';
  status('WebGL 또는 로컬 자산을 확인해 주세요'); console.error(error);
}
