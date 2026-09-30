import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SupabaseMediaStorage } from '../packages/media-storage/dist/index.js';
import {
  SUPABASE_INTEGRATION_PROJECT_REF,
  supabaseProjectRefFromDatabaseUrl,
} from './supabase-integration-profile.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const photoRoot = resolve(repositoryRoot, '../상품사진');
const edgeProfileFile = resolve(repositoryRoot, '../.dabboba-launch/supabase-edge.env');
const appEnvFile = resolve(repositoryRoot, '.env');
const generation = 'product-photos-2026-09-10';
const catalogOwnerId = 'ca7a10a0-0000-4000-8000-000000000001';

function supabaseProjectRefFromHttpUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  return /^([a-z0-9]{20})\.(?:storage\.)?supabase\.co$/.exec(url.hostname.toLowerCase())?.[1] ?? null;
}

/**
 * Every endpoint this operator workflow touches must name one approved project:
 * the database it rewrites, the Auth/API origin whose service key it fetches,
 * and the Storage S3 endpoint it uploads to. The delivery base follows from it,
 * so migrated rows and new uploads share the host rebased by migration 0067.
 */
export function resolvePhotoSyncTarget({ databaseUrl, supabaseUrl, s3Endpoint }) {
  const refs = [
    supabaseProjectRefFromDatabaseUrl(databaseUrl),
    supabaseProjectRefFromHttpUrl(supabaseUrl),
    supabaseProjectRefFromHttpUrl(s3Endpoint),
  ];
  if (refs.some((ref) => ref !== SUPABASE_INTEGRATION_PROJECT_REF)) {
    throw new Error('상품사진 동기화 대상의 DB·Supabase·Storage 주소가 승인된 하나의 프로젝트를 가리키지 않습니다.');
  }
  return {
    projectRef: SUPABASE_INTEGRATION_PROJECT_REF,
    catalogBaseUrl: `https://${SUPABASE_INTEGRATION_PROJECT_REF}.supabase.co/functions/v1/dabboba-api`,
  };
}
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = requireFromApi('pg');
const sharp = requireFromApi('sharp');

const ips = Object.freeze({
  'demon-slayer': ['demon-slayer', '귀멸의 칼날', 'Demon Slayer'],
  'my-hero-academia': ['my-hero-academia', '나의 히어로 아카데미아', 'My Hero Academia'],
  'chainsaw-man': ['chainsaw-man', '체인소맨', 'Chainsaw Man'],
  'powerpuff-girls': ['powerpuff-girls', '파워퍼프걸', 'The Powerpuff Girls'],
  haikyu: ['haikyu', '하이큐!!', 'Haikyu!!'],
  'death-note': ['death-note', '데스노트', 'Death Note'],
  'apothecary-diaries': ['apothecary-diaries', '약사의 혼잣말', 'The Apothecary Diaries'],
  'sylvanian-families': ['sylvanian-families', '실바니안 패밀리', 'Sylvanian Families'],
  'hatsune-miku': ['hatsune-miku', '하츠네 미쿠', 'Hatsune Miku'],
});

const products = Object.freeze([
  ['gacha-demon-slayer-onemutan-13', 'DB-G-001', '400엔/귀멸의 칼날 오네무탄 13형', 'demon-slayer', 5900],
  ['gacha-demon-slayer-mejirushi-2', 'DB-G-002', '400엔/귀멸의 칼날 캬라 반창고 메지루시 마스코트 2탄', 'demon-slayer', 5500],
  ['gacha-demon-slayer-mejirushi-3', 'DB-G-003', '400엔/귀멸의 칼날 캬라 반창고 메지루시 마스코트 3탄', 'demon-slayer', 5500],
  ['gacha-my-hero-academia-villains', 'DB-G-004', '400엔/나의 히어로 아카데미아 어깨쿵 빌런편', 'my-hero-academia', 5500],
  ['gacha-chainsaw-man-reze-2', 'DB-G-005', '400엔/체인소맨 레제편 어깨쿵 2탄', 'chainsaw-man', 5500],
  ['gacha-powerpuff-together', 'DB-G-006', '400엔/파워퍼프걸 인형과 함께', 'powerpuff-girls', 5500],
  ['gacha-haikyu-mascot-keyholder', 'DB-G-007', '400엔/하이큐!! 마스코트 키홀더', 'haikyu', 5500],
  ['gacha-haikyu-middle-school-2', 'DB-G-008', '400엔/하이큐!! 중학생 어깨쿵 2탄', 'haikyu', 5500],
  ['gacha-demon-slayer-petatto-2', 'DB-G-009', '500엔/귀멸의 칼날 페탓토 태엽감기 마스코트 Vol.2', 'demon-slayer', 6900],
  ['gacha-demon-slayer-petatto-3', 'DB-G-010', '500엔/귀멸의 칼날 페탓토 태엽감기 마스코트 Vol.3', 'demon-slayer', 6900],
  ['gacha-death-note-collection-rich', 'DB-G-011', '500엔/데스노트 콜렉션 피규어 리치', 'death-note', 0],
  ['gacha-apothecary-mugyutto', 'DB-G-012', '500엔/약사의 혼잣말 무규토', 'apothecary-diaries', 6500],
  ['gacha-sylvanian-adventure', 'DB-G-013', '실바니안 어드벤쳐 시리즈', 'sylvanian-families', 9900],
  ['gacha-hatsune-miku-petadoll', 'DB-G-014', '하츠네 미쿠 페타돌 피어프로 캐릭터즈', 'hatsune-miku', 0],
].map(([id, sku, folder, ipId, price]) => ({ id, sku, folder, ipId, price })));

