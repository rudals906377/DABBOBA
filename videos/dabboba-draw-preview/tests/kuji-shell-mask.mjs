// Independent allowed region: the accepted shell rectangle minus the original
// PNG silhouette. Scanline envelopes protect the whole cavity, including its
// transparent pixels, rather than accidentally blessing an opaque backing.
let originalRows;
async function sourceRows(front) {
  if (!originalRows) originalRows = (async () => {
    const image = new Image();
    image.src = '/assets/kuji/kuji-ticket-outer-layer.png';
    await image.decode();
    const source = document.createElement('canvas');
    source.width = 1517; source.height = 1037;
    const context = source.getContext('2d');
    // Accepted nativeStationaryArtwork uses this original 8-native-pixel
    // corner clip. Reproduce that silhouette, not the untrimmed PNG rectangle.
    context.beginPath();
    context.roundRect(0, 0, 1517, 1037, 8 * (1517 / 300));
    context.clip();
    context.drawImage(image, 0, 0);
    context.drawImage(front, 0, 0);
    const pixels = context.getImageData(0, 0, 1517, 1037).data;
    return Array.from({ length: 1037 }, (_, y) => {
      let first = 1517, last = -1;
      for (let x = 0; x < 1517; x++) if (pixels[(y * 1517 + x) * 4 + 3] > 0) {
        first = Math.min(first, x); last = x;
      }
      return [first, last];
    });
  })();
  return originalRows;
}

export async function acceptedShellMask(canvas, acceptedHit, pixelRatio, front) {
  const rows = await sourceRows(front), width = canvas.width, height = canvas.height;
  const left = acceptedHit.x * width, top = acceptedHit.y * height;
  const shellWidth = acceptedHit.width * width, shellHeight = acceptedHit.height * height;
  const artWidth = shellWidth * 300 / 316;
  const artHeight = shellHeight * (1037 / 1517 * 300) / (1037 / 1517 * 300 + 16);
  const artLeft = left + (shellWidth - artWidth) / 2, artTop = top + (shellHeight - artHeight) / 2;
  const ring = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const screenY = height - y - .5, screenX = x + .5;
    if (screenX < left || screenX > left + shellWidth || screenY < top || screenY > top + shellHeight) continue;
    const sourceX = Math.floor((screenX - artLeft) / artWidth * 1517);
    const sourceY = Math.floor((screenY - artTop) / artHeight * 1037);
    const row = rows[sourceY];
    ring[y * width + x] = Number(!row || sourceX < row[0] || sourceX > row[1]);
  }
  // Only two CSS pixels of texture/geometry AA are admitted at this fixed ring.
  const radius = Math.ceil(2 * pixelRatio), horizontal = new Uint8Array(ring.length), allowed = new Uint8Array(ring.length);
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x <= Math.min(radius, width - 1); x++) count += ring[y * width + x];
    for (let x = 0; x < width; x++) {
      horizontal[y * width + x] = Number(count > 0);
      if (x - radius >= 0) count -= ring[y * width + x - radius];
      if (x + radius + 1 < width) count += ring[y * width + x + radius + 1];
    }
  }
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y <= Math.min(radius, height - 1); y++) count += horizontal[y * width + x];
    for (let y = 0; y < height; y++) {
      allowed[y * width + x] = Number(count > 0);
      if (y - radius >= 0) count -= horizontal[(y - radius) * width + x];
      if (y + radius + 1 < height) count += horizontal[(y + radius + 1) * width + x];
    }
  }
  return allowed;
}
