function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeSide(value) {
  const side = String(value || "").trim().toUpperCase();
  return side === "UP" || side === "DOWN" ? side : "UNKNOWN";
}

function isRecordedFill(signal = {}) {
  const executionStatus = String(signal.executionStatus || "").toLowerCase();
  const stake = finite(signal.filledStakeUsd ?? signal.paperStakeUsd, 0);
  return (executionStatus === "filled" || executionStatus === "partial_fill") &&
    signal.realParityEligible === true &&
    stake > 0;
}

function isMainPaperSignal(signal = {}) {
  const isV3745Control = String(signal.strategyVersion || "").includes("374.5") ||
    String(signal.releaseVersion || "").includes("374.5");
  const executionPolicyEligible = isV3745Control
    ? signal.regimeCorePolicy?.eligible === true && signal.independentAssetEdgePolicy?.eligible === true
    : signal.calibratedNetEv?.eligible === true && typeof signal.calibrationProfileId === "string" && signal.calibrationProfileId.length > 0;
  return signal.botRole === "main_test" &&
    signal.mainAccuracyLane?.eligible === true &&
    executionPolicyEligible &&
    String(signal.sourceType || "").toLowerCase() === "real_market" &&
    isRecordedFill(signal);
}

function canonicalSignalKey(signal = {}) {
  return String(signal.id || [
    signal.slug || "unknown",
    signal.strategy || signal.entryStrategy || "unknown",
    signal.direction || signal.side || "unknown",
    signal.time || signal.windowStart || "",
  ].join(":"));
}

function uniqueMainPaperSignals(signals = []) {
  const unique = new Map();
  for (const signal of Array.isArray(signals) ? signals : []) {
    if (!isMainPaperSignal(signal)) continue;
    unique.set(canonicalSignalKey(signal), signal);
  }
  return [...unique.values()];
}

function hasCommittedSlug(signals = [], slug = "") {
  const target = String(slug || "").trim().toLowerCase();
  if (!target) return false;
  return uniqueMainPaperSignals(signals).some((signal) => String(signal.slug || "").trim().toLowerCase() === target);
}

function summarizePaperCapital(signals = [], startBalance = 0, options = {}) {
  const rows = uniqueMainPaperSignals(signals);
  const settled = rows.filter((signal) =>
    (signal.status === "paper_win" || signal.status === "paper_loss") &&
    signal.officialSettlementUsed === true
  );
  const open = rows.filter((signal) => signal.status === "paper_open");
  const inMemoryRealizedPnlUsd = settled.reduce((sum, signal) => sum + finite(signal.paperPnlUsd, 0), 0);
  const persistedRealizedPnlUsd = finite(options.persistedRealizedPnlUsd, Number.NaN);
  const realizedPnlUsd = Number.isFinite(persistedRealizedPnlUsd)
    ? persistedRealizedPnlUsd
    : inMemoryRealizedPnlUsd;
  const openStakeUsd = open.reduce((sum, signal) => sum + finite(signal.filledStakeUsd ?? signal.paperStakeUsd, 0), 0);
  const openFeeUsd = open.reduce((sum, signal) => sum + finite(signal.takerFeeUsd, 0), 0);
  const openReservedUsd = openStakeUsd + openFeeUsd;
  const realizedBalanceUsd = Math.max(0, finite(startBalance, 0) + realizedPnlUsd);
  const availableCashUsd = Math.max(0, realizedBalanceUsd - openReservedUsd);
  return {
    startBalanceUsd: Math.max(0, finite(startBalance, 0)),
    realizedPnlUsd,
    inMemoryRealizedPnlUsd,
    realizedPnlSource: Number.isFinite(persistedRealizedPnlUsd) ? "persisted_official_settlements" : "in_memory_official_settlements",
    realizedBalanceUsd,
    openStakeUsd,
    openFeeUsd,
    openReservedUsd,
    availableCashUsd,
    openPositions: open.length,
    settledPositions: settled.length,
  };
}

function maximumStakeWithinCash({ availableCashUsd = 0, entryPrice = 0, feeRate = 0, minimumStakeUsd = 0 } = {}) {
  const cash = Math.max(0, finite(availableCashUsd, 0));
  const price = Math.min(0.9999, Math.max(0.0001, finite(entryPrice, 0)));
  const rate = Math.max(0, finite(feeRate, 0));
  const minimum = Math.max(0, finite(minimumStakeUsd, 0));
  const feeRatioToStake = rate * (1 - price);
  const maximumStakeUsd = cash / (1 + feeRatioToStake);
  return {
    availableCashUsd: cash,
    feeRatioToStake,
    maximumStakeUsd: maximumStakeUsd + 1e-9 >= minimum ? maximumStakeUsd : 0,
    executable: maximumStakeUsd + 1e-9 >= minimum,
    reason: maximumStakeUsd + 1e-9 >= minimum ? "paper_cash_available" : "paper_insufficient_available_cash",
  };
}

function modelDirectionFromPrediction(prediction = {}) {
  const model = prediction.independentProbabilityModel || prediction.probabilityModelInputs || {};
  const probabilityUp = finite(model.assetProbabilityUp ?? prediction.pAssetUp ?? model.probabilityUp, Number.NaN);
  if (!Number.isFinite(probabilityUp)) return "UNKNOWN";
  return probabilityUp >= 0.5 ? "UP" : "DOWN";
}

function isExecutableDirectionalCandidate(candidate = {}, prediction = {}, executableStrategies = ["current_prediction"]) {
  const allowed = new Set((Array.isArray(executableStrategies) ? executableStrategies : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean));
  if (!allowed.has(String(candidate.strategy || ""))) {
    return { executable: false, reason: "strategy_not_executable" };
  }
  const candidateDirection = normalizeSide(candidate.side || candidate.direction);
  if (String(candidate.strategy || "") === "dual_side_ev") {
    const confidence = finite(candidate.confidence, Number.NaN);
    const probability = finite(candidate.probability, Number.NaN);
    if (candidateDirection === "UNKNOWN" || !Number.isFinite(confidence) || !Number.isFinite(probability)) {
      return { executable: false, reason: "dual_side_candidate_evidence_unavailable" };
    }
    return { executable: true, reason: "dual_side_candidate_pending_frozen_calibration", requiredDirection: candidateDirection };
  }
  const requiredDirection = modelDirectionFromPrediction(prediction);
  if (requiredDirection === "UNKNOWN") return { executable: false, reason: "model_direction_unavailable" };
  if (candidateDirection !== requiredDirection) {
    return { executable: false, reason: "candidate_direction_mismatch_model" };
  }
  return { executable: true, reason: "candidate_strategy_and_direction_valid", requiredDirection };
}

export {
  hasCommittedSlug,
  isExecutableDirectionalCandidate,
  isMainPaperSignal,
  isRecordedFill,
  maximumStakeWithinCash,
  modelDirectionFromPrediction,
  normalizeSide,
  summarizePaperCapital,
  uniqueMainPaperSignals,
};
