import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMainAccuracyLane } from "../server/prediction/mainAccuracyLane.js";
import { classifyFastGrowEv } from "../server/prediction/fastGrowEvPolicy.js";
import { buildRegimeCoreEconomics, evaluateRegimeCorePolicy } from "../server/prediction/regimeCorePolicy.js";

function edge(overrides = {}) {
  return { eligible: true, reason: "independent_asset_net_edge_ready", assetProbability: 0.78, netEdge: 0.20, ...overrides };
}

function core(overrides = {}) {
  return evaluateRegimeCorePolicy({
    confidence: 97,
    executablePrice: 0.60,
    selectedDirection: "UP",
    modelDirection: "UP",
    independentAssetEdge: edge(),
    observerProbability: { applied: false, effectiveProbability: 0.78 },
    ...overrides,
  });
}

test("static Regime-Core accepts confidence 95+, price 0.50+, direction match, and independent edge", () => {
  const result = core();
  assert.equal(result.eligible, true);
  assert.equal(result.legacyCalibrationExecutionGate, false);
});

test("price below 0.50 and confidence below 95 remain observer-only", () => {
  assert.equal(core({ executablePrice: 0.49 }).reason, "regime_core_selected_price_below_0_50");
  assert.equal(core({ confidence: 94.999 }).reason, "regime_core_confidence_below_95");
});

test("independent model direction mismatch and independent asset rejection fail closed", () => {
  assert.equal(core({ modelDirection: "DOWN" }).reason, "regime_core_independent_direction_mismatch");
  assert.equal(core({ independentAssetEdge: edge({ eligible: false, reason: "independent_asset_net_edge_below_floor" }) }).eligible, false);
});

test("Lane S can be locally capped to A but the entry remains executable", () => {
  const policy = core();
  const economics = buildRegimeCoreEconomics(policy, edge(), { applied: false, effectiveProbability: 0.78 });
  const classified = classifyFastGrowEv(economics, { minNetEdge: 0.05, laneSMinNetEdge: 0.10, laneCeiling: "A" });
  assert.equal(classified.executable, true);
  assert.equal(classified.requestedLane, "S");
  assert.equal(classified.lane, "A");
  assert.equal(classified.cheapPriceAloneCanPromoteLaneS, false);
});

test("legacy calibration is telemetry-only in the V374.5 main lane", () => {
  const result = evaluateMainAccuracyLane({
    symbol: "BTC",
    timeframe: "5M",
    predictedOutcome: "Up",
    confidence: 95,
    selectedBuyPrice: 0.85,
    secondsIntoWindow: 100,
    currentSource: "polymarket_chainlink_rtds",
    currentPriceAgeMs: 100,
    targetSource: "polymarket_market_event_metadata",
    bookSource: "ws_snapshot+ws_delta",
    bookAgeMs: 100,
    independentProbabilityModel: { available: true, probabilityUp: 0.88 },
  }, {
    minConfidence: 95,
    minEntryPrice: 0.50,
    maxEntryPrice: 0.85,
    minSecondsIntoWindow: 75,
    maxSecondsIntoWindowExclusive: 180,
    requireDirectionLock: true,
    legacyCalibrationGateEnabled: false,
  });
  assert.equal(result.legacyCalibrationRole, "telemetry_only");
  assert.equal(result.eligible, true);
});
