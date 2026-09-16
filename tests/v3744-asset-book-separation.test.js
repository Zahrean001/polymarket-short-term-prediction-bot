import assert from "node:assert/strict";
import test from "node:test";
import { buildStrategyCandidates } from "../server/strategies/strategyRouter.js";
import { evaluateCalibratedNetEv } from "../server/prediction/calibratedNetEvPolicy.js";
import { evaluateIndependentAssetEdge } from "../server/prediction/independentAssetEdgePolicy.js";

function prediction(overrides = {}) {
  return {
    status: "live",
    symbol: "BTC",
    timeframe: "5M",
    predictedOutcome: "Up",
    probabilityUp: 0.65,
    probabilityDown: 0.35,
    independentProbabilityModel: { available: true, probabilityUp: 0.65, probabilityDown: 0.35 },
    upBuyPrice: 0.50,
    upBidPrice: 0.49,
    downBuyPrice: 0.50,
    downBidPrice: 0.49,
    upDepthShares: 100,
    downDepthShares: 100,
    upDepthPressure: 0,
    downDepthPressure: 0,
    upMicropriceEdgeCents: 0,
    downMicropriceEdgeCents: 0,
    upAskSlopeCents: 1,
    downAskSlopeCents: 1,
    feeEstimate: 0.003,
    yesNoAskCost: 1,
    bookAgeMs: 100,
    bookSource: "ws_delta+ws_delta",
    secondsIntoWindow: 100,
    timeLeftSec: 200,
    stableTicks: 1,
    signals: [],
    ...overrides,
  };
}

const config = {
  currentPredictionEnabled: false,
  priceFieldEnabled: false,
  dualSideEnabled: true,
  orderbookPressureEnabled: false,
  stickyLagEnabled: false,
  newMemberBandEnabled: false,
  endcycleSniperEnabled: false,
  completeSetArbEnabled: false,
  executionQualityEnabled: false,
  replayOptimizer: { enabled: false },
  runtimeRuleCacheEnabled: false,
  candidateQualityEnabled: false,
  noEntryReductionMode: true,
  noStakeReductionMode: true,
  noBlockQualityCandidates: true,
  maxCandidates: 12,
};

function upCandidate(input) {
  return buildStrategyCandidates(input, config).find((candidate) => candidate.strategy === "dual_side_ev" && candidate.side === "UP");
}

test("extreme order book changes legacy schema but never independent asset probability/EV", () => {
  const neutral = upCandidate(prediction());
  const strongBook = upCandidate(prediction({
    upDepthPressure: 0.8,
    downDepthPressure: -0.8,
    upMicropriceEdgeCents: 0.5,
    downMicropriceEdgeCents: -0.5,
  }));
  assert.equal(neutral.assetProbability, 0.65);
  assert.equal(strongBook.assetProbability, neutral.assetProbability);
  assert.equal(strongBook.assetConfidence, neutral.assetConfidence);
  assert.equal(strongBook.assetNetEdge, neutral.assetNetEdge);
  assert.ok(strongBook.probability > neutral.probability);
  assert.ok(strongBook.confidence > neutral.confidence);
  assert.equal(neutral.bookConfirmed, false);
  assert.equal(strongBook.bookConfirmed, true);
  assert.ok(strongBook.bookConfirmationScore > neutral.bookConfirmationScore);
});

test("book-boosted legacy calibration cannot override an ineligible independent asset edge", () => {
  const candidate = upCandidate(prediction({
    probabilityUp: 0.56,
    probabilityDown: 0.44,
    independentProbabilityModel: { available: true, probabilityUp: 0.56, probabilityDown: 0.44 },
    upDepthPressure: 1,
    downDepthPressure: -1,
    upMicropriceEdgeCents: 1,
    downMicropriceEdgeCents: -1,
  }));
  const legacyCalibration = evaluateCalibratedNetEv({
    rawConfidence: candidate.confidence,
    executablePrice: candidate.entryPrice,
    secondsIntoWindow: 100,
    feeRate: 0.07,
  });
  const independent = evaluateIndependentAssetEdge({
    assetProbability: candidate.assetProbability,
    executablePrice: candidate.entryPrice,
    feeRate: 0.07,
  });
  assert.ok(candidate.confidence > candidate.assetConfidence);
  assert.equal(legacyCalibration.eligible, true);
  assert.equal(independent.eligible, false);
});

test("frozen calibration ignores assetProbability input to preserve its fitted schema", () => {
  const baseInput = {
    rawConfidence: 88.96305887817331,
    executablePrice: 0.59,
    secondsIntoWindow: 100,
    feeRate: 0.07,
  };
  const expected = evaluateCalibratedNetEv(baseInput);
  const withUnrelatedAssetInput = evaluateCalibratedNetEv({ ...baseInput, assetProbability: 0.20 });
  assert.equal(withUnrelatedAssetInput.calibratedProbability, expected.calibratedProbability);
  assert.equal(withUnrelatedAssetInput.netEdge, expected.netEdge);
  assert.equal(withUnrelatedAssetInput.eligibilityProbabilitySource, "frozen_legacy_dual_side_confidence_platt");
});

test("dual-side candidate multiset remains two after separation", () => {
  const candidates = buildStrategyCandidates(prediction(), config)
    .filter((candidate) => candidate.strategy === "dual_side_ev");
  assert.deepEqual(candidates.map((candidate) => candidate.side).sort(), ["DOWN", "UP"]);
});
