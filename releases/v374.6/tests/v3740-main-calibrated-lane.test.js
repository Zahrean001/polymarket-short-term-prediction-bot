import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMainAccuracyLane } from "../server/prediction/mainAccuracyLane.js";
import { evaluateCalibratedNetEv } from "../server/prediction/calibratedNetEvPolicy.js";

const CONFIG = {
  minConfidence: 50,
  minSecondsIntoWindow: 75,
  maxSecondsIntoWindowExclusive: 180,
  requireDirectionLock: false,
  maxEntryPrice: 0.85,
};

function eligible(overrides = {}) {
  return {
    symbol: "BTC",
    timeframe: "5M",
    predictedOutcome: "Up",
    confidence: 95,
    selectedBuyPrice: 0.70,
    secondsIntoWindow: 90,
    currentSource: "polymarket_chainlink_rtds",
    currentPriceAgeMs: 100,
    targetSource: "polymarket_market_event_metadata",
    bookSource: "ws_snapshot+ws_delta",
    bookAgeMs: 100,
    takerFeeRate: 0.07,
    independentProbabilityModel: { available: true, probabilityUp: 0.88 },
    ...overrides,
  };
}

test("frozen calibrated lane accepts a profitable real-data candidate", () => {
  const result = evaluateMainAccuracyLane(eligible(), CONFIG);
  assert.equal(result.eligible, true);
  assert.equal(result.calibratedNetEv.eligible, true);
  assert.ok(result.calibratedProbability > 0.70);
  assert.ok(result.netEdge >= 0.05);
});

test("high raw confidence cannot bypass negative economics", () => {
  const expensive = evaluateMainAccuracyLane(eligible({ confidence: 99, selectedBuyPrice: 0.85 }), CONFIG);
  assert.equal(expensive.eligible, false);
  assert.equal(expensive.reason, "calibrated_net_edge_below_floor");
  const direct = evaluateCalibratedNetEv({ rawConfidence: 80, executablePrice: 0.80, secondsIntoWindow: 90 });
  assert.equal(direct.eligible, false);
});

test("frozen policy enforces its evidence window without starvation settings", () => {
  assert.equal(evaluateMainAccuracyLane(eligible({ secondsIntoWindow: 74 }), CONFIG).reason, "calibrated_entry_window_too_early");
  assert.equal(evaluateMainAccuracyLane(eligible({ secondsIntoWindow: 179 }), CONFIG).eligible, true);
  assert.equal(evaluateMainAccuracyLane(eligible({ secondsIntoWindow: 180 }), CONFIG).reason, "calibrated_entry_window_too_late");
});

test("Chainlink, official target, fresh two-sided WS book, BTC/SOL and 5M remain mandatory", () => {
  assert.equal(evaluateMainAccuracyLane(eligible({ currentSource: "polymarket_binance_rtds_context" }), CONFIG).reason, "main_accuracy_chainlink_current_required");
  assert.equal(evaluateMainAccuracyLane(eligible({ targetSource: "target_unavailable" }), CONFIG).reason, "main_accuracy_official_target_required");
  assert.equal(evaluateMainAccuracyLane(eligible({ bookSource: "rest+rest" }), CONFIG).reason, "main_accuracy_ws_book_required");
  assert.equal(evaluateMainAccuracyLane(eligible({ currentPriceAgeMs: 2001 }), CONFIG).reason, "main_accuracy_chainlink_price_stale");
  assert.equal(evaluateMainAccuracyLane(eligible({ bookAgeMs: 1501 }), CONFIG).reason, "main_accuracy_ws_book_stale");
  assert.equal(evaluateMainAccuracyLane(eligible({ symbol: "SOL" }), CONFIG).eligible, true);
  assert.equal(evaluateMainAccuracyLane(eligible({ symbol: "ETH" }), CONFIG).reason, "main_accuracy_symbol_not_validated");
  assert.equal(evaluateMainAccuracyLane(eligible({ timeframe: "15M" }), CONFIG).reason, "main_accuracy_requires_5m");
});

test("missing model, price, time, or freshness evidence fails closed", () => {
  assert.equal(evaluateMainAccuracyLane(eligible({ independentProbabilityModel: { available: false } }), CONFIG).eligible, false);
  assert.equal(evaluateMainAccuracyLane(eligible({ selectedBuyPrice: null }), CONFIG).eligible, false);
  assert.equal(evaluateMainAccuracyLane(eligible({ secondsIntoWindow: null }), CONFIG).eligible, false);
  assert.equal(evaluateMainAccuracyLane(eligible({ bookAgeMs: null }), CONFIG).eligible, false);
});
