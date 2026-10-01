import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only preparation aid. A photo is not proof of stock, licensing, or a sale-ready draw.
export const productFolders = Object.freeze([
  { id: 'gacha-chiikawa-monitor-cupcake', folder: '먼작귀 모니터 컵케이크 피규어', cover: '메인.jpg', detailCount: 7 },
  { id: 'gacha-death-note-collection-rich', folder: '데스노트 콜렉션 피규어 리치', cover: '메인.jpg', detailCount: 5 },
  { id: 'gacha-demon-slayer-onemutan-13', folder: '귀멸의 칼날 오네무탄 13형', cover: '오네무탄 13형.jpg', detailCount: 5 },
  { id: 'gacha-demon-slayer-petatto-2', folder: '귀멸의 칼날 페탓토 태엽감기 마스코트 Vol.2', cover: '페탓토 Vol.2.jpg', detailCount: 5 },
  { id: 'gacha-demon-slayer-petatto-3', folder: '귀멸의 칼날 페탓토 태엽감기 마스코트 Vol.3', cover: '페탓토 Vol.3.jpg', detailCount: 5 },
  { id: 'gacha-hatsune-miku-petadoll', folder: '하츠네 미쿠 페타돌 피어프로 캐릭터즈', cover: '메인.jpeg', detailCount: 6 },
  { id: 'gacha-sanrio-can-figures', folder: '산리오 캐릭터즈 캔 속 피규어', cover: '메인.jpg', detailCount: 5 },
  { id: 'gacha-sylvanian-adventure', folder: '실바니안 패밀리 아기 어드벤쳐 시리즈', cover: null, gallery: ['1.jpg', '2.jpg', '3.jpg'], detailCount: 8 },
]);

const imageExtensions = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif']);
const maxUploadBytes = 10 * 1024 * 1024;
const normalize = (value) => value.normalize('NFC');

export function classifyFileNames(fileNames, product) {
  const imageNames = fileNames.filter((name) => imageExtensions.has(extname(name).toLowerCase()));
  const cover = imageNames.filter((name) => product.cover && normalize(name) === normalize(product.cover));
  const gallery = (product.gallery ?? []).flatMap((slide) => imageNames.filter((name) => normalize(slide) === normalize(name)));
  const detail = imageNames.filter((name) => !cover.includes(name) && !gallery.includes(name))
    .sort((left, right) => normalize(left).localeCompare(normalize(right), 'ko', { numeric: true }));
  return { cover, gallery, detail };
}

function detectMimeType(data) {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))) return 'image/gif';
  return null;
}

export async function inspectLocalProductMedia(root) {
  const rootEntries = await readdir(root, { withFileTypes: true });
  const folders = rootEntries.filter((entry) => entry.isDirectory());
  const knownFolders = new Set(productFolders.map((product) => normalize(product.folder)));
  const problems = folders.filter((entry) => !knownFolders.has(normalize(entry.name)))
    .map((entry) => `등록표에 없는 폴더: ${normalize(entry.name)}`);
  const products = [];

  for (const product of productFolders) {
    const matches = folders.filter((entry) => normalize(entry.name) === normalize(product.folder));
    if (matches.length !== 1) {
      problems.push(`${product.id}: 상품 폴더 ${matches.length}개`);
      continue;
    }
    const folderPath = join(root, matches[0].name);
    const entries = (await readdir(folderPath, { withFileTypes: true })).filter((entry) => entry.isFile());
    const fileNames = entries.map((entry) => entry.name);
    const files = classifyFileNames(fileNames, product);
    const productProblems = [];
    const review = [];
    if (product.cover && files.cover.length !== 1) productProblems.push(`표지 후보 ${files.cover.length}개`);
    if (product.gallery && files.gallery.length !== product.gallery.length) productProblems.push(`상세 슬라이드 ${files.gallery.length}개 (기대 ${product.gallery.length}개)`);
    if (!product.cover && !product.gallery?.length) review.push('대표 사진 미지정');
    if (files.detail.length !== product.detailCount) productProblems.push(`상세 사진 ${files.detail.length}개 (기대 ${product.detailCount}개)`);
    const hashes = new Map();
    for (const name of [...files.cover, ...files.gallery, ...files.detail]) {
      const data = await readFile(join(folderPath, name));
      const mimeType = detectMimeType(data);
      const extension = extname(name).toLowerCase();
      const allowedMimes = extension === '.png' ? ['image/png']
        : extension === '.webp' ? ['image/webp']
          : extension === '.gif' ? ['image/gif'] : ['image/jpeg'];
      if (!allowedMimes.includes(mimeType)) productProblems.push(`${normalize(name)}: 확장자와 이미지 내용 불일치`);
      if (data.length === 0 || data.length > maxUploadBytes) productProblems.push(`${normalize(name)}: 업로드 크기 범위 밖`);
      const hash = createHash('sha256').update(data).digest('hex');
      if (hashes.has(hash)) review.push(`동일한 파일 내용: ${normalize(hashes.get(hash))}, ${normalize(name)}`);
      hashes.set(hash, name);
    }
    problems.push(...productProblems.map((problem) => `${product.id}: ${problem}`));
    products.push({
      id: product.id,
      folder: normalize(product.folder),
      cover: files.cover.map(normalize),
      detailCount: files.detail.length,
      details: files.detail.map(normalize),
      gallery: files.gallery.map(normalize),
      problems: productProblems,
      review,
    });
  }
  return { root, products, problems };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let root = fileURLToPath(new URL('../../재고상황/가챠/', import.meta.url));
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--json' && !json) json = true;
    else if (args[index] === '--root' && args[index + 1] && !args[index + 1].startsWith('--')) {
      root = args[index + 1];
      index += 1;
    } else throw new Error('Usage: inspect-local-product-media.mjs [--root <gacha-photo-directory>] [--json]');
  }
  const result = await inspectLocalProductMedia(resolve(root));
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    for (const product of result.products) {
      process.stdout.write(`${product.id}: 기본 대표 ${product.cover.length}, 상세 상품 ${product.detailCount}, 상세 슬라이드 ${product.gallery.length}\n`);
      for (const item of product.review) process.stdout.write(`  확인: ${item}\n`);
    }
    for (const problem of result.problems) process.stderr.write(`오류: ${problem}\n`);
    process.stdout.write(`로컬 사진 점검: 상품 ${result.products.length}개, 오류 ${result.problems.length}개. 재고·권리·업로드는 검증하지 않음.\n`);
  }
  if (result.problems.length) process.exitCode = 1;
}
