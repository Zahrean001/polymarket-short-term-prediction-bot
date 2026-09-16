function finite(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function requiredFinite(value) {
  if (value === null || value === undefined || value === "") return Number.NaN;
  return finite(value, Number.NaN);
}

function normalizeDirection(value) {
  const direction = String(value || "").trim().toUpperCase();
  if (direction === "UP" || direction === "DOWN") return direction;
  return "UNKNOWN";
}

function isChainlinkCurrentSource(value) {
  return String(value || "").toLowerCase().startsWith("polymarket_chainlink_rtds");
}

function isOfficialTargetSource(value) {
  const source = String(value || "").toLowerCase();
  return source.startsWith("polymarket_") && (
    source.includes("event_metadata") ||
    source.includes("market_event_metadata") ||
    source.includes("chainlink_rtds")
  );
}

function hasWsBook(value) {
  const sources = String(value || "").toLowerCase().split("+");
  return sources.length >= 2 && sources.every((source) => source.startsWith("ws"));
}

function evaluateMainAccuracyLane(prediction = {}, config = {}) {
  const enabled = config.enabled !== false;
  if (!enabled) return { enabled: false, eligible: true, reason: "main_accuracy_lane_disabled" };

  const minConfidence = finite(config.minConfidence, 85);
  const minSeconds = finite(config.minSecondsIntoWindow, 60);
  const maxSecondsExclusive = finite(config.maxSecondsIntoWindowExclusive, 290);
  const requireModelReady = config.requireModelReady !== false;
  const requireDirectionLock = config.requireDirectionLock !== false;
  const requireChainlink = config.requireChainlink !== false;
  const requireOfficialTarget = config.requireOfficialTarget !== false;
  const requireWsBook = config.requireWsBook !== false;
  const allowedSymbols = new Set((Array.isArray(config.allowedSymbols) ? config.allowedSymbols : ["BTC", "SOL"])
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean));
  const maxChainlinkAgeMs = finite(config.maxChainlinkAgeMs, 2_000);
  const maxBookAgeMs = finite(config.maxBookAgeMs, 1_500);
  const minEntryPrice = finite(config.minEntryPrice, 0);
  const maxEntryPrice = finite(config.maxEntryPrice, 0.80);
  const legacyCalibrationGateEnabled = config.legacyCalibrationGateEnabled !== false;
  const decisionLatencyMs = Math.max(0, finite(config.decisionLatencyMs, 0));
  const model = prediction.independentProbabilityModel || prediction.probabilityModelInputs || {};
  const assetProbabilityUp = finite(model.assetProbabilityUp ?? prediction.pAssetUp ?? model.probabilityUp ?? prediction.probabilityUp, Number.NaN);
  const selectedDirection = normalizeDirection(prediction.predictedOutcome || prediction.direction || prediction.side);
  const modelDirection = Number.isFinite(assetProbabilityUp)
    ? (assetProbabilityUp >= 0.5 ? "UP" : "DOWN")
    : "UNKNOWN";
  const confidence = finite(prediction.confidence, 0);
  const assetProbabilityDown = finite(model.assetProbabilityDown ?? model.probabilityDown ?? prediction.probabilityDown, Number.NaN);
  const selectedAssetProbability = selectedDirection === "UP" ? assetProbabilityUp : assetProbabilityDown;
  const secondsIntoWindow = finite(prediction.secondsIntoWindow, Number.NaN);
  const timeframe = String(prediction.timeframe || "").toUpperCase();
  const symbol = String(prediction.symbol || "").toUpperCase();
  const rawCurrentPriceAgeMs = requiredFinite(prediction.currentPriceAgeMs);
  const rawBookAgeMs = requiredFinite(prediction.bookAgeMs);
  const selectedEntryPrice = requiredFinite(
    prediction.selectedBuyPrice ??
    prediction.entryPrice ??
    (selectedDirection === "UP" ? prediction.upBuyPrice : prediction.downBuyPrice),
  );
  const currentPriceAgeMs = Number.isFinite(rawCurrentPriceAgeMs) ? rawCurrentPriceAgeMs + decisionLatencyMs : Number.NaN;
  const bookAgeMs = Number.isFinite(rawBookAgeMs) ? rawBookAgeMs + decisionLatencyMs : Number.NaN;
  const calibratedNetEv = evaluateCalibratedNetEv({
    rawConfidence: confidence,
    executablePrice: selectedEntryPrice,
    secondsIntoWindow,
    feeRate: prediction.takerFeeRate,
  });

  let reason = "main_accuracy_lane_ready";
  if (!allowedSymbols.has(symbol)) reason = "main_accuracy_symbol_not_validated";
  else if (timeframe !== "5M") reason = "main_accuracy_requires_5m";
  else if (requireModelReady && model.available !== true) reason = "main_accuracy_model_unavailable";
  else if (requireModelReady && !Number.isFinite(assetProbabilityUp)) reason = "main_accuracy_asset_probability_missing";
  else if (requireDirectionLock && selectedDirection !== modelDirection) reason = "main_accuracy_direction_lock_mismatch";
  else if (confidence < minConfidence) reason = "main_accuracy_raw_confidence_below_floor";
  else if (!Number.isFinite(selectedEntryPrice) || selectedEntryPrice <= 0) reason = "main_accuracy_entry_price_invalid";
  else if (selectedEntryPrice < minEntryPrice) reason = "main_accuracy_entry_price_below_regime_core_floor";
  else if (selectedEntryPrice > maxEntryPrice) reason = "main_accuracy_entry_price_above_profitability_ceiling";
  else if (legacyCalibrationGateEnabled && !calibratedNetEv.eligible) reason = calibratedNetEv.reason;
  else if (!Number.isFinite(secondsIntoWindow) || secondsIntoWindow < minSeconds) reason = "main_accuracy_before_entry_window";
  else if (secondsIntoWindow >= maxSecondsExclusive) reason = "main_accuracy_after_entry_window";
  else if (requireChainlink && !isChainlinkCurrentSource(prediction.currentSource)) reason = "main_accuracy_chainlink_current_required";
  else if (requireChainlink && (!Number.isFinite(currentPriceAgeMs) || currentPriceAgeMs < 0 || currentPriceAgeMs > maxChainlinkAgeMs)) reason = "main_accuracy_chainlink_price_stale";
  else if (requireOfficialTarget && !isOfficialTargetSource(prediction.targetSource)) reason = "main_accuracy_official_target_required";
  else if (requireWsBook && !hasWsBook(prediction.bookSource)) reason = "main_accuracy_ws_book_required";
  else if (requireWsBook && (!Number.isFinite(bookAgeMs) || bookAgeMs < 0 || bookAgeMs > maxBookAgeMs)) reason = "main_accuracy_ws_book_stale";

  return {
    enabled: true,
    eligible: reason === "main_accuracy_lane_ready",
    reason,
    selectedDirection,
    modelDirection,
    assetProbabilityUp: Number.isFinite(assetProbabilityUp) ? assetProbabilityUp : null,
    selectedAssetProbability: Number.isFinite(selectedAssetProbability) ? selectedAssetProbability : null,
    confidence,
    minConfidence,
    selectedEntryPrice: Number.isFinite(selectedEntryPrice) ? selectedEntryPrice : null,
    minEntryPrice,
    maxEntryPrice,
    secondsIntoWindow: Number.isFinite(secondsIntoWindow) ? secondsIntoWindow : null,
    minSecondsIntoWindow: minSeconds,
    maxSecondsIntoWindowExclusive: maxSecondsExclusive,
    symbol,
    allowedSymbols: [...allowedSymbols],
    currentSource: prediction.currentSource || null,
    decisionLatencyMs,
    currentPriceAgeMs: Number.isFinite(currentPriceAgeMs) ? currentPriceAgeMs : null,
    maxChainlinkAgeMs,
    targetSource: prediction.targetSource || null,
    bookSource: prediction.bookSource || null,
    bookAgeMs: Number.isFinite(bookAgeMs) ? bookAgeMs : null,
    maxBookAgeMs,
    calibratedNetEv,
    legacyCalibrationGateEnabled,
    legacyCalibrationRole: legacyCalibrationGateEnabled ? "legacy_compatibility_gate" : "telemetry_only",
    calibratedProbability: calibratedNetEv.calibratedProbability ?? null,
    netEdge: calibratedNetEv.netEdge ?? null,
    calibrationProfileId: calibratedNetEv.profileId ?? null,
  };
}

export {
  evaluateMainAccuracyLane,
  hasWsBook,
  isChainlinkCurrentSource,
  isOfficialTargetSource,
  normalizeDirection,
};
import { evaluateCalibratedNetEv } from "./calibratedNetEvPolicy.js";
