import { normalCDF } from "../quant/solvers.js";

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sampleStandardDeviation(values = []) {
  const rows = values.map(Number).filter(Number.isFinite);
  if (rows.length < 2) return 0;
  const mean = rows.reduce((sum, value) => sum + value, 0) / rows.length;
  const variance = rows.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (rows.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

/**
 * Physical-probability baseline for an UP/DOWN cash-or-nothing contract.
 * It deliberately does not consume the Polymarket contract price or book.
 * The model assumes zero short-horizon drift and uses observed one-second log
 * returns only as a volatility estimate. It is a paper baseline, not a claim
 * that GBM is the true data-generating process.
 */
function calculateIndependentDigitalProbability(input = {}) {
  const currentPrice = finite(input.currentPrice);
  const strikePrice = finite(input.strikePrice);
  const timeLeftSec = finite(input.timeLeftSec);
  const returns = Array.isArray(input.oneSecondLogReturns)
    ? input.oneSecondLogReturns.map(Number).filter(Number.isFinite)
    : [];
  const minReturnSamples = Math.max(2, finite(input.minReturnSamples, 12));

  if (currentPrice <= 0 || strikePrice <= 0 || timeLeftSec <= 0) {
    return { available: false, reason: "invalid_spot_strike_or_horizon" };
  }
  if (returns.length < minReturnSamples) {
    return {
      available: false,
      reason: "insufficient_external_return_history",
      returnSamples: returns.length,
      requiredReturnSamples: minReturnSamples,
    };
  }

  const sigmaPerSqrtSecond = sampleStandardDeviation(returns);
  const logMoneyness = Math.log(currentPrice / strikePrice);
  const horizonSigma = sigmaPerSqrtSecond * Math.sqrt(timeLeftSec);
  let probabilityUp;
  if (horizonSigma <= 1e-12) {
    probabilityUp = logMoneyness > 0 ? 0.99 : logMoneyness < 0 ? 0.01 : 0.50;
  } else {
    probabilityUp = normalCDF(logMoneyness / horizonSigma);
  }
  probabilityUp = clamp(probabilityUp, 0.01, 0.99);

  return {
    available: true,
    reason: "independent_zero_drift_digital_baseline",
    probabilityUp,
    probabilityDown: 1 - probabilityUp,
    logMoneyness,
    sigmaPerSqrtSecond,
    horizonSigma,
    volatilityPerSecondBps: sigmaPerSqrtSecond * 10_000,
    volatilityHorizonBps: horizonSigma * 10_000,
    zScore: horizonSigma > 0 ? logMoneyness / horizonSigma : 0,
    returnSamples: returns.length,
  };
}

export { calculateIndependentDigitalProbability, sampleStandardDeviation };
