import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findWantedIpSuggestions,
  resolveWantedIpSelection,
} from "../apps/mobile/src/features/profile/wanted-request-ip.ts";

const REGISTERED_IPS = [
  { id: "spy-family", nameKo: "스파이 패밀리", nameEn: "SPY x FAMILY", nameJa: null, aliases: ["스파패"] },
  { id: "tokyo-revengers", nameKo: "도쿄 리벤저스", nameEn: "Tokyo Revengers", nameJa: "東京リベンジャーズ", aliases: ["도리벤"] },
  { id: "slime", nameKo: "전생했더니 슬라임이었던 건에 대하여", nameEn: "That Time I Got Reincarnated as a Slime", nameJa: null, aliases: ["전생슬"] },
];

test("registered IP suggestions match canonical names and aliases while keeping exact matches first", () => {
  assert.deepEqual(
    findWantedIpSuggestions(REGISTERED_IPS, "  도리벤  ").map(({ id }) => id),
    ["tokyo-revengers"],
  );
  assert.equal(findWantedIpSuggestions(REGISTERED_IPS, "spy")[0]?.id, "spy-family");
  assert.equal(findWantedIpSuggestions(REGISTERED_IPS, "東京")[0]?.id, "tokyo-revengers");
});

test("the typed work stays valid when it is not a registered IP", () => {
  assert.deepEqual(resolveWantedIpSelection(REGISTERED_IPS, "스파이 패밀리"), {
    ipId: "spy-family",
    ipNameKo: "스파이 패밀리",
  });
  assert.deepEqual(resolveWantedIpSelection(REGISTERED_IPS, "아직 등록되지 않은 작품"), {
    ipId: null,
    ipNameKo: "아직 등록되지 않은 작품",
  });
});
