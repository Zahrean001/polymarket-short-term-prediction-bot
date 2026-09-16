import test from "node:test";
import assert from "node:assert/strict";
import { isCandidateTechnicallyExecutable, isTechnicalInvalidReason } from "../server/execution/candidateValidity.js";
import {
  hasCommittedSlug,
  isExecutableDirectionalCandidate,
  maximumStakeWithinCash,
  summarizePaperCapital,
} from "../server/execution/paperCommitPolicy.js";
import { evaluateGateProtocol } from "../server/risk/gateProtocol.js";

function mainSignal(overrides = {}) {
  return {
    id: `signal-${overrides.slug || "btc-updown-5m-1"}-${overrides.idSuffix || "1"}`,
    botRole: "main_test",
    mainAccuracyLane: { eligible: true },
    calibratedNetEv: { eligible: true },
    calibrationProfileId: "v3742-frozen-test",
    sourceType: "real_market",
    realParityEligible: true,
    executionStatus: "filled",
    status: "paper_open",
    slug: "btc-updown-5m-1",
    strategy: "current_prediction",
    direction: "Up",
    filledStakeUsd: 3,
    paperStakeUsd: 3,
    takerFeeUsd: 0.0525,
    ...overrides,
  };
}

test("one committed slug blocks every later strategy or direction", () => {
  const original = mainSignal();
  assert.equal(hasCommittedSlug([original], original.slug), true);
  assert.equal(hasCommittedSlug([{ ...original, strategy: "dual_side_ev", direction: "Down" }], original.slug), true);
  assert.equal(hasCommittedSlug([{ ...original, executionStatus: "unfilled", filledStakeUsd: 0, paperStakeUsd: 0 }], original.slug), false);
  assert.equal(hasCommittedSlug([{ ...original, status: "paper_win", officialSettlementUsed: true }], original.slug), true);
});

test("hard cash ledger never reserves more than paper equity including entry fees", () => {
  const signals = [];
  const startBalanceUsd = 40;
  const entryPrice = 0.75;
  const feeRate = 0.07;
  const desiredStakeUsd = 6.5;

  for (let index = 0; index < 20; index += 1) {
    const before = summarizePaperCapital(signals, startBalanceUsd);
    const limit = maximumStakeWithinCash({
      availableCashUsd: before.availableCashUsd,
      entryPrice,
      feeRate,
      minimumStakeUsd: 3,
    });
    if (!limit.executable) break;
    const stake = Math.min(desiredStakeUsd, limit.maximumStakeUsd);
    const fee = stake * feeRate * (1 - entryPrice);
    signals.push(mainSignal({
      id: `signal-${index}`,
      slug: `btc-updown-5m-${index}`,
      filledStakeUsd: stake,
      paperStakeUsd: stake,
      takerFeeUsd: fee,
    }));
    const after = summarizePaperCapital(signals, startBalanceUsd);
    assert.ok(after.openReservedUsd <= startBalanceUsd + 1e-7);
    assert.ok(after.availableCashUsd >= -1e-9);
  }

  const finalState = summarizePaperCapital(signals, startBalanceUsd);
  assert.equal(signals.length, 6);
  assert.ok(finalState.openReservedUsd <= startBalanceUsd + 1e-7);
  assert.equal(maximumStakeWithinCash({
    availableCashUsd: finalState.availableCashUsd,
    entryPrice,
    feeRate,
    minimumStakeUsd: 3,
  }).executable, false);
});

test("only official settlements release cash and persisted lifetime PnL can compound equity", () => {
  const pendingWin = mainSignal({
    id: "pending-win",
    slug: "btc-updown-5m-pending",
    status: "paper_win",
    paperPnlUsd: 1.25,
    officialSettlementUsed: false,
  });
  const officialWin = mainSignal({
    id: "official-win",
    slug: "btc-updown-5m-official",
    status: "paper_win",
    paperPnlUsd: 1.25,
    officialSettlementUsed: true,
  });
  assert.equal(summarizePaperCapital([pendingWin], 40).realizedBalanceUsd, 40);
  assert.equal(summarizePaperCapital([officialWin], 40).realizedBalanceUsd, 41.25);

  const persisted = summarizePaperCapital([], 40, { persistedRealizedPnlUsd: 7.5 });
  assert.equal(persisted.realizedBalanceUsd, 47.5);
  assert.equal(persisted.realizedPnlSource, "persisted_official_settlements");
});

