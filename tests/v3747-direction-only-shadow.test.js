import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildDirectionOnlyDecision,
  buildPriorEvidence,
  createDirectionOnlyShadowObserver,
  isEligibleMainSignal,
  theoreticalPnl,
} from "../server/research/directionOnlyShadow.js";
import { resolveObserverExecutionProbability } from "../server/research/shadowIsolation.js";

const RELEASE = "v374.7-direction-only-shadow-fastgrow-full-paper";
const ENTRY_MS = Date.parse("2026-07-19T04:16:50.000Z");
const WINDOW_END_MS = Date.parse("2026-07-19T04:20:00.000Z");

function signal(overrides = {}) {
  return {
    id: "btc-updown-5m-1784434500:dual_side_ev:UP:1784434610000",
    slug: "btc-updown-5m-1784434500",
    botRole: "main_test",
    strategyVersion: "v374.5-regime-core-fastgrow-paper",
    releaseVersion: RELEASE,
    sourceType: "real_market",
    status: "paper_open",
    executionStatus: "filled",
    realParityEligible: true,
    learningEligible: true,
    time: new Date(ENTRY_MS).toISOString(),
    windowStart: "2026-07-19T04:15:00.000Z",
    windowEnd: new Date(WINDOW_END_MS).toISOString(),
    symbol: "BTC",
    timeframe: "5M",
    direction: "Up",
    averageFillPrice: 0.76,
    bestAskAtDecision: 0.76,
    yesNoAskCost: 1.02,
    pAssetUp: 0.87,
    pMarketUp: 0.75,
    priceDelta: 16,
    distanceBps: 2.5,
    volatilityAdjustedDistance: 1.1,
    momentum15Bps: 0.07,
    momentum30Bps: -0.01,
    momentum60Bps: 0.25,
    bookConfirmed: true,
    bookConfirmationScore: 0.53,
    secondsIntoWindow: 110,
    entryLane: "A",
    filledStakeUsd: 4,
    paperStakeUsd: 4,
    accountEquity: 40,
    takerFeeRate: 0.07,
    bookSource: "ws_delta+ws_delta",
    bookAgeMs: 11,
    eligibilityEpisode: { correlation: { correlationIndex: 0 } },
    directionShadowEntrySnapshot: {
      schemaVersion: "v3747.direction-shadow-entry-snapshot.1",
      liveMarketData: true,
      syntheticDataUsed: false,
      bookSource: "ws_delta+ws_delta",
      bookAgeMs: 11,
      upBestAsk: 0.76,
      downBestAsk: 0.26,
      upBestAskDepthShares: 20,
      downBestAskDepthShares: 30,
    },
    ...overrides,
  };
}

