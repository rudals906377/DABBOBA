import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DabbobaApiClient } from "../src/services/dabbobaApi.ts";

const prototypeSource = readFileSync(new URL("../src/Prototype.tsx", import.meta.url), "utf8");

test("remote snapshot loads the public character catalog", async () => {
  const calls = [];
  const character = {
    id: "11111111-1111-4111-8111-111111111111",
    ipId: "one-piece",
    name: "몽키 D. 루피",
    aliases: ["루피"],
    imageUrl: null,
    isActive: true,
    version: 1,
    createdAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T00:00:00.000Z",
  };
  const client = new DabbobaApiClient({
    configuration: { mode: "remote", baseUrl: "https://api.dabboba.test", token: null },
    fetch: async (url) => {
      calls.push(new URL(url).pathname);
      return Response.json({
        items: url.includes("/catalog/characters") ? [character] : [],
        nextCursor: null,
      });
    },
  });

  const snapshot = await client.loadSnapshot();

  assert.deepEqual(snapshot.characters, [character]);
  assert.ok(calls.includes("/v1/catalog/characters"));
  assert.deepEqual(snapshot.failures, {});
});

test("remote IP records derive character names from server data", () => {
  assert.match(prototypeSource, /snapshot\.characters \?\? \[\]/);
  assert.match(prototypeSource, /remoteCharacters[\s\S]*?character\.ipId === item\.id[\s\S]*?character\.name/);
  assert.match(prototypeSource, /등록된 캐릭터가 없습니다/);
});

test("native bridge rejects cross-origin window messages and remote draw inventory keeps catalog identity", () => {
  assert.match(prototypeSource, /event\.currentTarget === window && event\.origin !== window\.location\.origin/);
  assert.match(prototypeSource, /serverResult \? `catalog-\$\{serverResult\.prizeProductId\}`/);
});