function normalize(value) {
  return value.normalize('NFC');
}

function displayName(filename) {
  return normalize(basename(filename, extname(filename))).trim();
}

function ignoredPrize(product, filename) {
  const name = displayName(filename);
  return product.id === 'gacha-sylvanian-adventure' && ['메인 예비', '3'].includes(name);
}

async function directoryEntries(path) {
  return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.name !== '.DS_Store');
}

async function resolveNormalizedPath(parent, segment, directory) {
  const matches = (await directoryEntries(parent)).filter((entry) => entry.isDirectory() === directory && normalize(entry.name) === normalize(segment));
  if (matches.length !== 1) throw new Error(`상품사진 경로를 하나로 확인할 수 없습니다: ${segment}`);
  return join(parent, matches[0].name);
}

async function buildPlan() {
  const rootEntries = await directoryEntries(photoRoot);
  const gachaEntry = rootEntries.find((entry) => entry.isDirectory() && normalize(entry.name) === '가챠');
  const kujiEntry = rootEntries.find((entry) => entry.isDirectory() && normalize(entry.name) === '쿠지');
  if (!gachaEntry || !kujiEntry) throw new Error('상품사진 폴더에는 가챠와 쿠지 폴더가 모두 있어야 합니다.');
  const kujiPath = join(photoRoot, kujiEntry.name);
  if ((await directoryEntries(kujiPath)).length !== 0) throw new Error('쿠지 사진이 추가되었습니다. 상품 구성표에 먼저 등록해 주세요.');
  const gachaPath = join(photoRoot, gachaEntry.name);
  const planned = [];
  for (const product of products) {
    const parts = product.folder.split('/');
    let folderPath = gachaPath;
    for (const part of parts) folderPath = await resolveNormalizedPath(folderPath, part, true);
    const files = (await directoryEntries(folderPath))
      .filter((entry) => entry.isFile() && imageExtensions.has(extname(entry.name).toLowerCase()))
      .sort((left, right) => normalize(left.name).localeCompare(normalize(right.name), 'ko'));
    const covers = files.filter((entry) => displayName(entry.name).startsWith('메인') && displayName(entry.name) !== '메인 예비');
    const exactCover = covers.find((entry) => displayName(entry.name) === '메인');
    const cover = exactCover ?? (covers.length === 1 ? covers[0] : null);
    if (!cover) throw new Error(`메인 표지 이미지를 하나로 확인할 수 없습니다: ${product.folder}`);
    const prizes = files.filter((entry) => entry.name !== cover.name && !displayName(entry.name).startsWith('메인') && !ignoredPrize(product, entry.name));
    if (!prizes.length) throw new Error(`포함 상품 이미지가 없습니다: ${product.folder}`);
    const names = prizes.map((entry) => displayName(entry.name));
    if (new Set(names).size !== names.length) throw new Error(`포함 상품 이름이 중복됩니다: ${product.folder}`);
    planned.push({
      ...product,
      name: normalize(parts.at(-1)),
      edition: parts.length === 2 ? normalize(parts[0]) : '가챠',
      cover: { path: join(folderPath, cover.name), filename: normalize(cover.name) },
      prizes: prizes.map((entry, index) => ({
        id: `${product.id}-prize-${String(index + 1).padStart(2, '0')}`,
        sku: `${product.sku}-P${String(index + 1).padStart(2, '0')}`,
        name: displayName(entry.name),
        path: join(folderPath, entry.name),
        filename: normalize(entry.name),
      })),
    });
  }
  const actualFolders = [];
  for (const priceEntry of await directoryEntries(gachaPath)) {
    if (!priceEntry.isDirectory()) continue;
    const pricePath = join(gachaPath, priceEntry.name);
    const nested = await directoryEntries(pricePath);
    const imageFiles = nested.filter((entry) => entry.isFile() && imageExtensions.has(extname(entry.name).toLowerCase()));
    if (imageFiles.length) actualFolders.push(normalize(priceEntry.name));
    for (const entry of nested) if (entry.isDirectory()) actualFolders.push(`${normalize(priceEntry.name)}/${normalize(entry.name)}`);
  }
  const expectedFolders = new Set(products.map((product) => normalize(product.folder)));
  const extras = actualFolders.filter((folder) => !expectedFolders.has(folder));
  if (extras.length) throw new Error(`등록표에 없는 상품 폴더가 있습니다: ${extras.join(', ')}`);
  return planned;
}