function settlement(entrySignal = signal(), overrides = {}) {
  return {
    ...entrySignal,
    status: "paper_win",
    officialSettlementUsed: true,
    settlementSource: "official_poly",
    settlementFinality: "official_poly",
    officialOutcome: "Up",
    settledAt: "2026-07-19T04:21:31.000Z",
    paperPnlUsd: 1.18,
    ...overrides,
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v3747-direction-shadow-"));
  const signalDirectory = path.join(root, "main", "signals");
  const settlementDirectory = path.join(root, "main", "settlements");
  const decisionDirectory = path.join(root, "observer", "research", "direction-only-decisions");
  const statePath = path.join(root, "observer", "observer", "direction-cursor.json");
  const reportPath = path.join(root, "observer", "reports", "direction-report.json");
  fs.mkdirSync(signalDirectory, { recursive: true });
  fs.mkdirSync(settlementDirectory, { recursive: true });
  return { root, signalDirectory, settlementDirectory, decisionDirectory, statePath, reportPath };
}

function writeRows(filePath, rows) {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

test("hard-disabled observer probability performs no reader call and preserves Static Core exactly", () => {
  let calls = 0;
  const result = resolveObserverExecutionProbability({
    executionEnabled: false,
    reader: { effectiveProbability() { calls += 1; throw new Error("must_not_run"); } },
    input: { assetProbability: 0.873, symbol: "BTC", direction: "UP" },
  });
  assert.equal(calls, 0);
  assert.equal(result.applied, false);
  assert.equal(result.assetProbability, 0.873);
  assert.equal(result.effectiveProbability, 0.873);
  assert.equal(result.reason, "observer_telemetry_only_frozen_control");
});

test("direction decision is invariant to every settlement-only and result field", () => {
  const base = signal();
  const mutated = {
    ...base,
    status: "paper_loss",
    officialOutcome: "Down",
    officialSettlementUsed: true,
    settlementSource: "official_poly",
    settledAt: "2026-07-19T04:21:31.000Z",
    finalPrice: 1,
    paperPnlUsd: -99,
  };
  const left = buildDirectionOnlyDecision(base, { now: ENTRY_MS + 1_000 });
  const right = buildDirectionOnlyDecision(mutated, { now: ENTRY_MS + 1_000 });
  assert.deepEqual(right.features, left.features);
  assert.deepEqual(right.votes, left.votes);
  assert.equal(right.selectedDirection, left.selectedDirection);
  assert.equal(right.decisionHash, left.decisionHash);
  assert.equal(left.sourceContract.currentOrFutureOutcomeReadAtDecision, false);
});

test("a flip requires three independent contradictory families or proven forward cohort reversal", () => {
  const contradictory = signal({
    direction: "Down",
    pAssetUp: 0.90,
    pMarketUp: 0.80,
    priceDelta: 20,
    momentum15Bps: 1,
    momentum30Bps: 1,
    momentum60Bps: 1,
    bestAskAtDecision: 0.74,
    averageFillPrice: 0.74,
    directionShadowEntrySnapshot: {
      schemaVersion: "v3747.direction-shadow-entry-snapshot.1",
      liveMarketData: true,
      syntheticDataUsed: false,
      bookSource: "ws_delta+ws_delta",
      bookAgeMs: 10,
      upBestAsk: 0.28,
      downBestAsk: 0.74,
      upBestAskDepthShares: 30,
      downBestAskDepthShares: 20,
    },
  });
  const decision = buildDirectionOnlyDecision(contradictory, { now: ENTRY_MS + 1_000 });
  assert.equal(decision.baselineDirection, "DOWN");
  assert.equal(decision.selectedDirection, "UP");
  assert.equal(decision.selectionReason, "flip_independent_three_family_consensus");
  assert.equal(decision.mainMutation.directionChanged, false);
  assert.equal(decision.entryAction, "observe_only");
});

test("forward observer creates one immutable decision, then reconciles only official later settlement", () => {
  const dir = fixture();
  const signalPath = path.join(dir.signalDirectory, "2026-07-19.jsonl");
  const settlementPath = path.join(dir.settlementDirectory, "2026-07-19.jsonl");
  writeRows(signalPath, [signal()]);
  const observer = createDirectionOnlyShadowObserver({
    signalDirectory: dir.signalDirectory,
    settlementDirectory: dir.settlementDirectory,
    decisionDirectory: dir.decisionDirectory,
    statePath: dir.statePath,
    reportPath: dir.reportPath,
    releaseVersion: RELEASE,
  });
  const first = observer.runOnce(ENTRY_MS + 1_000);
  assert.equal(first.status.newDecisions, 1);
  assert.equal(first.report.counts.forwardCausalDecisions, 1);
  assert.equal(first.report.counts.forwardOfficialMatches, 0);
  const decisionPath = path.join(dir.decisionDirectory, fs.readdirSync(dir.decisionDirectory)[0]);
  const immutableBefore = fs.readFileSync(decisionPath, "utf8");

  writeRows(settlementPath, [settlement()]);
  const second = observer.runOnce(Date.parse("2026-07-19T04:21:32.000Z"));
  assert.equal(second.status.newDecisions, 0);
  assert.equal(second.report.counts.forwardOfficialMatches, 1);
  assert.equal(second.report.control.samples, 1);
  assert.equal(second.report.challenger.samples, 1);
  assert.equal(second.report.promotion.promotionEligible, false);
  assert.equal(fs.readFileSync(decisionPath, "utf8"), immutableBefore);
});

test("late archive backfill is recorded for audit but never counted as forward evidence", () => {
  const decision = buildDirectionOnlyDecision(signal(), { now: WINDOW_END_MS + 1 });
  assert.equal(decision.causalEligible, false);
  assert.equal(decision.causalReason, "late_backfill_after_window_end");
});

test("prior evidence cutoff cannot see a settlement that occurs after the new entry", () => {
  const priorDecision = buildDirectionOnlyDecision(signal(), { now: ENTRY_MS + 1_000 });
  const official = settlement();
  const beforeSettlement = buildPriorEvidence([priorDecision], [official], ENTRY_MS + 60_000);
  const afterSettlement = buildPriorEvidence([priorDecision], [official], Date.parse(official.settledAt) + 1);
  assert.equal(beforeSettlement.eligiblePairs, 0);
  assert.equal(afterSettlement.eligiblePairs, 1);
});

test("risk flags remain telemetry and cannot block, resize, reduce count, or slow scan", () => {
  const risky = signal({
    entryLane: "S",
    secondsIntoWindow: 160,
    bookConfirmationScore: 0.05,
    filledStakeUsd: 6,
    accountEquity: 40,
    eligibilityEpisode: { correlation: { correlationIndex: 1 } },
  });
  const decision = buildDirectionOnlyDecision(risky, { now: ENTRY_MS + 1_000 });
  assert.deepEqual(decision.mainMutation, {
    directionChanged: false,
    stakeChanged: false,
    entryBlocked: false,
    entryCountChanged: false,
    scanIntervalChanged: false,
  });
  assert.equal(decision.riskResearchOnly.mayBlockOrResizeMain, false);
  assert.ok(decision.riskResearchOnly.flags.includes("stake_ge_12pct_equity"));
});

test("counterfactual PnL uses binary payout and the same paper fee equation", () => {
  const win = theoreticalPnl(4, 0.80, true, 0.07);
  const loss = theoreticalPnl(4, 0.80, false, 0.07);
  assert.ok(Math.abs(win.feeUsd - 0.056) < 1e-12);
  assert.ok(Math.abs(win.pnlUsd - 0.944) < 1e-12);
  assert.ok(Math.abs(loss.pnlUsd - (-4.056)) < 1e-12);
});

test("signal eligibility rejects simulation, fallback, unfilled, and stale-release rows", () => {
  assert.equal(isEligibleMainSignal(signal()), true);
  assert.equal(isEligibleMainSignal(signal({ sourceType: "fallback" })), false);
  assert.equal(isEligibleMainSignal(signal({ realParityEligible: false })), false);
  assert.equal(isEligibleMainSignal(signal({ executionStatus: "unfilled", filledStakeUsd: 0 })), false);
  assert.equal(isEligibleMainSignal(signal({ releaseVersion: "v374.6-anti-downgrade-evidence-full-paper" })), false);
});
