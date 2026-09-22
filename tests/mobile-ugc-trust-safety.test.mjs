import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("exchange, wanted, and dukroom details expose report and block actions", async () => {
  const [exchange, wanted, dukroom, actions] = await Promise.all([
    source("apps/mobile/src/features/exchange/ExchangeListingDetailScreen.tsx"),
    source("apps/mobile/src/features/profile/WantedRequestDetailScreen.tsx"),
    source("apps/mobile/src/features/dukroom/DukroomDetailScreen.tsx"),
    source("apps/mobile/src/features/trust-safety/UgcSafetyActions.tsx"),
  ]);

  assert.match(exchange, /targetType="EXCHANGE_LISTING"/);
  assert.match(exchange, /setDetail\(null\)/);
  assert.match(wanted, /targetType="WANTED_REQUEST"/);
  assert.match(wanted, /wantedRequests\.filter\(\(item\) => item\.userId !== request\.userId\)/);
  assert.match(dukroom, /targetType=\{item\.post\.kind === "SNAP" \? "SNAP" : "POST"\}/);
  assert.match(dukroom, /targetType="COMMENT"/);
  assert.match(dukroom, /comments\.filter\(\(commentItem\) => commentItem\.authorId !== entry\.authorId\)/);
  assert.match(actions, /콘텐츠 신고/);
  assert.match(actions, /작성자 차단/);
  assert.match(actions, /await blockCommunityUser/);
  assert.match(actions, /onBlocked\(\)/);
});

test("every customer UGC creation path requires recorded operations-policy acceptance", async () => {
  const paths = [
    "apps/mobile/src/features/exchange/ExchangeCreateScreen.tsx",
    "apps/mobile/src/features/exchange/ExchangeOfferScreen.tsx",
    "apps/mobile/src/features/profile/WantedRequestCreateScreen.tsx",
    "apps/mobile/src/features/dukroom/DukroomDetailScreen.tsx",
  ];
  for (const path of paths) {
    const contents = await source(path);
    assert.match(contents, /ensureUgcOperationsPolicyAcceptance/);
    assert.match(contents, /if \(!accepted\) return;/);
    assert.match(contents, /\/legal\/exchange-request/);
  }
});

test("authenticated exchange discovery does not reuse a cross-account offline cache", async () => {
  const room = await source("apps/mobile/src/features/exchange/ExchangeRoomScreen.tsx");
  assert.match(room, /tokens\?\.accessToken/);
  assert.match(room, /if \(!tokens && !debouncedQuery\) await writeExchangeListingCache/);
  assert.match(room, /if \(tokens\) \{[\s\S]*setSnapshot\(null\)/);
});

test("the first-release customer policy does not advertise the disabled dukroom surface", async () => {
  const [mobilePolicy, publicPolicy] = await Promise.all([
    source("apps/mobile/src/features/profile/profile-policies.ts"),
    source("public/legal/community-operations/index.html"),
  ]);

  assert.match(mobilePolicy, /title: "교환방·신청방 운영정책"/);
  assert.doesNotMatch(mobilePolicy, /heading: "덕룸"/);
  assert.match(publicPolicy, /교환방·신청방 운영정책/);
  assert.doesNotMatch(publicPolicy, /덕룸에는/);
});
