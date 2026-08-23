import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const project = process.cwd();
const records = JSON.parse(await readFile("work/ip-source-records.json", "utf8"));
const resolver = "/Users/kyoungmin/.codex/skills/media-use/scripts/resolve.mjs";
const outputDirectory = resolve(project, "public/assets/dabboba/ips");
await mkdir(outputDirectory, { recursive: true });

const sources = [];
for (const record of records) {
  const englishName = record.titles.en ?? record.titles.en_jp ?? record.canonicalTitle;
  const intent = `${englishName} IP poster for temporary DABBOBA prototype`;
  const imageUrl = record.posterImage.large;
  const result = spawnSync(
    process.execPath,
    [resolver, "--type", "image", "--intent", intent, "--entity", record.slug, "--from", imageUrl, "--project", project, "--json"],
    { cwd: project, encoding: "utf8" },
  );

  if (result.status !== 0) {
    throw new Error(`${record.nameKo}: ${result.stderr || result.stdout}`);
  }

  const resolvedAsset = JSON.parse(result.stdout.trim());
  const extension = extname(resolvedAsset.path) || ".jpg";
  const fileName = `${record.slug}${extension === ".jpeg" ? ".jpg" : extension}`;
  const publicPath = resolve(outputDirectory, fileName);
  await copyFile(resolve(project, resolvedAsset.path), publicPath);
  sources.push({
    id: record.slug,
    nameKo: record.nameKo,
    file: `/assets/dabboba/ips/${fileName}`,
    sourcePage: record.sourceUrl,
    sourceImage: imageUrl,
    provider: "Kitsu",
    usage: "temporary local prototype only; replace with licensed official assets before production",
  });
  console.log(`${record.nameKo} -> ${fileName}`);
}

await writeFile(
  resolve(outputDirectory, "sources.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), count: sources.length, sources }, null, 2)}\n`,
  "utf8",
);
