import { normalCDF } from "../quant/solvers.js";
import { sampleStandardDeviation } from "./independentDigitalModel.js";

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function median(values = []) {
  const rows = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return 0;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function robustEwmaDrift(returns = [], options = {}) {
  const rows = returns.map(Number).filter(Number.isFinite);
  if (rows.length < 2) return 0;
  const center = median(rows);
  const mad = median(rows.map((value) => Math.abs(value - center)));
  const robustScale = Math.max(1e-8, mad * 1.4826);
  const clipWidth = Math.max(robustScale * 4, finite(options.minimumClipWidth, 2e-5));
  const clipped = rows.map((value) => clamp(value, center - clipWidth, center + clipWidth));
  const halfLife = Math.max(2, finite(options.halfLife, 20));
  const decay = Math.exp(Math.log(0.5) / halfLife);
  let weight = 1;
  let weighted = 0;
  let totalWeight = 0;
  for (let index = clipped.length - 1; index >= 0; index -= 1) {
    weighted += clipped[index] * weight;
    totalWeight += weight;
    weight *= decay;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

function marketProbabilityUp(prices = {}) {
  const upBid = finite(prices.upBidPrice, 0);
  const upAsk = finite(prices.upBuyPrice, 0);
  const downBid = finite(prices.downBidPrice, 0);
  const downAsk = finite(prices.downBuyPrice, 0);
  if (upBid <= 0 || upAsk <= 0 || downBid <= 0 || downAsk <= 0) return null;
  if (upBid >= upAsk || downBid >= downAsk) return null;
  const upMid = (upBid + upAsk) / 2;
  const downMid = (downBid + downAsk) / 2;
  const total = upMid + downMid;
  return total > 0 ? clamp(upMid / total, 0.01, 0.99) : null;
}

function logit(probability) {
  const p = clamp(probability, 1e-6, 1 - 1e-6);
  return Math.log(p / (1 - p));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-clamp(value, -40, 40)));
}

function calculateRealOnlyDirectionProbability(input = {}) {
  const currentPrice = finite(input.currentPrice, 0);
  const strikePrice = finite(input.strikePrice, 0);
  const timeLeftSec = finite(input.timeLeftSec, 0);
  const returns = Array.isArray(input.oneSecondLogReturns)
    ? input.oneSecondLogReturns.map(Number).filter(Number.isFinite)
    : [];
  const minReturnSamples = Math.max(2, finite(input.minReturnSamples, 20));
  if (currentPrice <= 0 || strikePrice <= 0 || timeLeftSec <= 0) {
    return { available: false, reason: "invalid_real_spot_strike_or_horizon" };
  }
  if (returns.length < minReturnSamples) {
    return {
      available: false,
      reason: "insufficient_real_return_history",
      returnSamples: returns.length,
      requiredReturnSamples: minReturnSamples,
    };
  }

  const sigmaPerSqrtSecond = sampleStandardDeviation(returns);
  const horizonSigma = sigmaPerSqrtSecond * Math.sqrt(timeLeftSec);
  const logMoneyness = Math.log(currentPrice / strikePrice);
  const rawDriftPerSecond = robustEwmaDrift(returns, input.driftOptions);
  const driftShrink = clamp(finite(input.driftShrink, 0.18), 0, 0.5);
  const rawProjectedDrift = rawDriftPerSecond * timeLeftSec * driftShrink;
  const maxProjectedDrift = Math.max(1e-12, horizonSigma * 0.65);
  const projectedDrift = clamp(rawProjectedDrift, -maxProjectedDrift, maxProjectedDrift);
  const projectedLogMoneyness = logMoneyness + projectedDrift;

  let assetProbabilityUp;
  if (horizonSigma <= 1e-12) {
    assetProbabilityUp = projectedLogMoneyness > 0 ? 0.99 : projectedLogMoneyness < 0 ? 0.01 : 0.5;
  } else {
    assetProbabilityUp = normalCDF(projectedLogMoneyness / horizonSigma);
  }
  assetProbabilityUp = clamp(assetProbabilityUp, 0.01, 0.99);

  const pMarket = marketProbabilityUp(input.prices || {});
  const marketWeight = pMarket === null ? 0 : clamp(finite(input.marketWeight, 0.10), 0, 0.20);
  let finalProbabilityUp = pMarket === null
    ? assetProbabilityUp
    : sigmoid(logit(assetProbabilityUp) + marketWeight * logit(pMarket));
  // Market microstructure is secondary and may not flip the asset-model direction.
  finalProbabilityUp = assetProbabilityUp >= 0.5
    ? clamp(finalProbabilityUp, 0.500001, 0.99)
    : clamp(finalProbabilityUp, 0.01, 0.499999);

  return {
    available: true,
    reason: "real_chainlink_asset_probability_with_bounded_market_context",
    calibrationStatus: "raw_unpromoted",
    assetProbabilityUp,
    assetProbabilityDown: 1 - assetProbabilityUp,
    marketProbabilityUp: pMarket,
    marketWeight,
    probabilityUp: finalProbabilityUp,
    probabilityDown: 1 - finalProbabilityUp,
    logMoneyness,
    projectedLogMoneyness,
    rawDriftPerSecond,
    projectedDrift,
    sigmaPerSqrtSecond,
    horizonSigma,
    volatilityPerSecondBps: sigmaPerSqrtSecond * 10_000,
    volatilityHorizonBps: horizonSigma * 10_000,
    zScore: horizonSigma > 0 ? projectedLogMoneyness / horizonSigma : 0,
    returnSamples: returns.length,
  };
}

export {
  calculateRealOnlyDirectionProbability,
  marketProbabilityUp,
  median,
  robustEwmaDrift,
};
