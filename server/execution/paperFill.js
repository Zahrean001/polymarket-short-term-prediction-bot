import { normalizeLevels } from "../market/orderBookState.js";

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function feeForFill(shares, price, feeRate) {
  return Math.max(0, shares) * Math.max(0, feeRate) * price * (1 - price);
}

function roundUsdcFee(value) {
  return Math.round(Math.max(0, finite(value, 0)) * 100_000) / 100_000;
}

function isTickAligned(price, tickSize) {
  const tick = finite(tickSize, 0);
  if (!(tick > 0)) return false;
  const units = price / tick;
  return Math.abs(units - Math.round(units)) <= 1e-7;
}

function emptyFill(reason, intendedStakeUsd, orderType) {
  return {
    executionStatus: "unfilled",
    reason,
    orderType,
    intendedStakeUsd,
    fillableStakeUsd: 0,
    filledStakeUsd: 0,
    unfilledStakeUsd: intendedStakeUsd,
    filledShares: 0,
    averageFillPrice: null,
    worstFillPrice: null,
    bestAskAtDecision: null,
    limitPrice: null,
    levelsUsed: 0,
    fillFraction: 0,
    takerFeeUsd: 0,
    slippageUsd: 0,
    slippageCents: 0,
    grossPotentialProfitUsd: 0,
    netPotentialProfitUsd: 0,
    realParityEligible: false,
  };
}

/**
 * Local CLOB depth sweep for a marketable-limit paper order.
 * The function consumes only observed asks; it never invents liquidity.
 */
function simulateMarketableBuy(input = {}) {
  const intendedStakeUsd = Math.max(0, finite(input.intendedStakeUsd, 0));
  const orderType = String(input.orderType || "FAK").toUpperCase();
  const maxSlippageCents = Math.max(0, finite(input.maxSlippageCents, 1));
  const feeRate = Math.max(0, finite(input.feeRate, 0.07));
  const minimumOrderShares = Math.max(0, finite(input.minimumOrderShares, 0));
  const tickSize = Math.max(0, finite(input.tickSize, 0.01));
  const asks = normalizeLevels(input.asks, "ask");
  if (intendedStakeUsd <= 0) return emptyFill("invalid_intended_stake", intendedStakeUsd, orderType);
  if (!asks.length) return emptyFill("no_observed_ask_liquidity", intendedStakeUsd, orderType);
  if (orderType !== "FAK" && orderType !== "FOK") return emptyFill("unsupported_order_type", intendedStakeUsd, orderType);

  const bestAskAtDecision = asks[0].price;
  const explicitLimit = finite(input.limitPrice, 0);
  const limitPrice = explicitLimit > 0
    ? clamp(explicitLimit, bestAskAtDecision, 0.9999)
    : clamp(bestAskAtDecision + maxSlippageCents / 100, bestAskAtDecision, 0.9999);
  if (tickSize <= 0 || !isTickAligned(bestAskAtDecision, tickSize) || !isTickAligned(limitPrice, tickSize)) {
    return {
      ...emptyFill("invalid_tick_alignment", intendedStakeUsd, orderType),
      bestAskAtDecision,
      limitPrice,
      tickSize,
      minimumOrderShares,
    };
  }
  let remainingUsd = intendedStakeUsd;
  let filledStakeUsd = 0;
  let filledShares = 0;
  let takerFeeUsd = 0;
  let levelsUsed = 0;
  let worstFillPrice = null;

  for (const level of asks) {
    if (remainingUsd <= 1e-9 || level.price > limitPrice + 1e-12) break;
    const maxSharesByBudget = remainingUsd / level.price;
    const shares = Math.min(level.size, maxSharesByBudget);
    if (shares <= 0) continue;
    const cost = shares * level.price;
    filledShares += shares;
    filledStakeUsd += cost;
    takerFeeUsd += feeForFill(shares, level.price, feeRate);
    remainingUsd = Math.max(0, remainingUsd - cost);
    worstFillPrice = level.price;
    levelsUsed += 1;
  }

  const fillFraction = intendedStakeUsd > 0 ? clamp(filledStakeUsd / intendedStakeUsd, 0, 1) : 0;
  if (orderType === "FOK" && fillFraction < 1 - 1e-7) {
    return {
      ...emptyFill("fok_not_fully_fillable", intendedStakeUsd, orderType),
      fillableStakeUsd: filledStakeUsd,
      bestAskAtDecision,
      limitPrice,
    };
  }
  if (filledShares <= 0 || filledStakeUsd <= 0) {
    return {
      ...emptyFill("no_liquidity_within_limit", intendedStakeUsd, orderType),
      bestAskAtDecision,
      limitPrice,
    };
  }
  if (filledShares + 1e-9 < minimumOrderShares) {
    return {
      ...emptyFill("below_market_minimum_order_shares", intendedStakeUsd, orderType),
      fillableStakeUsd: filledStakeUsd,
      bestAskAtDecision,
      limitPrice,
      tickSize,
      minimumOrderShares,
      observedFillableShares: filledShares,
    };
  }

  takerFeeUsd = roundUsdcFee(takerFeeUsd);
  const averageFillPrice = filledStakeUsd / filledShares;
  const slippageUsd = Math.max(0, filledShares * (averageFillPrice - bestAskAtDecision));
  const slippageCents = Math.max(0, (averageFillPrice - bestAskAtDecision) * 100);
  const grossPotentialProfitUsd = Math.max(0, filledShares - filledStakeUsd);
  const netPotentialProfitUsd = Math.max(0, grossPotentialProfitUsd - takerFeeUsd);
  const executionStatus = fillFraction >= 1 - 1e-7 ? "filled" : "partial_fill";
  return {
    executionStatus,
    reason: executionStatus === "filled" ? "observed_depth_fully_filled" : "observed_depth_partial_fill",
    orderType,
    intendedStakeUsd,
    fillableStakeUsd: filledStakeUsd,
    filledStakeUsd,
    unfilledStakeUsd: Math.max(0, intendedStakeUsd - filledStakeUsd),
    filledShares,
    averageFillPrice,
    worstFillPrice,
    bestAskAtDecision,
    limitPrice,
    levelsUsed,
    fillFraction,
    takerFeeUsd,
    slippageUsd,
    slippageCents,
    grossPotentialProfitUsd,
    netPotentialProfitUsd,
    realParityEligible: true,
    tickSize,
    tickAligned: true,
    minimumOrderShares,
  };
}

export { feeForFill, isTickAligned, roundUsdcFee, simulateMarketableBuy };
