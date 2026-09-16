import test from "node:test";
import assert from "node:assert/strict";
import { classifyFastGrowEv, sizeFastGrowStake } from "../server/prediction/fastGrowEvPolicy.js";
import { reconcileFastGrowObservedFill } from "../server/execution/fastGrowFillReconciler.js";
import { applyOptionalUsdHardCap, computeDynamicEquityTradeCap } from "../server/execution/equityCompoundingPolicy.js";
import { simulateMarketableBuy } from "../server/execution/paperFill.js";

const CONFIG = {
  minNetEdge: 0.05,
  laneSMinNetEdge: 0.10,
  laneAMinFraction: 0.08,
  laneAMaxFraction: 0.10,
  laneSMinFraction: 0.12,
  laneSMaxFraction: 0.15,
  laneSMaxEdge: 0.20,
  depthUtilization: 1,
};

function calibrated(netEdge, overrides = {}) {
  return {
    eligible: true,
    reason: "calibrated_net_ev_ready",
    netEdge,
    calibratedProbability: 0.80,
    ...overrides,
  };
}

function sized(netEdge, overrides = {}) {
  const policy = classifyFastGrowEv(calibrated(netEdge), CONFIG);
  return sizeFastGrowStake({
    policy,
    calibratedNetEv: calibrated(netEdge),
    equity: 40,
    entryPrice: 0.60,
    depthShares: 1_000,
    maxTradeUsd: 8,
    minimumOrderShares: 5,
    minimumRecordedFillUsd: 1,
    ...overrides,
  }, CONFIG);
}

test("net-EV below five cents remains observe-only and receives zero stake", () => {
  const policy = classifyFastGrowEv(calibrated(0.049999), CONFIG);
  assert.equal(policy.executable, false);
  assert.equal(policy.lane, "OBSERVE");
  assert.equal(sizeFastGrowStake({ policy, equity: 40, entryPrice: 0.60, depthShares: 100, maxTradeUsd: 8 }, CONFIG).stakeUsd, 0);
});

test("lane A compounds from eight to ten percent of current realized equity", () => {
  const floor = sized(0.05);
  const ceiling = sized(0.099999);
  assert.equal(floor.lane, "A");
  assert.ok(Math.abs(floor.stakeUsd - 3.2) < 1e-9);
  assert.ok(ceiling.stakeUsd > 3.99 && ceiling.stakeUsd < 4.01);
});

test("lane S remains proportional through equity 100 and 200", () => {
  const at40 = sized(0.20, { equity: 40, maxTradeUsd: 8 });
  const at100 = sized(0.20, { equity: 100, maxTradeUsd: 15 });
  const at200 = sized(0.20, { equity: 200, maxTradeUsd: 30 });
  assert.equal(at40.stakeUsd, 6);
  assert.equal(at100.stakeUsd, 15);
  assert.equal(at200.stakeUsd, 30);
  assert.equal(at40.stakeToEquityPct, 15);
  assert.equal(at100.stakeToEquityPct, 15);
  assert.equal(at200.stakeToEquityPct, 15);
});

test("V374.4 dynamic cap has no fixed-dollar plateau across six equity scales", () => {
  for (const equity of [40, 100, 200, 1_000, 10_000, 1_000_000]) {
    const result = computeDynamicEquityTradeCap({
      equity,
      lane: "S",
      scalingEnabled: true,
      scalingStartEquity: 40,
      baseTradeUsd: 8,
      maxTradeEquityFraction: 0.15,
      minimumExecutableStakeUsd: 3,
      laneScaledBaseCapUsd: 8,
      hardCapUsd: 0,
    });
    const expected = Math.max(8, equity * 0.15);
    assert.equal(result.capUsd, expected);
    assert.equal(result.staticUsdHardCapEnabled, false);
    assert.equal(result.capUsd / equity, equity === 40 ? 0.2 : 0.15);
  }
});

test("zero hard-cap sentinel disables only the fixed USD ceiling", () => {
  assert.equal(applyOptionalUsdHardCap(150_000, 0), 150_000);
  assert.equal(applyOptionalUsdHardCap(150_000, 80), 80);
  const result = computeDynamicEquityTradeCap({
    equity: 1_000,
    lane: "S",
    scalingEnabled: true,
    scalingStartEquity: 40,
    baseTradeUsd: 8,
    maxTradeEquityFraction: 0.15,
    minimumExecutableStakeUsd: 3,
    laneScaledBaseCapUsd: 8,
    hardCapUsd: 0,
  });
  assert.equal(result.capUsd, 150);
  assert.ok(result.capUsd <= result.equity);
});

