import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMainAccuracyLane } from "../server/prediction/mainAccuracyLane.js";
import { simulateMarketableBuy } from "../server/execution/paperFill.js";

function validLane() {
  return {
    symbol: "BTC",
    timeframe: "5M",
    predictedOutcome: "Up",
    confidence: 85,
    selectedBuyPrice: 0.75,
    secondsIntoWindow: 60,
    currentSource: "polymarket_chainlink_rtds",
    currentPriceAgeMs: 100,
    targetSource: "polymarket_chainlink_rtds_window_open_bounded",
    bookSource: "ws_snapshot+ws_delta",
    bookAgeMs: 100,
    independentProbabilityModel: { available: true, assetProbabilityUp: 0.90 },
  };
}

test("main accuracy lane fails closed for every missing critical field", () => {
  const criticalFields = [
    "symbol", "timeframe", "predictedOutcome", "confidence", "selectedBuyPrice", "secondsIntoWindow",
    "currentSource", "currentPriceAgeMs", "targetSource", "bookSource", "bookAgeMs",
    "independentProbabilityModel",
  ];
  for (const field of criticalFields) {
    for (const missing of [undefined, null, ""]) {
      const candidate = validLane();
      candidate[field] = missing;
      assert.equal(evaluateMainAccuracyLane(candidate).eligible, false, `${field}=${String(missing)} must fail closed`);
    }
  }
});

test("FAK property checks never invent depth or exceed the slippage limit", () => {
  let seed = 0x3731;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const best = 0.10 + random() * 0.70;
    const asks = Array.from({ length: 5 }, (_, index) => ({
      price: Math.min(0.99, best + index * 0.005),
      size: random() * 20,
    }));
    const intendedStakeUsd = 0.1 + random() * 20;
    const fill = simulateMarketableBuy({ asks, intendedStakeUsd, orderType: "FAK", maxSlippageCents: 1, feeRate: 0.07 });
    assert.ok(fill.filledStakeUsd <= intendedStakeUsd + 1e-7);
    assert.ok(fill.filledShares <= asks.reduce((sum, level) => sum + level.size, 0) + 1e-7);
    assert.ok(fill.slippageCents <= 1 + 1e-7);
    assert.ok(fill.takerFeeUsd >= 0);
    if (fill.executionStatus === "unfilled") assert.equal(fill.realParityEligible, false);
  }
});

test("profitability ceiling can be used as a real marketable-limit cap", () => {
  const fill = simulateMarketableBuy({
    asks: [
      { price: 0.790, size: 1 },
      { price: 0.800, size: 1 },
      { price: 0.810, size: 100 },
    ],
    intendedStakeUsd: 6.5,
    orderType: "FAK",
    maxSlippageCents: 1,
    limitPrice: 0.80,
    feeRate: 0.07,
  });
  assert.ok(fill.worstFillPrice <= 0.80);
  assert.ok(fill.averageFillPrice <= 0.80);
  assert.ok(fill.filledStakeUsd < 6.5);
  assert.equal(fill.executionStatus, "partial_fill");
});
