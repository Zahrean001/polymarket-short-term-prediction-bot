import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCohortRegimeGuard } from "../server/risk/cohortRegimeGuard.js";

function settled(id, status, overrides = {}) {
  return {
    id,
    slug: `btc-updown-5m-${id}`,
    botRole: "main_test",
    sourceType: "real_market",
    status,
    officialSettlementUsed: true,
    settlementSource: "official_poly",
    executionStatus: "filled",
    realParityEligible: true,
    learningEligible: true,
    filledStakeUsd: 3,
    paperStakeUsd: 3,
    symbol: "BTC",
    direction: "Up",
    averageFillPrice: 0.60,
    settledAt: new Date(1_780_000_000_000 + Number(id) * 1_000).toISOString(),
    ...overrides,
  };
}

test("two losses in the latest three affect only the matching cohort and only Lane S", () => {
  const signals = [settled(1, "paper_loss"), settled(2, "paper_win"), settled(3, "paper_loss")];
  const guard = evaluateCohortRegimeGuard(signals, { symbol: "BTC", direction: "UP", selectedBuyPrice: 0.61 });
  assert.equal(guard.active, true);
  assert.equal(guard.laneCeiling, "A");
  assert.equal(guard.globalEntryFreeze, false);
  assert.equal(guard.otherCohortsAffected, false);
  const other = evaluateCohortRegimeGuard(signals, { symbol: "SOL", direction: "UP", selectedBuyPrice: 0.61 });
  assert.equal(other.active, false);
  assert.equal(other.laneCeiling, "S");
});

test("cohort downgrade expires after three other official settlements", () => {
  const signals = [
    settled(1, "paper_loss"), settled(2, "paper_win"), settled(3, "paper_loss"),
    settled(4, "paper_win", { symbol: "SOL" }),
    settled(5, "paper_win", { symbol: "SOL" }),
    settled(6, "paper_win", { symbol: "SOL" }),
    settled(7, "paper_win", { symbol: "SOL" }),
  ];
  const guard = evaluateCohortRegimeGuard(signals, { symbol: "BTC", direction: "UP", selectedBuyPrice: 0.61 });
  assert.equal(guard.active, false);
  assert.equal(guard.settlementsSinceTrigger, 4);
});
