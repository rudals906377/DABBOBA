import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const project = process.cwd();
const resolver = "/Users/kyoungmin/.codex/skills/media-use/scripts/resolve.mjs";
const researchFiles = [
  "work/research/gacha-products.json",
  "work/research/figure-products.json",
  "work/research/kuji-products.json",
  "work/research/card-products.json",
];
const expectedCounts = { gacha: 8, figure: 8, kuji: 7, tcg: 2 };
const labels = { gacha: "가챠", figure: "피규어", kuji: "쿠지", tcg: "카드" };
const editions = { gacha: "CAPSULE 01", figure: "FIGURE 01", kuji: "KUJI 01", tcg: "TCG 01" };
const rewards = {
  gacha: "랜덤 캡슐 굿즈",
  figure: "컬렉터 피규어",
  kuji: "랜덤 쿠지 경품",
  tcg: "랜덤 카드팩",
};

const ips = JSON.parse(await readFile("src/fixtures/ip-seed.json", "utf8"));
const ipById = new Map(ips.map((ip, index) => [ip.id, { ...ip, index }]));
const loadedResearch = await Promise.all(
  researchFiles.map(async (file) => JSON.parse(await readFile(file, "utf8"))),
);
const research = loadedResearch.flatMap((value) => {
  if (Array.isArray(value)) return value;
  if (!Array.isArray(value.products)) throw new Error("Unknown research file schema");

  return value.products.map((product) => ({
    ipId: product.ipSlug,
    categoryId: value.category,
    title: product.testProductNameKo,
    description: product.descriptionKo,
    price: product.recommendedPriceWon,
    stock: product.recommendedStock,
    imageUrl: product.publicImageUrl,
    sourcePage: product.sourcePageUrl,
    sourceTitle: product.sourceProductName,
    usageNote: [value.rightsNotice, product.rightsCaution].filter(Boolean).join(" "),
  }));
});

if (research.length !== ips.length) {
  throw new Error(`Expected ${ips.length} researched products, received ${research.length}`);
}

const uniqueIpIds = new Set(research.map((product) => product.ipId));
if (uniqueIpIds.size !== research.length) throw new Error("Every IP must have exactly one product");

for (const ip of ips) {
  if (!uniqueIpIds.has(ip.id)) throw new Error(`Missing product for ${ip.id}`);
}

for (const [categoryId, expected] of Object.entries(expectedCounts)) {
  const actual = research.filter((product) => product.categoryId === categoryId).length;
  if (actual !== expected) throw new Error(`${categoryId}: expected ${expected}, received ${actual}`);
}

const outputDirectory = resolve(project, "public/assets/dabboba/products/ip");
await mkdir(outputDirectory, { recursive: true });

const products = [];
const sources = [];
for (const product of research.sort((a, b) => ipById.get(a.ipId).index - ipById.get(b.ipId).index)) {
  const ip = ipById.get(product.ipId);
  if (!ip) throw new Error(`Unknown IP: ${product.ipId}`);

  const intent = `${ip.nameEn} ${labels[product.categoryId]} product reference for DABBOBA temporary prototype`;
  const result = spawnSync(
    process.execPath,
    [
      resolver,
      "--type", "image",
      "--intent", intent,
      "--entity", `${product.ipId}-${product.categoryId}`,
      "--from", product.imageUrl,
      "--project", project,
      "--json",
    ],
    { cwd: project, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`${ip.nameKo}: ${result.stderr || result.stdout}`);
  }

  const resolvedAsset = JSON.parse(result.stdout.trim());
  const rawExtension = extname(resolvedAsset.path).toLowerCase();
  const extension = rawExtension === ".jpeg" ? ".jpg" : rawExtension || ".jpg";
  const fileName = `${product.ipId}${extension}`;
  const publicPath = resolve(outputDirectory, fileName);
  await copyFile(resolve(project, resolvedAsset.path), publicPath);

  const asset = `/assets/dabboba/products/ip/${fileName}`;
  products.push({
    id: `${product.ipId}-${product.categoryId}`,
    ipId: product.ipId,
    categoryId: product.categoryId,
    line: ip.nameKo,
    title: product.title,
    description: product.description,
    price: product.price,
    stock: product.stock,
    asset,
    edition: editions[product.categoryId],
    reward: product.reward ?? `${ip.nameKo} ${rewards[product.categoryId]}`,
    sourcePage: product.sourcePage,
  });
  sources.push({
    id: product.ipId,
    nameKo: ip.nameKo,
    categoryId: product.categoryId,
    category: labels[product.categoryId],
    file: asset,
    sourceTitle: product.sourceTitle,
    sourcePage: product.sourcePage,
    sourceImage: product.imageUrl,
    usage: product.usageNote,
  });
  console.log(`${ip.nameKo} · ${labels[product.categoryId]} -> ${fileName}`);
}

await writeFile("src/fixtures/product-seed.json", `${JSON.stringify(products, null, 2)}\n`, "utf8");
await writeFile(
  resolve(outputDirectory, "sources.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), count: sources.length, sources }, null, 2)}\n`,
  "utf8",
);