test("execution policy accepts only current prediction aligned to the independent model", () => {
  const prediction = { independentProbabilityModel: { assetProbabilityUp: 0.74 } };
  assert.equal(isExecutableDirectionalCandidate(
    { strategy: "current_prediction", side: "UP" },
    prediction,
    ["current_prediction"],
  ).executable, true);
  assert.equal(isExecutableDirectionalCandidate(
    { strategy: "current_prediction", side: "DOWN" },
    prediction,
    ["current_prediction"],
  ).reason, "candidate_direction_mismatch_model");
  assert.equal(isExecutableDirectionalCandidate(
    { strategy: "dual_side_ev", side: "UP", confidence: 90, probability: 0.80 },
    prediction,
    ["dual_side_ev"],
  ).reason, "dual_side_candidate_pending_frozen_calibration");
});

test("technical strategy/source blocks cannot be bypassed by no-entry mode", () => {
  for (const reason of [
    "strategy_not_executable",
    "strategy_not_in_allowlist",
    "strategy_force_blocked",
    "live_orderbook_required",
  ]) assert.equal(isTechnicalInvalidReason(reason), true, reason);

  assert.equal(isCandidateTechnicallyExecutable({
    entryPrice: 0.70,
    depthShares: 25,
    blockedReason: "strategy_not_executable",
  }, { maxEntryPrice: 0.80 }), false);

  assert.equal(isCandidateTechnicallyExecutable({
    entryPrice: 0.70,
    depthShares: 25,
    blockedReason: "zscore_or_psi_too_low",
    gates: {
      allGates: [
        { passed: false, reason: "zscore_or_psi_too_low" },
        { passed: false, reason: "live_orderbook_required" },
      ],
    },
  }, { maxEntryPrice: 0.80 }), false);
});

test("ws_delta+ws_delta is recognized as a real two-sided live orderbook", () => {
  const result = evaluateGateProtocol({
    strategy: "current_prediction",
    side: "UP",
    entryPrice: 0.70,
    bidPrice: 0.69,
    spreadCents: 1,
    bookAgeMs: 100,
    depthShares: 25,
    yesNoAskCost: 1.01,
    confidence: 90,
    feeAdjustedEdge: 0.10,
    secondsIntoWindow: 120,
    timeLeftSec: 180,
    stableTicks: 1,
    oddsTicks: 1,
    bookTicks: 1,
    distanceBps: 10,
    volatility60Bps: 5,
    oddsVelocity: 0.1,
    dislocationScore: 0.2,
    consensusAgreement: 0,
    bookSource: "ws_delta+ws_delta",
    sourceType: "real_market",
  }, {
    activePositions: 0,
    positionsThisWindow: 0,
    sameSideUpThisWindow: 0,
    sameSideDownThisWindow: 0,
    strategyPositionsThisWindow: {},
    consecutiveLosses: 0,
    dailyLossFraction: 0,
  }, {
    strictSanity: true,
    requireRealMarketData: true,
    blockSyntheticBook: true,
    blockLearningFallback: true,
    maxBookAgeMs: 1500,
    minTicks: 1,
    minOddsTicks: 1,
    minBookTicks: 1,
    minSecondsIntoWindow: 60,
    maxSecondsIntoWindow: 289,
    minSecondsLeft: 5,
    minEdge: -0.5,
    maxEntryPrice: 0.80,
    maxSpreadCents: 20,
    minDepthShares: 1,
    maxYesNoAskCost: 1.5,
    minYesNoAskCost: 0.8,
    minValidEntryPrice: 0.01,
    minConfidence: 50,
    minZScore: 0,
    minPsi: 0,
    minOddsVelocity: -999,
    minDislocationScore: -999,
    maxActivePositions: 144,
    maxPositionsPerWindow: 48,
    maxSameSidePerWindow: 24,
    maxStrategyPositionsPerWindow: 48,
    maxConsecutiveLosses: 1_000_000,
    maxDailyLossFraction: 1,
    allowedVolatilityRegimes: { low: true, normal: true, high: true, extreme: true },
  });
  const realDataGate = result.allGates.find((gate) => gate.gateId === 13);
  assert.equal(realDataGate.passed, true);
  assert.equal(realDataGate.value.hasLiveBookSource, true);
  assert.equal(result.approved, true);
});