test("drawdown changes dollars but preserves the same proportional growth rate", () => {
  const capAtAth = computeDynamicEquityTradeCap({
    equity: 180,
    lane: "S",
    scalingEnabled: true,
    scalingStartEquity: 40,
    baseTradeUsd: 8,
    maxTradeEquityFraction: 0.15,
    minimumExecutableStakeUsd: 3,
    hardCapUsd: 0,
  });
  const capAfterDrawdown = computeDynamicEquityTradeCap({
    equity: 100,
    lane: "S",
    scalingEnabled: true,
    scalingStartEquity: 40,
    baseTradeUsd: 8,
    maxTradeEquityFraction: 0.15,
    minimumExecutableStakeUsd: 3,
    hardCapUsd: 0,
  });
  assert.equal(capAtAth.capUsd, 27);
  assert.equal(capAfterDrawdown.capUsd, 15);
  assert.equal(capAtAth.capUsd / 180, 0.15);
  assert.equal(capAfterDrawdown.capUsd / 100, 0.15);
});

test("sizing is based on current equity, not ATH, so it is not martingale", () => {
  const beforeDrawdown = sized(0.20, { equity: 120, maxTradeUsd: 18 });
  const afterDrawdown = sized(0.20, { equity: 90, maxTradeUsd: 13.5 });
  assert.equal(beforeDrawdown.stakeUsd, 18);
  assert.equal(afterDrawdown.stakeUsd, 13.5);
  assert.ok(afterDrawdown.stakeUsd < beforeDrawdown.stakeUsd);
});

test("depth, equity, cap, and market minimum are hard execution constraints", () => {
  const depthCapped = sized(0.20, { equity: 100, maxTradeUsd: 20, depthShares: 10, entryPrice: 0.60 });
  assert.equal(depthCapped.stakeUsd, 6);
  const marketMinimumBlocked = sized(0.05, { entryPrice: 0.80, minimumOrderShares: 5 });
  assert.equal(marketMinimumBlocked.stakeUsd, 3.2);
  assert.equal(marketMinimumBlocked.executable, false);
  assert.equal(marketMinimumBlocked.reason, "fastgrow_stake_below_market_minimum");
});

test("property: recommended stake never exceeds current equity, cap, or visible depth", () => {
  for (const equity of [3, 10, 40, 100, 200, 1_000]) {
    for (const maxTradeUsd of [2, 8, 15, 30, 80]) {
      for (const depthShares of [1, 10, 1_000]) {
        const result = sized(0.20, { equity, maxTradeUsd, depthShares, entryPrice: 0.65, minimumOrderShares: 1 });
        assert.ok(result.stakeUsd <= equity + 1e-9);
        assert.ok(result.stakeUsd <= maxTradeUsd + 1e-9);
        assert.ok(result.stakeUsd <= depthShares * 0.65 + 1e-9);
      }
    }
  }
});

test("weighted fill demotion from lane S to A reconciles stake downward", () => {
  const preliminary = sized(0.102, { equity: 100, maxTradeUsd: 15, entryPrice: 0.58 });
  assert.equal(preliminary.lane, "S");
  const result = reconcileFastGrowObservedFill({
    asks: [{ price: 0.58, size: 1 }, { price: 0.59, size: 1_000 }],
    intendedStakeUsd: preliminary.stakeUsd,
    orderType: "FAK",
    maxSlippageCents: 1,
    limitPrice: 0.59,
    feeRate: 0.07,
    minimumOrderShares: 1,
    minimumRecordedFillUsd: 1,
    tickSize: 0.01,
    rawConfidence: 90,
    assetProbability: 0.75,
    secondsIntoWindow: 100,
    equity: 100,
    depthShares: 1_001,
    maxTradeUsd: 15,
  }, CONFIG);
  assert.equal(result.executable, true);
  assert.equal(result.policy.lane, "A");
  assert.ok(result.iterations > 1);
  assert.ok(result.paperFill.filledStakeUsd <= result.sizing.stakeUsd + 1e-7);
  assert.ok(result.paperFill.filledStakeUsd < preliminary.stakeUsd);
});

test("final weighted fill that loses the edge is rejected and never recorded", () => {
  const result = reconcileFastGrowObservedFill({
    asks: [{ price: 0.58, size: 1 }, { price: 0.64, size: 1_000 }],
    intendedStakeUsd: 12,
    orderType: "FAK",
    maxSlippageCents: 6,
    limitPrice: 0.64,
    feeRate: 0.07,
    minimumOrderShares: 1,
    minimumRecordedFillUsd: 1,
    tickSize: 0.01,
    rawConfidence: 90,
    assetProbability: 0.75,
    secondsIntoWindow: 100,
    equity: 100,
    depthShares: 1_001,
    maxTradeUsd: 15,
  }, CONFIG);
  assert.equal(result.executable, false);
  assert.equal(result.policy.executable, false);
});

test("paper taker fee follows the official crypto curve and five-decimal USDC precision", () => {
  const fill = simulateMarketableBuy({
    asks: [{ price: 0.51, size: 1 }],
    intendedStakeUsd: 0.51,
    orderType: "FAK",
    maxSlippageCents: 0,
    limitPrice: 0.51,
    feeRate: 0.07,
    minimumOrderShares: 1,
    tickSize: 0.01,
  });
  assert.equal(fill.takerFeeUsd, 0.01749);
});
