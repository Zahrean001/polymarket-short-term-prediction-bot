import test from "node:test";
import assert from "node:assert/strict";
import { buildStrategyCandidates, evaluateStrategyRouter } from "../server/strategies/strategyRouter.js";
import { isPrimaryPaperSignal } from "../server/metrics/primaryPaperSignal.js";
import { createCheckpointObserver } from "../server/research/checkpointObserver.js";

function livePrediction(overrides = {}) {
  return {
    status: "live", symbol: "BTC", timeframe: "5M", predictedOutcome: "Up",
    confidence: 95, selectedProbability: 0.95, probabilityUp: 0.90, probabilityDown: 0.10,
    selectedBuyPrice: 0.70, selectedBidPrice: 0.69,
    upBuyPrice: 0.70, upBidPrice: 0.69, downBuyPrice: 0.31, downBidPrice: 0.30,
    upDepthShares: 100, downDepthShares: 100,
    upDepthPressure: 0.25, downDepthPressure: -0.25,
    upMicropriceEdgeCents: 0.05, downMicropriceEdgeCents: -0.05,
    upAskSlopeCents: 1, downAskSlopeCents: 1,
    feeEstimate: 0.0147, yesNoAskCost: 1.01, bookAgeMs: 100,
    bookSource: "ws_delta+ws_delta", secondsIntoWindow: 100, timeLeftSec: 200,
    stableTicks: 1, signals: [], ...overrides,
  };
}

function config() {
  return {
    currentPredictionEnabled: false, priceFieldEnabled: false, dualSideEnabled: true,
    orderbookPressureEnabled: false, stickyLagEnabled: false, newMemberBandEnabled: false,
    endcycleSniperEnabled: false, completeSetArbEnabled: false,
    executableStrategies: ["dual_side_ev"], strategyForceAllow: ["dual_side_ev"], strategyForceBlock: ["current_prediction"],
    strategyAutoDisableEnabled: false, strategyRuntimeAutoDisableEnabled: false,
    candidateQualityEnabled: true, executionQualityEnabled: false,
    replayOptimizer: { enabled: false }, replayOptimizerActionMode: "shadow", runtimeRuleCacheEnabled: false,
    softQualityMode: true, noEntryReductionMode: true, noStakeReductionMode: true, noBlockQualityCandidates: true,
    requireRealMarketData: true, blockSyntheticBook: true, blockLearningFallback: true,
    maxBookAgeMs: 1500, minSecondsIntoWindow: 75, maxSecondsIntoWindow: 179,
    minSecondsLeft: 5, maxEntryPrice: 0.85, maxSpreadCents: 20, maxYesNoAskCost: 1.50, maxCandidates: 12,
  };
}

test("fast-grow router produces real dual-side candidates and deterministically selects one", () => {
  const candidates = buildStrategyCandidates(livePrediction(), config()).filter((row) => row.strategy === "dual_side_ev");
  assert.equal(candidates.length, 2);
  const decision = evaluateStrategyRouter({ prediction: livePrediction(), accountRisk: { activePositions: 0, positionsThisWindow: 0 }, config: config() });
  assert.equal(decision.selected?.strategy, "dual_side_ev");
  assert.ok(["UP", "DOWN"].includes(decision.selected?.side));
});

test("headline signal requires frozen calibration and a real observed fill", () => {
  const signal = {
    botRole: "main_test", mainAccuracyLane: { eligible: true }, calibratedNetEv: { eligible: true },
    calibrationProfileId: "frozen-profile", realParityEligible: true, executionStatus: "filled",
    sourceType: "real_market", filledStakeUsd: 3,
  };
  assert.equal(isPrimaryPaperSignal(signal), true);
  assert.equal(isPrimaryPaperSignal({ ...signal, calibratedNetEv: null }), false);
  assert.equal(isPrimaryPaperSignal({ ...signal, executionStatus: "unfilled", filledStakeUsd: 0 }), false);
  assert.equal(isPrimaryPaperSignal({ ...signal, botRole: "checkpoint_observer" }), false);
});

test("observer records each canonical checkpoint once and is explicitly non-executable", () => {
  const observer = createCheckpointObserver();
  const row = { slug: "btc-updown-5m-1", secondsIntoWindow: 90, symbol: "BTC" };
  const first = observer.consider(row);
  assert.equal(first.checkpointSeconds, 90);
  assert.equal(first.executionEligible, false);
  assert.equal(observer.consider(row), null);
  assert.equal(observer.consider({ ...row, secondsIntoWindow: 91 }), null);
});
