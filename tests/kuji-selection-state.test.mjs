import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateKujiRemainingByRarity,
  buildKujiPaymentConfirmation,
  buildKujiPreviewParams,
  createKujiTicketNumbers,
  formatKujiRarityLabel,
  KUJI_EXAMPLE_REMAINING,
  parseKujiTicketNumbers,
  resolveKujiOpenStep,
  toggleKujiTicketSelection,
} from "../apps/mobile/src/features/kuji/kuji-selection-state.ts";

test("the kuji board exposes exactly 50 stable ticket numbers", () => {
  const tickets = createKujiTicketNumbers();

  assert.equal(tickets.length, 50);
  assert.equal(new Set(tickets).size, 50);
  assert.deepEqual(tickets.slice(0, 3), ["01", "02", "03"]);
  assert.deepEqual(tickets.slice(8, 11), ["09", "10", "11"]);
  assert.equal(tickets.at(-1), "50");
});

test("ticket selection remains numeric, unique, and reversible", () => {
  let selected = [];
  selected = toggleKujiTicketSelection(selected, "01");
  selected = toggleKujiTicketSelection(selected, "50");
  selected = toggleKujiTicketSelection(selected, "07");
  selected = toggleKujiTicketSelection(selected, "07");

  assert.deepEqual(selected, ["01", "50"]);
});

test("ticket route parsing keeps valid operator-configured slot identities", () => {
  const tickets = parseKujiTicketNumbers("01,09,10,50,50,00,51,x");

  assert.deepEqual(tickets, ["01", "09", "10", "50", "51"]);
  assert.deepEqual(buildKujiPreviewParams(tickets, "all"), {
    mode: "all",
    count: "5",
    tickets: "01,09,10,50,51",
  });
});

test("the payment confirmation derives the 50-ticket total from unit price", () => {
  const tickets = createKujiTicketNumbers();
  const confirmation = buildKujiPaymentConfirmation(9_900, tickets);

  assert.deepEqual(confirmation, {
    count: 50,
    total: 495_000,
    message: "50장 · 495,000원",
  });
});

test("the footer summary derives zero and multi-ticket totals from the same price", () => {
  assert.deepEqual(buildKujiPaymentConfirmation(9_900, []), {
    count: 0,
    total: 0,
    message: "0장 · 0원",
  });
  assert.deepEqual(buildKujiPaymentConfirmation(9_900, ["01", "02", "03"]), {
    count: 3,
    total: 29_700,
    message: "3장 · 29,700원",
  });
});

test("every positive kuji selection enters the sequential reveal directly", () => {
  assert.equal(resolveKujiOpenStep(0), "blocked");
  assert.equal(resolveKujiOpenStep(1), "direct-open");
  assert.equal(resolveKujiOpenStep(2), "direct-open");
  assert.equal(resolveKujiOpenStep(50), "direct-open");
});

test("remaining prize counts are grouped by the server-provided tier order", () => {
  const remaining = aggregateKujiRemainingByRarity([
    { rarity: "S", remainingQuantity: 1 },
    { rarity: "A", remainingQuantity: 2 },
    { rarity: "S", remainingQuantity: 2 },
    { rarity: "B", remainingQuantity: null },
  ]);

  assert.deepEqual(remaining, [
    { rarity: "S", remainingQuantity: 3 },
    { rarity: "A", remainingQuantity: 2 },
    { rarity: "B", remainingQuantity: null },
  ]);
  assert.equal(formatKujiRarityLabel("S"), "S상");
  assert.equal(formatKujiRarityLabel("A상"), "A상");
  assert.equal(
    KUJI_EXAMPLE_REMAINING.reduce((sum, item) => sum + (item.remainingQuantity ?? 0), 0),
    44,
  );
  assert.equal(Object.isFrozen(KUJI_EXAMPLE_REMAINING), true);
});
