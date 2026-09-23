import { createGachaScene } from './scenes/gacha.mjs';
import { createKujiScene } from './scenes/kuji.mjs';
import { nativeTicketFront } from './artwork.mjs';
import { sampleGacha, sampleKujiDemo } from './motion.mjs';
const type = document.getElementById('root').dataset.scene;
const scene = type === 'kuji' ? createKujiScene(document.getElementById('scene-canvas')) : createGachaScene(document.getElementById('scene-canvas'));
scene.resize(390, 500, 2);
let currentTime = 0;
function render(time) { currentTime = time; scene.render(type === 'kuji' ? sampleKujiDemo(time) : sampleGacha(time)); }
window.addEventListener('hf-seek', event => render(event.detail.time));
window.captureReady = scene.ready.then(async () => {
  if (type === 'kuji') {
    scene.setFrontTexture(await nativeTicketFront());
    const rect = scene.getResultRect();
    Object.assign(document.getElementById('capture-result').style, {
      left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`,
    });
    await document.querySelector('#capture-result img').decode();
  }
  render(currentTime); window.sceneReady = true;
});
render(0);
