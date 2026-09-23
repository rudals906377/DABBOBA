/** Recreates the native ticket's separate brand/text layer, not new artwork. */
const image = (path) => new Promise((resolve, reject) => {
  const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error(`Asset unavailable: ${path}`));
  img.src = new URL(path, import.meta.url).href;
});
export async function nativeTicketFront() {
  const [base, mark] = await Promise.all([
    image('./assets/kuji/kuji-ticket-peel-layer.png'), image('./assets/brand/dabboba-wordmark.png'),
    document.fonts.load('900 16px "Noto Sans KR"'),
  ]);
  const canvas = document.createElement('canvas'); canvas.width = 1517; canvas.height = 1037;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(base, 0, 0);
  // KujiPeelTicket: native inner width300, centered group, +4px X,
  // wordmark112x17, margin8, serial16/21, weight900 and tracking.7.
  const scale = 1517 / 300, cx = canvas.width / 2 + 4 * scale;
  const top = (canvas.height - 46 * scale) / 2;
  const markHeight = Math.min(17 * scale, 112 * scale * mark.height / mark.width);
  ctx.drawImage(mark, cx - 56 * scale, top + (17 * scale - markHeight) / 2, 112 * scale, markHeight);
  ctx.font = `900 ${16 * scale}px "Noto Sans KR"`; ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  const serial = 'SEALED';
  const tracking = .7 * scale;
  const widths = [...serial].map(char => ctx.measureText(char).width);
  let x = cx - (widths.reduce((a, b) => a + b, 0) + tracking * (serial.length - 1)) / 2;
  [...serial].forEach((char, index) => { ctx.fillText(char, x, top + (25 + 10.5) * scale); x += widths[index] + tracking; });
  return canvas;
}
