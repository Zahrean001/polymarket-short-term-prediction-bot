import { FROZEN_CALIBRATION_PROFILE } from "./frozenCalibrationProfile.js";

function finite(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function logit(value) {
  const p = clamp(finite(value, 0.5), 1e-6, 1 - 1e-6);
  return Math.log(p / (1 - p));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-clamp(value, -35, 35)));
}

function calibrateLegacyConfidence(rawConfidence, profile = FROZEN_CALIBRATION_PROFILE) {
  const confidence = finite(rawConfidence);
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 100) return null;
  const rawProbability = confidence / 100;
  const { intercept, beta } = profile.calibration;
  return clamp(sigmoid(intercept + beta * logit(rawProbability)), 0.01, 0.99);
}

function feePerShareAtPrice(price, feeRate) {
  const p = clamp(finite(price, 0), 0, 1);
  return Math.max(0, finite(feeRate, 0)) * p * (1 - p);
}

function evaluateCalibratedNetEv(input = {}, profile = FROZEN_CALIBRATION_PROFILE) {
  if (!profile || profile.status !== "frozen_paper_challenger") {
    return { eligible: false, reason: "calibration_profile_not_frozen" };
  }
  // Preserve the fitted legacy confidence schema. Independent asset
  // probability is evaluated by independentAssetEdgePolicy.js.
  const calibratedProbability = calibrateLegacyConfidence(input.rawConfidence, profile);
  const executablePrice = finite(input.executablePrice);
  const secondsIntoWindow = finite(input.secondsIntoWindow);
  if (!Number.isFinite(calibratedProbability)) return { eligible: false, reason: "calibrated_probability_unavailable" };
  if (!Number.isFinite(executablePrice) || executablePrice <= 0 || executablePrice >= 1) {
    return { eligible: false, reason: "executable_price_invalid", calibratedProbability };
  }
  if (!Number.isFinite(secondsIntoWindow)) {
    return { eligible: false, reason: "entry_time_unavailable", calibratedProbability };
  }
  const feeRate = Math.max(0, finite(input.feeRate, profile.entry.feeRate));
  const measuredFeePerShare = finite(input.measuredFeePerShare);
  const feePerShare = Number.isFinite(measuredFeePerShare)
    ? Math.max(0, measuredFeePerShare)
    : feePerShareAtPrice(executablePrice, feeRate);
  const stressSlippagePerShare = Math.max(0, finite(input.stressSlippagePerShare, profile.entry.stressSlippagePerShare));
  const netEdge = calibratedProbability - executablePrice - feePerShare - stressSlippagePerShare;
  let reason = "calibrated_net_ev_ready";
  if (secondsIntoWindow < profile.entry.minSecondsIntoWindow) reason = "calibrated_entry_window_too_early";
  else if (secondsIntoWindow >= profile.entry.maxSecondsIntoWindowExclusive) reason = "calibrated_entry_window_too_late";
  else if (executablePrice > profile.entry.maxExecutableAsk) reason = "calibrated_executable_price_too_high";
  else if (calibratedProbability < profile.entry.minCalibratedProbability) reason = "calibrated_probability_below_floor";
  else if (netEdge < profile.entry.minNetEdge) reason = "calibrated_net_edge_below_floor";
  return {
    eligible: reason === "calibrated_net_ev_ready",
    reason,
    profileId: profile.id,
    profileStatus: profile.status,
    rawConfidence: finite(input.rawConfidence, null),
    calibratedProbability,
    eligibilityProbability: calibratedProbability,
    eligibilityProbabilitySource: "frozen_legacy_dual_side_confidence_platt",
    calibrationSchemaStatus: "legacy_schema_preserved_until_new_forward_calibration",
    executablePrice,
    feePerShare,
    stressSlippagePerShare,
    netEdge,
    minCalibratedProbability: profile.entry.minCalibratedProbability,
    minNetEdge: profile.entry.minNetEdge,
    minSecondsIntoWindow: profile.entry.minSecondsIntoWindow,
    maxSecondsIntoWindowExclusive: profile.entry.maxSecondsIntoWindowExclusive,
    maxExecutableAsk: profile.entry.maxExecutableAsk,
  };
}

export { calibrateLegacyConfidence, evaluateCalibratedNetEv, feePerShareAtPrice };
