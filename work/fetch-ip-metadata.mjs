import { writeFile } from "node:fs/promises";

const endpoint = "https://kitsu.io/api/edge/anime";

const requested = [
  ["one-piece", "원피스", "One Piece"],
  ["dragon-ball", "드래곤볼", "Dragon Ball"],
  ["demon-slayer", "귀멸의 칼날", "Kimetsu no Yaiba"],
  ["jujutsu-kaisen", "주술회전", "Jujutsu Kaisen"],
  ["naruto", "나루토", "Naruto"],
  ["bleach", "블리치", "Bleach"],
  ["my-hero-academia", "나의 히어로 아카데미아", "Boku no Hero Academia"],
  ["hunter-x-hunter", "헌터×헌터", "Hunter x Hunter (2011)"],
  ["chainsaw-man", "체인소 맨", "Chainsaw Man"],
  ["attack-on-titan", "진격의 거인", "Shingeki no Kyojin"],
  ["jojos-bizarre-adventure", "죠죠의 기묘한 모험", "JoJo no Kimyou na Bouken (TV)"],
  ["spy-x-family", "스파이 패밀리", "SPY x FAMILY"],
  ["haikyu", "하이큐!!", "Haikyuu!!"],
  ["blue-lock", "블루 록", "Blue Lock"],
  ["oshi-no-ko", "최애의 아이", "[Oshi no Ko]"],
  ["frieren", "장송의 프리렌", "Sousou no Frieren"],
  ["cyberpunk-edgerunners", "사이버펑크: 엣지러너", "Cyberpunk: Edgerunners"],
  ["dandadan", "단다단", "Dandadan"],
  ["kaiju-no-8", "괴수 8호", "Kaijuu 8-gou"],
  ["evangelion", "신세기 에반게리온", "Neon Genesis Evangelion"],
  ["mobile-suit-gundam", "기동전사 건담", "Mobile Suit Gundam"],
  ["pokemon", "포켓몬스터", "Pokemon"],
  ["detective-conan", "명탐정 코난", "Detective Conan"],
  ["tokyo-revengers", "도쿄 리벤저스", "Tokyo Revengers"],
  ["that-time-i-got-reincarnated-as-a-slime", "전생했더니 슬라임이었던 건에 대하여", "Tensei Shitara Slime Datta Ken"],
];

const results = [];
for (const [slug, nameKo, search] of requested) {
  const url = new URL(endpoint);
  url.searchParams.set("filter[text]", search);
  url.searchParams.set("page[limit]", "1");
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.api+json" },
  });
  if (!response.ok) throw new Error(`${nameKo}: Kitsu ${response.status}`);
  const payload = await response.json();
  const media = payload.data?.[0];
  if (!media) throw new Error(`${nameKo}: no Kitsu result`);
  const attributes = media.attributes;
  results.push({
    slug,
    nameKo,
    search,
    kitsuId: media.id,
    sourceUrl: `https://kitsu.io/anime/${attributes.slug}`,
    canonicalTitle: attributes.canonicalTitle,
    titles: attributes.titles,
    abbreviatedTitles: attributes.abbreviatedTitles,
    synopsis: attributes.synopsis,
    posterImage: attributes.posterImage,
    coverImage: attributes.coverImage,
  });
  await new Promise((resolve) => setTimeout(resolve, 360));
}

await writeFile("work/ip-source-records.json", `${JSON.stringify(results, null, 2)}\n`, "utf8");
console.table(results.map(({ slug, nameKo, kitsuId, sourceUrl, canonicalTitle }) => ({ slug, nameKo, kitsuId, canonicalTitle, sourceUrl })));
