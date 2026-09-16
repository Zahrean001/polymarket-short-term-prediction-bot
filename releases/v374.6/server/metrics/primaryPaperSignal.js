function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isPrimaryPaperSignal(signal = {}) {
  const executionStatus = String(signal.executionStatus || "").toLowerCase();
  const sourceType = String(signal.sourceType || "").toLowerCase();
  const stake = finite(signal.filledStakeUsd ?? signal.paperStakeUsd, 0);
  const isV3745Control = String(signal.strategyVersion || "").includes("374.5") ||
    String(signal.releaseVersion || "").includes("374.5");
  const executionPolicyEligible = isV3745Control
    ? signal.regimeCorePolicy?.eligible === true && signal.independentAssetEdgePolicy?.eligible === true
    : signal.calibratedNetEv?.eligible === true && typeof signal.calibrationProfileId === "string" && signal.calibrationProfileId.length > 0;
  return signal.botRole === "main_test" &&
    signal.mainAccuracyLane?.eligible === true &&
    executionPolicyEligible &&
    signal.realParityEligible === true &&
    (executionStatus === "filled" || executionStatus === "partial_fill") &&
    sourceType === "real_market" &&
    stake > 0;
}

export { isPrimaryPaperSignal };
