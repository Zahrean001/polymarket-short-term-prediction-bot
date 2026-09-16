function finite(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeDirection(value) {
  const direction = String(value || "").trim().toUpperCase();
  return direction === "UP" || direction === "DOWN" ? direction : "UNKNOWN";
}

function evaluateRegimeCorePolicy(input = {}, config = {}) {
  const minConfidence = finite(config.minConfidence, 95);
  const minEntryPrice = finite(config.minEntryPrice, 0.50);
  const maxEntryPrice = finite(config.maxEntryPrice, 0.85);
  const confidence = finite(input.confidence);
  const executablePrice = finite(input.executablePrice);
  const selectedDirection = normalizeDirection(input.selectedDirection);
  const modelDirection = normalizeDirection(input.modelDirection);
  const independentAssetEdge = input.independentAssetEdge || {};
  const observerProbability = input.observerProbability || {};

  let reason = "regime_core_ready";
  if (!Number.isFinite(confidence)) reason = "regime_core_confidence_unavailable";
  else if (confidence < minConfidence) reason = "regime_core_confidence_below_95";
  else if (!Number.isFinite(executablePrice) || executablePrice <= 0 || executablePrice >= 1) reason = "regime_core_executable_price_invalid";
  else if (executablePrice < minEntryPrice) reason = "regime_core_selected_price_below_0_50";
  else if (executablePrice > maxEntryPrice) reason = "regime_core_selected_price_above_ceiling";
  else if (selectedDirection === "UNKNOWN" || modelDirection === "UNKNOWN") reason = "regime_core_direction_unavailable";
  else if (selectedDirection !== modelDirection) reason = "regime_core_independent_direction_mismatch";
  else if (independentAssetEdge.eligible !== true) reason = independentAssetEdge.reason || "regime_core_independent_asset_edge_rejected";

  return {
    enabled: true,
    eligible: reason === "regime_core_ready",
    reason,
    policyId: "v3745-static-regime-core",
    confidence: Number.isFinite(confidence) ? confidence : null,
    minConfidence,
    executablePrice: Number.isFinite(executablePrice) ? executablePrice : null,
    minEntryPrice,
    maxEntryPrice,
    selectedDirection,
    modelDirection,
    independentAssetEdgeEligible: independentAssetEdge.eligible === true,
    independentAssetNetEdge: finite(independentAssetEdge.netEdge, null),
    assetProbability: finite(independentAssetEdge.assetProbability, null),
    observerPolicyApplied: observerProbability.applied === true,
    observerPolicyReason: observerProbability.reason || "static_core_fallback",
    effectiveAssetProbability: finite(observerProbability.effectiveProbability ?? independentAssetEdge.assetProbability, null),
    legacyCalibrationExecutionGate: false,
  };
}

function buildRegimeCoreEconomics(corePolicy = {}, independentAssetEdge = {}, observerProbability = {}) {
  const probability = finite(
    observerProbability.effectiveProbability ?? independentAssetEdge.assetProbability,
  );
  const netEdge = finite(independentAssetEdge.netEdge);
  const eligible = corePolicy.eligible === true && independentAssetEdge.eligible === true && Number.isFinite(netEdge);
  return {
    eligible,
    reason: eligible ? "regime_core_economics_ready" : (corePolicy.reason || independentAssetEdge.reason || "regime_core_economics_rejected"),
    netEdge: Number.isFinite(netEdge) ? netEdge : null,
    calibratedProbability: Number.isFinite(probability) ? probability : null,
    effectiveProbability: Number.isFinite(probability) ? probability : null,
    probabilitySource: observerProbability.applied === true
      ? "observer_forward_probability_cap"
      : "independent_chainlink_asset_model",
    executionPolicyId: corePolicy.policyId || "v3745-static-regime-core",
  };
}

export { buildRegimeCoreEconomics, evaluateRegimeCorePolicy, normalizeDirection };