function serviceRoleKey(projectRef) {
  const result = spawnSync('npx', [
    '--yes', 'supabase@2.117.0', 'projects', 'api-keys', '--project-ref', projectRef,
    '--reveal', '--output', 'json',
  ], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error('Supabase Storage 서버 키를 안전하게 불러오지 못했습니다.');
  const parsed = JSON.parse(result.stdout);
  const keys = Array.isArray(parsed) ? parsed : parsed.api_keys ?? parsed.keys ?? [];
  const row = keys.find((entry) => entry.name === 'service_role');
  const value = row?.api_key ?? row?.key ?? row?.value;
  if (typeof value !== 'string' || value.length < 32) throw new Error('Supabase Storage 서버 키를 확인하지 못했습니다.');
  return value;
}

async function sanitizeImage(image) {
  const source = await readFile(image.path);
  const output = await sharp(source, { animated: false, limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88, effort: 5 })
    .toBuffer({ resolveWithObject: true });
  const checksum = createHash('sha256').update(output.data).digest('hex');
  if (!output.info.width || !output.info.height || output.data.length > 5 * 1024 * 1024) {
    throw new Error(`상품 이미지를 안전한 크기로 변환하지 못했습니다: ${image.filename}`);
  }
  return { ...image, data: output.data, checksum, width: output.info.width, height: output.info.height };
}

async function mapConcurrent(values, concurrency, work) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next++;
      results[index] = await work(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
}

async function uploadImages(plan, storage, bucket, catalogBaseUrl) {
  const flattened = plan.flatMap((product) => [
    { ...product.cover, role: 'cover', productId: product.id },
    ...product.prizes.map((prize) => ({ ...prize, role: 'prize', productId: product.id })),
  ]);
  let completed = 0;
  const uploaded = await mapConcurrent(flattened, 3, async (image) => {
    const sanitized = await sanitizeImage(image);
    const mediaId = randomUUID();
    const objectKey = `media/${mediaId}/${sanitized.checksum}-${randomUUID()}.webp`;
    const stat = await storage.writeFinal(objectKey, sanitized.data, { mediaId, checksumSha256: sanitized.checksum });
    completed += 1;
    if (completed % 10 === 0 || completed === flattened.length) process.stdout.write(`상품 이미지 ${completed}/${flattened.length} 업로드 완료\n`);
    return {
      ...image,
      mediaId,
      objectKey,
      checksum: sanitized.checksum,
      byteSize: stat.size,
      width: sanitized.width,
      height: sanitized.height,
      version: stat.version,
      deliveryUrl: `${catalogBaseUrl}/v1/catalog/media/${mediaId}/image`,
      bucket,
    };
  });
  const byProduct = new Map(plan.map((product) => [product.id, { ...product, prizes: [] }]));
  for (const image of uploaded) {
    const product = byProduct.get(image.productId);
    if (image.role === 'cover') product.cover = image;
    else product.prizes.push(image);
  }
  for (const product of byProduct.values()) product.prizes.sort((left, right) => left.id.localeCompare(right.id));
  return { plan: [...byProduct.values()], uploaded };
}

async function currentCatalog(client) {
  const result = await client.query(
    `SELECT id,name,price,image_url,metadata FROM catalog_products
      WHERE is_active AND NOT is_prize_only ORDER BY id`,
  );
  return result.rows;
}

function currentCatalogMatches(rows, plan, catalogBaseUrl) {
  if (rows.length !== plan.length) return false;
  const expected = new Map(plan.map((product) => [product.id, product]));
  return rows.every((row) => {
    const product = expected.get(row.id);
    return product && row.name === product.name && Number(row.price) === product.price
      && row.metadata?.catalogGeneration === generation
      && typeof row.image_url === 'string' && row.image_url.startsWith(catalogBaseUrl);
  });
}

async function insertMedia(client, image) {
  await client.query(
    `INSERT INTO media_assets
      (id,owner_id,purpose,object_key,original_filename,declared_mime_type,detected_mime_type,
       byte_size,checksum_sha256,status,width,height,metadata)
     VALUES($1,$2,'CATALOG',$3,$4,'image/webp','image/webp',$5,$6,'READY',$7,$8,$9::jsonb)`,
    [
      image.mediaId, catalogOwnerId, image.objectKey, image.filename, image.byteSize, image.checksum,
      image.width, image.height,
      JSON.stringify({
        storage: { provider: 'supabase', bucket: image.bucket, version: image.version },
        catalogDeliveryUrl: image.deliveryUrl,
        catalogGeneration: generation,
        catalogRole: image.role,
        productId: image.productId,
      }),
    ],
  );
}

async function replaceCatalog(client, plan, catalogBaseUrl) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='120s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('dabboba-product-photo-catalog',0))");
    await client.query(
      `INSERT INTO users(id,email,nickname,role,status)
       VALUES($1,'catalog@dabboba.internal','다뽀바 상품관리','ADMIN','ACTIVE')
       ON CONFLICT(id) DO UPDATE SET nickname=EXCLUDED.nickname,role='ADMIN',status='ACTIVE'`,
      [catalogOwnerId],
    );
    await client.query("UPDATE draw_probability_versions SET status='RETIRED' WHERE status='ACTIVE'");
    await client.query("UPDATE catalog_products SET is_active=false,version=version+1 WHERE is_active");
    await client.query("UPDATE catalog_ips SET is_active=false,version=version+1 WHERE is_active");

    for (const [id, [slug, nameKo, nameEn]] of Object.entries(ips)) {
      await client.query(
        `INSERT INTO catalog_ips(id,slug,name_ko,name_en,description,is_active)
         VALUES($1,$2,$3,$4,$5,true)
         ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,name_ko=EXCLUDED.name_ko,name_en=EXCLUDED.name_en,
           description=EXCLUDED.description,is_active=true,version=catalog_ips.version+1`,
        [id, slug, nameKo, nameEn, `${nameKo} 공식 다뽀바 상품 모음`],
      );
    }

    for (const product of plan) {
      const media = [product.cover, ...product.prizes];
      for (const image of media) await insertMedia(client, image);
      const metadata = {
        catalogGeneration: generation,
        edition: product.edition,
        reward: `${product.prizes.length}종 중 1종`,
        includedProductCount: product.prizes.length,
        pricePending: product.price === 0,
      };
      await client.query(
        `INSERT INTO catalog_products
          (id,sku,ip_id,category,name,price,currency,image_url,metadata,is_active,is_prize_only)
         VALUES($1,$2,$3,'gacha',$4,$5,'KRW',$6,$7::jsonb,true,false)
         ON CONFLICT(id) DO UPDATE SET sku=EXCLUDED.sku,ip_id=EXCLUDED.ip_id,category='gacha',name=EXCLUDED.name,
           price=EXCLUDED.price,image_url=EXCLUDED.image_url,metadata=EXCLUDED.metadata,is_active=true,
           version=catalog_products.version+1`,
        [product.id, product.sku, product.ipId, product.name, product.price, product.cover.deliveryUrl, JSON.stringify(metadata)],
      );
      for (const prize of product.prizes) {
        await client.query(
          `INSERT INTO catalog_products
            (id,sku,ip_id,category,name,price,currency,image_url,metadata,is_active,is_prize_only)
           VALUES($1,$2,$3,'gacha',$4,$5,'KRW',$6,$7::jsonb,true,true)
           ON CONFLICT(id) DO UPDATE SET sku=EXCLUDED.sku,ip_id=EXCLUDED.ip_id,category='gacha',name=EXCLUDED.name,
             price=EXCLUDED.price,image_url=EXCLUDED.image_url,metadata=EXCLUDED.metadata,is_active=true,
             version=catalog_products.version+1`,
          [prize.id, prize.sku, product.ipId, prize.name, product.price, prize.deliveryUrl,
            JSON.stringify({ catalogGeneration: generation, parentProductId: product.id })],
        );
      }
      await client.query(
        `INSERT INTO product_stock(product_id,on_hand,reserved)
         VALUES($1,$2,0)
         ON CONFLICT(product_id) DO UPDATE SET on_hand=EXCLUDED.on_hand,reserved=0,version=product_stock.version+1`,
        [product.id, product.prizes.length * 20],
      );
      const version = await client.query(
        `INSERT INTO draw_probability_versions(product_id,version)
         SELECT $1,COALESCE(max(version),0)+1 FROM draw_probability_versions WHERE product_id=$1
         RETURNING id,version`,
        [product.id],
      );
      const probabilityVersionId = version.rows[0].id;
      for (const prize of product.prizes) {
        await client.query(
          `INSERT INTO draw_pool_entries
            (probability_version_id,prize_product_id,prize_name_snapshot,prize_image_url_snapshot,
             prize_sku_snapshot,prize_ip_id_snapshot,prize_category_snapshot,rarity,weight,initial_quantity,remaining_quantity)
           VALUES($1,$2,$3,$4,$5,$6,'gacha','일반',1,20,20)`,
          [probabilityVersionId, prize.id, prize.name, prize.deliveryUrl, prize.sku, product.ipId],
        );
      }
      await client.query(
        `UPDATE draw_probability_versions
         SET status='ACTIVE',published_by=$2,published_at=clock_timestamp()
         WHERE id=$1 AND status='DRAFT'`,
        [probabilityVersionId, catalogOwnerId],
      );
    }
    const active = await currentCatalog(client);
    if (!currentCatalogMatches(active, plan, catalogBaseUrl)) throw new Error('새 상품만 활성화되었는지 확인하지 못했습니다.');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const mode = process.argv[2] ?? '--check';
  if (!['--check', '--apply'].includes(mode)) throw new Error('Usage: sync-product-photo-catalog.mjs [--check|--apply]');
  const plan = await buildPlan();
  const imageCount = plan.reduce((sum, product) => sum + product.prizes.length + 1, 0);
  const edge = parseEnv(await readFile(edgeProfileFile, 'utf8'));
  const app = parseEnv(await readFile(appEnvFile, 'utf8'));
  // Refuse mixed or legacy endpoints before connecting to anything.
  const target = resolvePhotoSyncTarget({
    databaseUrl: edge.DABBOBA_API_DATABASE_URL,
    supabaseUrl: app.SUPABASE_URL,
    s3Endpoint: edge.DABBOBA_STORAGE_S3_ENDPOINT,
  });
  const client = new Client({ connectionString: edge.DABBOBA_API_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let uploaded = [];
  let storage;
  try {
    const current = await currentCatalog(client);
    process.stdout.write(`상품사진 확인: 가챠 ${plan.length}개, 쿠지 0개, 이미지 ${imageCount}개\n`);
    process.stdout.write(`현재 공개 상품: ${current.length}개\n`);
    if (mode === '--check') return;
    if (currentCatalogMatches(current, plan, target.catalogBaseUrl)) {
      process.stdout.write('상품 DB가 현재 상품사진 구성과 이미 일치합니다.\n');
      return;
    }
    storage = new SupabaseMediaStorage({
      url: app.SUPABASE_URL,
      serviceKey: serviceRoleKey(target.projectRef),
      bucket: edge.DABBOBA_STORAGE_BUCKET,
      s3Endpoint: edge.DABBOBA_STORAGE_S3_ENDPOINT,
      s3Region: edge.DABBOBA_STORAGE_S3_REGION,
      s3AccessKeyId: edge.DABBOBA_STORAGE_S3_ACCESS_KEY_ID,
      s3SecretAccessKey: edge.DABBOBA_STORAGE_S3_SECRET_ACCESS_KEY,
    });
    const uploadResult = await uploadImages(plan, storage, edge.DABBOBA_STORAGE_BUCKET, target.catalogBaseUrl);
    uploaded = uploadResult.uploaded;
    await replaceCatalog(client, uploadResult.plan, target.catalogBaseUrl);
    process.stdout.write(`상품 DB 교체 완료: 공개 가챠 ${plan.length}개, 포함 상품 ${plan.reduce((sum, product) => sum + product.prizes.length, 0)}개\n`);
  } catch (error) {
    if (storage && uploaded.length) await Promise.allSettled(uploaded.map((image) => storage.deleteObject(image.objectKey)));
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : '상품 DB 교체에 실패했습니다.'}\n`);
    process.exitCode = 1;
  });
}
