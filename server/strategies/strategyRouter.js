import { runConsensusEngine } from "../agents/consensusEngine.js";
import { evaluateReplayOptimizer } from "../learning/replayThresholdOptimizer.js";
import { evaluateGateProtocol } from "../risk/gateProtocol.js";

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function opposite(side) {
  return String(side).toUpperCase() === "UP" ? "DOWN" : "UP";
}

function isNoStakeReduction(config = {}) {
  return config.noStakeReductionMode === true || String(config.noStakeReductionMode) === "1";
}

function isNoEntryReduction(config = {}) {
  return config.noEntryReductionMode === true || String(config.noEntryReductionMode) === "1";
}

function technicalBlockReason(reason = "") {
  const text = String(reason || "").toLowerCase();
  if (!text) return false;
  // Keep only conditions that make an order impossible, unsafe to attribute,
  // or outside the configured market/time/capital contract. Directional
  // quality signals (edge, rank, spread, momentum, volatility, consensus)
  // rerank in fast-grow mode; they do not delete an otherwise valid sample.
  return /opposite_side|missing|invalid|no_liquidity|closed|duplicate|max_active|max_positions|synthetic|fallback|non_live|tick|negative_spread|crossed|no_strategy_candidate|insufficient_directional_depth|stale_data|exposure_limit|strategy_|outside_entry|orderbook_sanity|live_orderbook_required/.test(text);
}

function rerankOnlyQualityReason(reason = "", config = {}) {
  const text = String(reason || "").toLowerCase();
  if (!text) return false;
  if (/rank_c|spread_too_wide|momentum_against/.test(text)) return false;
  if (!isNoEntryReduction(config) && config.noBlockQualityCandidates !== true) return false;
  return !technicalBlockReason(text);
}

function noDowngradeStakeMultiplier(value, config = {}) {
  const numeric = finite(value, 1);
  return isNoStakeReduction(config) ? Math.max(1, numeric) : numeric;
}
function getSymbolRecentPerformance(symbol, signals = []) {
  const symbolSignals = signals
    .filter(s => s && s.symbol === symbol && s.calibratedProfile && s.calibratedProfile.approved === true)
    .filter(s => s.status === "paper_win" || s.status === "paper_loss");
  symbolSignals.sort((left, right) => {
    const tL = Date.parse(left.settledAt || left.time || left.windowEnd) || 0;
    const tR = Date.parse(right.settledAt || right.time || right.windowEnd) || 0;
    return tR - tL;
  });
  const recent = symbolSignals.slice(0, 5);
  if (recent.length === 0) return { wins: 0, losses: 0, winRate: 100, streak: 0 };
  let wins = 0;
  let losses = 0;
  let streak = 0;
  let streakBroken = false;
  recent.forEach((s) => {
    const win = s.status === "paper_win";
    if (win) wins++;
    else {
      losses++;
      if (!streakBroken) streak++;
    }
    if (win) streakBroken = true;
  });
  const winRate = (wins / recent.length) * 100;
  return { wins, losses, winRate, streak };
}

function getSymbolSideRecentPerformance(symbol, side, signals = []) {
  const symbolSideSignals = signals
    .filter(s => s && s.symbol === symbol && String(s.direction || s.side || "").toUpperCase() === String(side).toUpperCase() && s.calibratedProfile && s.calibratedProfile.approved === true)
    .filter(s => s.status === "paper_win" || s.status === "paper_loss");
  symbolSideSignals.sort((left, right) => {
    const tL = Date.parse(left.settledAt || left.time || left.windowEnd) || 0;
    const tR = Date.parse(right.settledAt || right.time || right.windowEnd) || 0;
    return tR - tL;
  });
  const recent = symbolSideSignals.slice(0, 4);
  if (recent.length === 0) return { wins: 0, losses: 0, winRate: 100, streak: 0 };
  let wins = 0;
  let losses = 0;
  let streak = 0;
  let streakBroken = false;
  recent.forEach((s) => {
    const win = s.status === "paper_win";
    if (win) wins++;
    else {
      losses++;
      if (!streakBroken) streak++;
    }
    if (win) streakBroken = true;
  });
  const winRate = (wins / recent.length) * 100;
  return { wins, losses, winRate, streak };
}

function qualityPenaltyForReason(reason = "") {
  const text = String(reason || "").toLowerCase();
  if (!text) return 0;
  if (/down|replay|runtime|toxic/.test(text)) return 42;
  if (/confidence|probability|edge|ev|bucket/.test(text)) return 34;
  if (/late|window|price|spread|volatility/.test(text)) return 26;
  return 22;
}


function sidePrice(prediction, side) {
  const upper = String(side).toUpperCase();
  return {
    entryPrice: upper === "UP" ? finite(prediction.upBuyPrice) : finite(prediction.downBuyPrice),
    bidPrice: upper === "UP" ? finite(prediction.upBidPrice) : finite(prediction.downBidPrice),
    depthShares: upper === "UP" ? finite(prediction.upDepthShares) : finite(prediction.downDepthShares),
    spreadCents: upper === "UP" ? Math.max(0, (finite(prediction.upBuyPrice) - finite(prediction.upBidPrice)) * 100) : Math.max(0, (finite(prediction.downBuyPrice) - finite(prediction.downBidPrice)) * 100),
  };
}

function sideDepthSignal(prediction, side) {
  const upper = String(side).toUpperCase();
  const isUp = upper === "UP";
  const pressure = finite(isUp ? prediction.upDepthPressure : prediction.downDepthPressure);
  const oppositePressure = finite(isUp ? prediction.downDepthPressure : prediction.upDepthPressure);
  return {
    pressure,
    oppositePressure,
    depthAdvantage: pressure - oppositePressure,
    askDepth5: finite(isUp ? prediction.upAskDepth5 : prediction.downAskDepth5),
    bidDepth5: finite(isUp ? prediction.upBidDepth5 : prediction.downBidDepth5),
    micropriceEdgeCents: finite(isUp ? prediction.upMicropriceEdgeCents : prediction.downMicropriceEdgeCents),
    askSlopeCents: finite(isUp ? prediction.upAskSlopeCents : prediction.downAskSlopeCents),
  };
}

function sideProbability(prediction, side) {
  return String(side).toUpperCase() === "UP"
    ? finite(prediction.probabilityUp, 0.5)
    : finite(prediction.probabilityDown, 0.5);
}

function sideAssetProbability(prediction, side) {
  const model = prediction.independentProbabilityModel || {};
  const assetUp = finite(
    model.assetProbabilityUp ?? model.probabilityUp ?? prediction.pAssetUp ?? prediction.probabilityUp,
    Number.NaN,
  );
  const assetDown = finite(
    model.assetProbabilityDown ?? model.probabilityDown ?? prediction.pAssetDown ?? prediction.probabilityDown,
    Number.NaN,
  );
  const selected = String(side).toUpperCase() === "UP" ? assetUp : assetDown;
  return Number.isFinite(selected) ? clamp(selected, 0.01, 0.99) : sideProbability(prediction, side);
}

function sideBookConfirmationScore(signal = {}) {
  return clamp(
    0.45 * clamp(finite(signal.depthAdvantage), -1, 1) +
    0.30 * clamp(finite(signal.pressure), -1, 1) +
    0.20 * clamp(finite(signal.micropriceEdgeCents) / 0.10, -1, 1) -
    0.05 * clamp((finite(signal.askSlopeCents) - 6) / 6, 0, 1),
    -1,
    1,
  );
}

function sideBookBoost(signal = {}) {
  return clamp(
    Math.max(0, finite(signal.depthAdvantage)) * 0.08 +
    Math.max(0, finite(signal.pressure)) * 0.04 +
    Math.max(0, finite(signal.micropriceEdgeCents)) * 0.012 -
    Math.max(0, finite(signal.askSlopeCents) - 6) * 0.002,
    -0.04,
    0.12,
  );
}

function sideBookPenalty(signal = {}) {
  return clamp(
    Math.max(0, -finite(signal.depthAdvantage)) * 0.075 +
    Math.max(0, -finite(signal.pressure)) * 0.045 +
    Math.max(0, -finite(signal.micropriceEdgeCents)) * 0.010 +
    Math.max(0, finite(signal.askSlopeCents) - 12) * 0.002,
    0,
    0.18,
  );
}

function baseCandidate(prediction, strategy, side, overrides = {}) {
  const prices = sidePrice(prediction, side);
  const selectedProbability = sideProbability(prediction, side);
  const assetProbability = sideAssetProbability(prediction, side);
  const edge = selectedProbability - prices.entryPrice - finite(prediction.feeEstimate, 0.003);
  const assetNetEdge = assetProbability - prices.entryPrice - finite(prediction.feeEstimate, 0.003) - 0.005;
  const depthSignal = sideDepthSignal(prediction, side);
  const bookConfirmationScore = sideBookConfirmationScore(depthSignal);
  return {
    strategy,
    action: "BUY",
    side: String(side).toUpperCase(),
    confidence: clamp(selectedProbability * 100, 1, 99),
    probability: selectedProbability,
    assetProbability,
    assetConfidence: clamp(assetProbability * 100, 1, 99),
    assetNetEdge,
    edge,
    feeAdjustedEdge: edge,
    rank: rankCandidate(selectedProbability * 100, edge, prices.entryPrice, prices.spreadCents),
    entryPrice: prices.entryPrice,
    bidPrice: prices.bidPrice,
    depthShares: prices.depthShares,
    spreadCents: prices.spreadCents,
    bookAgeMs: finite(prediction.bookAgeMs),
    yesNoAskCost: finite(prediction.yesNoAskCost, finite(prediction.upBuyPrice) + finite(prediction.downBuyPrice)),
    secondsIntoWindow: finite(prediction.secondsIntoWindow),
    timeLeftSec: finite(prediction.timeLeftSec),
    symbol: String(prediction.symbol || prediction.marketSymbol || "UNKNOWN").toUpperCase(),
    timeframe: String(prediction.timeframe || prediction.marketTimeframe || "UNKNOWN").toUpperCase(),
    marketFamily: prediction.marketFamily || "",
    distanceBps: finite(prediction.distanceBps),
    volatility60Bps: finite(prediction.volatility60Bps),
    volatilityAdjustedDistance: finite(prediction.volatilityAdjustedDistance),
    momentum15Bps: finite(prediction.momentum15Bps),
    momentum30Bps: finite(prediction.momentum30Bps),
    momentum60Bps: finite(prediction.momentum60Bps),
    oddsVelocity: Math.abs(finite(prediction.selectedEdgePercent)) / 1000,
    dislocationScore: clamp(finite(prediction.volatilityAdjustedDistance) / 8 + Math.abs(finite(prediction.momentum15Bps)) / 100, 0, 1),
    stableTicks: finite(prediction.stableTicks, 1),
    oddsTicks: finite(prediction.stableTicks, 1),
    bookTicks: 1,
    bookSource: prediction.bookSource,
    sourceType: String(prediction.bookSource || "").includes("synthetic") || /learning fallback/i.test(prediction.title || "") ? "fallback" : "real_market",
    depthPressure: depthSignal.pressure,
    depthAdvantage: depthSignal.depthAdvantage,
    askDepth5: depthSignal.askDepth5,
    bidDepth5: depthSignal.bidDepth5,
    micropriceEdgeCents: depthSignal.micropriceEdgeCents,
    askSlopeCents: depthSignal.askSlopeCents,
    bookConfirmationScore,
    bookConfirmed: bookConfirmationScore >= 0,
    bookRankAdjustment: bookConfirmationScore * 12,
    reasons: [],
    riskFlags: [],
    ...overrides,
  };
}

function rankCandidate(confidence, edge, entryPrice, spreadCents) {
  if (confidence >= 82 && edge >= 0.09 && entryPrice <= 0.72 && spreadCents <= 3) return "A+";
  if (confidence >= 78 && edge >= 0.07 && entryPrice <= 0.78 && spreadCents <= 4) return "A";
  if (confidence >= 72 && edge >= 0.04 && entryPrice <= 0.85 && spreadCents <= 6) return "B";
  if (confidence >= 68 && edge >= 0.025 && entryPrice <= 0.92 && spreadCents <= 8) return "C";
  return "SKIP";
}

function strategyScore(candidate) {
  const rankScore = { "A+": 45, A: 35, B: 24, C: 14, SKIP: -99 }[candidate.rank] ?? 0;
  const executableBonus = candidate.strategy === "current_prediction" ? 24 : -40;
  const fragilePenalty = ["sticky_lag", "new_member_band", "endcycle_sniper"].includes(candidate.strategy) ? 18 : 0;

  return rankScore +
    executableBonus -
    fragilePenalty +
    finite(candidate.confidence) * 0.30 +
    finite(candidate.feeAdjustedEdge) * 260 +
    finite(candidate.depthAdvantage) * 14 +
    finite(candidate.depthPressure) * 7 +
    finite(candidate.micropriceEdgeCents) * 1.6 +
    finite(candidate.v351SideScoreAdjustment) +
    sampleQualityScore(candidate) +
    (candidate.fastWorthIt ? 18 : 0) +
    finite(candidate.runtimeScoreAdjustment) +
    finite(candidate.softQualityScoreAdjustment) +
    finite(candidate.executionQualityScore) * 0.65 -
    finite(candidate.askSlopeCents) * 0.6 -
    finite(candidate.spreadCents) * 0.9 -
    finite(candidate.bookAgeMs) / 900;
}

function v351SideStrength(candidate = {}) {
  return finite(candidate.feeAdjustedEdge) * 100 +
    finite(candidate.confidence) * 0.35 +
    finite(candidate.depthAdvantage) * 8 +
    finite(candidate.depthPressure) * 4 +
    finite(candidate.micropriceEdgeCents) * 2.2 +
    finite(candidate.runtimeScoreAdjustment) * 0.35 +
    finite(candidate.softQualityScoreAdjustment) * 0.25 +
    finite(candidate.executionQualityScore) * 0.22 -
    finite(candidate.spreadCents) * 0.55 -
    finite(candidate.askSlopeCents) * 0.25 -
    finite(candidate.bookAgeMs) / 1200 -
    finite(candidate.recentLossPenalty, 0);
}

function applyV351FastSideCompetition(candidates = [], config = {}) {
  if (config.v351SideCompetitionEnabled === false) return candidates;
  const dual = candidates.filter((candidate) => candidate.strategy === "dual_side_ev" && (candidate.side === "UP" || candidate.side === "DOWN"));
  if (dual.length < 2) return candidates;
  const strongest = { UP: null, DOWN: null };
  for (const candidate of dual) {
    const strength = v351SideStrength(candidate);
    if (!strongest[candidate.side] || strength > strongest[candidate.side].strength) {
      strongest[candidate.side] = { candidate, strength };
    }
  }
  if (!strongest.UP || !strongest.DOWN) return candidates;
  const weight = finite(config.v351SideGapScoreWeight, 1.10);
  const maxAdj = Math.max(4, finite(config.v351SideGapMaxAdjustment, 28));
  return candidates.map((candidate) => {
    if (candidate.strategy !== "dual_side_ev" || !(candidate.side === "UP" || candidate.side === "DOWN")) return candidate;
    const own = v351SideStrength(candidate);
    const opp = candidate.side === "UP" ? strongest.DOWN.strength : strongest.UP.strength;
    const gap = own - opp;
    const adjustment = clamp(gap * weight, -maxAdj, maxAdj);
    return {
      ...candidate,
      v351SideStrength: own,
      v351OppositeSideStrength: opp,
      v351SideGap: gap,
      v351SideScoreAdjustment: adjustment,
      v351SelectorReason: gap >= 0 ? "v351_fast_side_selector_leading" : "v351_fast_side_selector_trailing",
    };
  });
}

function hasReplayBlock(candidate = {}) {
  const reason = String(candidate.replayOptimizer?.reason || candidate.replayOptimizerReason || "").toLowerCase();
  const rules = Array.isArray(candidate.replayOptimizer?.matchedRules) ? candidate.replayOptimizer.matchedRules : [];
  return reason.includes("replay_block") || rules.some((rule) => String(rule?.id || rule).toLowerCase().includes("bad"));
}

function hasRuntimeToxicBucket(candidate = {}) {
  const reason = String(candidate.runtimeRuleReason || candidate.runtimeRuleCache?.reason || "").toLowerCase();
  const buckets = Array.isArray(candidate.runtimeMatchedBuckets)
    ? candidate.runtimeMatchedBuckets
    : Array.isArray(candidate.runtimeRuleCache?.matchedBuckets)
      ? candidate.runtimeRuleCache.matchedBuckets
      : [];
  return reason.includes("toxic") || reason.includes("probe") || buckets.some((bucket) => bucket?.toxic || bucket?.action === "probe_only_toxic");
}


function calibrationBucketStat(model = {}, key = "") {
  const bucket = model?.buckets?.[key];
  if (!bucket || finite(bucket.trades) <= 0) return null;
  return bucket;
}

function shrunkBucketProbability(bucket = {}, globalWinRate = 0.62, priorWeight = 8) {
  const trades = finite(bucket.trades);
  const wins = finite(bucket.wins, trades * finite(bucket.winRate, globalWinRate));
  if (trades <= 0) return globalWinRate;
  return clamp((wins + globalWinRate * priorWeight) / (trades + priorWeight), 0.01, 0.99);
}

function logistic(value) {
  return 1 / (1 + Math.exp(-value));
}

function bucketRoi(bucket = {}) {
  const stake = finite(bucket.stakeUsd ?? bucket.stake ?? bucket.totalStakeUsd);
  if (stake > 0) return finite(bucket.pnlUsd ?? bucket.pnl ?? bucket.totalPnlUsd) / stake;
  return finite(bucket.roi, 0);
}

function microstructureProfile(candidate = {}, config = {}) {
  const bookSource = normalizedBookSource(candidate);
  const bookAgeMs = finite(candidate.bookAgeMs, 9999);
  const spreadCents = finite(candidate.spreadCents);
  const depthAdvantage = finite(candidate.depthAdvantage);
  const depthPressure = finite(candidate.depthPressure);
  const micropriceEdgeCents = finite(candidate.micropriceEdgeCents);
  const askSlopeCents = finite(candidate.askSlopeCents);
  const depthShares = Math.max(finite(candidate.depthShares), finite(candidate.askDepth5), finite(candidate.bidDepth5));
  const entryPrice = finite(candidate.entryPrice);
  const side = String(candidate.side || "").toUpperCase();

  const freshScore = bookSource === "ws+ws"
    ? clamp(1 - Math.max(0, bookAgeMs - 80) / finite(config.edgeEngineFreshBookDecayMs, 1100), -0.20, 1)
    : -0.45;
  const spreadScore = clamp((finite(config.edgeEngineGoodSpreadCents, 2.0) - spreadCents) / 4.0, -0.65, 0.45);
  const depthScore = clamp(depthShares / Math.max(1, finite(config.edgeEngineDepthReferenceShares, 18)) - 0.35, -0.55, 0.75);
  const imbalanceScore = clamp(depthAdvantage * 1.15 + depthPressure * 0.65 + micropriceEdgeCents * 2.4, -1.2, 1.2);
  const slopePenalty = clamp(Math.max(0, askSlopeCents - 6) / 14, 0, 0.60);
  const highPricePenalty = entryPrice >= 0.65 ? 0.18 : entryPrice >= 0.60 ? 0.06 : 0;
  const downPenalty = side === "DOWN" ? finite(config.edgeEngineDownMicrostructurePenalty, 0.025) : 0;
  const score = clamp(
    freshScore * 26 +
    spreadScore * 18 +
    depthScore * 14 +
    imbalanceScore * 24 -
    slopePenalty * 14 -
    highPricePenalty * 20 -
    downPenalty * 100,
    -65,
    75,
  );
  const probability = clamp(0.50 + score / 300, 0.34, 0.78);
  const supportive = bookSource === "ws+ws" && bookAgeMs <= finite(config.edgeEngineMaxLaneABookAgeMs, 850) && spreadCents <= finite(config.edgeEngineMaxLaneASpreadCents, 5) && depthAdvantage >= finite(config.edgeEngineMinDepthAdvantage, -0.12) && micropriceEdgeCents >= finite(config.edgeEngineMinMicropriceEdgeCents, -0.03);
  const premium = bookSource === "ws+ws" && bookAgeMs <= finite(config.edgeEnginePremiumBookAgeMs, 250) && spreadCents <= finite(config.edgeEnginePremiumSpreadCents, 2.5) && depthAdvantage >= finite(config.edgeEnginePremiumDepthAdvantage, 0.08) && micropriceEdgeCents >= finite(config.edgeEnginePremiumMicropriceEdgeCents, 0.015);

  const projectedSlippageCents = Math.max(0, spreadCents * 0.35 + Math.max(0, askSlopeCents - 4) * 0.08 + (depthShares < 8 ? 0.35 : 0) + (bookAgeMs > 750 ? 0.50 : 0));
  return {
    score,
    probability,
    supportive,
    premium,
    bookSource,
    bookAgeMs,
    spreadCents,
    depthShares,
    projectedSlippageCents,
    reasons: [
      `micro_score=${score.toFixed(1)}`,
      `micro_prob=${(probability * 100).toFixed(1)}%`,
      supportive ? "micro_supportive" : "micro_not_supportive",
      premium ? "micro_premium" : "micro_not_premium",
    ],
  };
}

function bucketStatSummary(model = {}, keys = [], globalWinRate = 0.60) {
  const priorWeight = finite(model.priorWeight, 10);
  let weightedProbability = 0;
  let weightedRoi = 0;
  let totalWeight = 0;
  const matchedBuckets = [];
  for (const [key, baseWeight] of keys) {
    const bucket = calibrationBucketStat(model, key);
    if (!bucket) continue;
    const trades = finite(bucket.trades);
    if (trades <= 0) continue;
    const probability = shrunkBucketProbability(bucket, globalWinRate, priorWeight);
    const roi = bucketRoi(bucket);
    const confidenceWeight = clamp(Math.log2(trades + 1) / 4.25, 0.20, 1.50);
    const roiQuality = clamp(1 + roi * 0.45, 0.25, 1.60);
    const weight = finite(baseWeight) * confidenceWeight * roiQuality;
    weightedProbability += probability * weight;
    weightedRoi += roi * weight;
    totalWeight += weight;
    matchedBuckets.push({ key, trades, winRate: finite(bucket.winRate), roi, probability, weight });
  }
  return {
    probability: totalWeight > 0 ? weightedProbability / totalWeight : globalWinRate,
    roi: totalWeight > 0 ? weightedRoi / totalWeight : 0,
    confidence: clamp(totalWeight / 8, 0, 1),
    matchedBuckets: matchedBuckets.sort((a, b) => b.weight - a.weight).slice(0, 10),
  };
}

function calibratedEntryProfile(candidate = {}, config = {}, context = {}) {
  if (config.calibratedEntryModelEnabled === false && config.edgeEngineEnabled === false) {
    return { enabled: false, approved: true, lane: "legacy", winProbability: null, netEv: null, scoreAdjustment: 0, reasons: ["edge_engine_disabled"] };
  }

  const model = config.calibratedEntryModel || {};
  const globalWinRate = clamp(finite(model.global?.winRate, 0.61), 0.01, 0.99);
  const side = String(candidate.side || "UNKNOWN").toUpperCase();
  const symbol = normalizedSymbol(candidate);
  const timeframe = normalizedTimeframe(candidate);
  const rank = String(candidate.rank || "SKIP").toUpperCase();
  const entryPrice = clamp(finite(candidate.entryPrice, 0), 0, 1);
  const priceBucket = priceBucketLabel(entryPrice);
  const windowBucket = secondsBucketLabel(candidate.secondsIntoWindow);
  const bookSource = normalizedBookSource(candidate);
  const bookAgeBucket = finite(candidate.bookAgeMs, 9999) <= 250 ? "0_250" : finite(candidate.bookAgeMs, 9999) <= 750 ? "250_750" : finite(candidate.bookAgeMs, 9999) <= 1500 ? "750_1500" : "1500_plus";
  const spreadBucket = finite(candidate.spreadCents) <= 2 ? "0_2" : finite(candidate.spreadCents) <= 4 ? "2_4" : finite(candidate.spreadCents) <= 8 ? "4_8" : "8_plus";
  const microBucket = finite(candidate.micropriceEdgeCents) >= 0.05 ? "positive_strong" : finite(candidate.micropriceEdgeCents) >= 0 ? "positive" : finite(candidate.micropriceEdgeCents) >= -0.03 ? "slightly_adverse" : "adverse";
  const depthBucket = finite(candidate.depthAdvantage) >= 0.20 ? "positive_strong" : finite(candidate.depthAdvantage) >= 0 ? "positive" : finite(candidate.depthAdvantage) >= -0.15 ? "slightly_adverse" : "adverse";
  const replayBad = Boolean(context.replayBad ?? hasReplayBlock(candidate));
  const runtimeToxic = Boolean(context.runtimeToxic ?? hasRuntimeToxicBucket(candidate));
  const baseScore = finite(context.baseScore, 0);
  const secondsIntoWindow = finite(candidate.secondsIntoWindow);
  const inPremiumWindow = secondsIntoWindow >= finite(config.edgeEnginePremiumWindowStart, 45) && secondsIntoWindow < finite(config.edgeEnginePremiumWindowEnd, 60);
  const inClearWindow = secondsIntoWindow >= finite(config.edgeEngineClearWindowStart, 15) && secondsIntoWindow < finite(config.edgeEngineClearWindowEnd, 105);

  const keys = [
    [`side:${side}`, 0.35],
    [`symbol:${symbol}`, 0.35],
    [`timeframe:${timeframe}`, 0.24],
    [`price:${priceBucket}`, 0.60],
    [`window:${windowBucket}`, 0.85],
    [`rank:${rank}`, 0.20],
    [`replay:${replayBad ? "block" : "clear"}`, 0.65],
    [`book_source:${bookSource}`, 0.55],
    [`book_age:${bookAgeBucket}`, 0.55],
    [`spread:${spreadBucket}`, 0.45],
    [`micro:${microBucket}`, 0.65],
    [`depth:${depthBucket}`, 0.65],
    [`side_window:${side}:${windowBucket}`, 0.95],
    [`symbol_side:${symbol}:${side}`, 0.80],
    [`symbol_window:${symbol}:${windowBucket}`, 0.85],
    [`side_price:${side}:${priceBucket}`, 0.90],
    [`symbol_side_window_price:${symbol}:${side}:${windowBucket}:${priceBucket}`, 1.50],
    [`symbol_side_timeframe_price_window:${symbol}:${side}:${timeframe}:${priceBucket}:${windowBucket}`, 1.70],
    [`micro_depth:${microBucket}:${depthBucket}`, 0.85],
  ];
  const bucket = bucketStatSummary(model, keys, globalWinRate);
  const micro = microstructureProfile(candidate, config);
  const dualProbability = clamp(finite(candidate.probability, finite(candidate.confidence, 60) / 100), 0.01, 0.99);
  const recentPenalty = runtimeToxic ? finite(config.edgeEngineRuntimeToxicPenalty, 0.045) : 0;
  const replayPenalty = replayBad ? finite(config.edgeEngineReplayBadPenalty, 0.025) : 0;
  const downPenalty = side === "DOWN" ? finite(config.edgeEngineDownPenalty, 0.020) : 0;
  const bucketWeight = clamp(0.22 + bucket.confidence * 0.18, 0.22, 0.40);
  const microWeight = finite(config.edgeEngineMicrostructureWeight, 0.12);
  const dualWeight = finite(config.edgeEngineDualProbabilityWeight, 0.48);
  const regimeWeight = Math.max(0, 1 - bucketWeight - microWeight - dualWeight);
  const recentRegimeProbability = clamp(globalWinRate - recentPenalty - downPenalty, 0.40, 0.74);
  let estimatedWinProbability =
    bucket.probability * bucketWeight +
    dualProbability * dualWeight +
    micro.probability * microWeight +
    recentRegimeProbability * regimeWeight -
    replayPenalty -
    recentPenalty -
    downPenalty;
  estimatedWinProbability = clamp(estimatedWinProbability, 0.01, 0.99);

  const projectedSlippage = finite(micro.projectedSlippageCents) / 100 + finite(config.edgeEngineSlippageBufferCents, 0.35) / 100;
  const projectedFillPrice = clamp(entryPrice + projectedSlippage, 0, 0.99);
  const netEv = estimatedWinProbability - projectedFillPrice;
  const positiveBucket = bucket.probability >= Math.max(globalWinRate, finite(config.edgeEnginePositiveBucketMinProb, 0.62)) && bucket.roi >= finite(config.edgeEnginePositiveBucketMinRoi, -0.02);
  const negativeBucket = bucket.confidence >= 0.55 && (bucket.probability < finite(config.edgeEngineBadBucketMaxProb, 0.54) || bucket.roi < finite(config.edgeEngineBadBucketMinRoi, -0.12));
  const fillable = micro.bookSource === "ws+ws" && micro.bookAgeMs <= finite(config.edgeEngineMaxBookAgeMs, 1100) && micro.depthShares >= finite(config.edgeEngineMinDepthShares, 1) && micro.spreadCents <= finite(config.edgeEngineMaxSpreadCents, 8);
  const noFullStakeReason = [];
  if (replayBad) noFullStakeReason.push("replay_bad");
  if (runtimeToxic) noFullStakeReason.push("runtime_toxic");
  if (negativeBucket) noFullStakeReason.push("negative_expectancy_bucket");
  if (!micro.supportive) noFullStakeReason.push("microstructure_not_supportive");
  if (!fillable) noFullStakeReason.push("not_realistically_fillable");

  const laneSMinProb = finite(config.edgeEngineLaneSMinWinProb, 0.68) + (side === "DOWN" ? finite(config.edgeEngineDownLaneProbAdd, 0.04) : 0);
  const laneAMinProb = finite(config.edgeEngineLaneAMinWinProb, 0.61) + (side === "DOWN" ? finite(config.edgeEngineDownLaneProbAdd, 0.04) : 0);
  const laneBMinProb = finite(config.edgeEngineLaneBMinWinProb, 0.56) + (side === "DOWN" ? finite(config.edgeEngineDownLaneBProbAdd, 0.025) : 0);
  const laneSMinEv = finite(config.edgeEngineLaneSMinNetEv, 0.035);
  const laneAMinEv = finite(config.edgeEngineLaneAMinNetEv, 0.018);
  const laneBMinEv = finite(config.edgeEngineLaneBMinNetEv, 0.006);
  const canLaneS = fillable && micro.premium && !replayBad && !runtimeToxic && !negativeBucket && estimatedWinProbability >= laneSMinProb && netEv >= laneSMinEv && (positiveBucket || inPremiumWindow || baseScore >= finite(config.edgeEngineLaneSMinScore, 132));
  const canLaneA = !canLaneS && fillable && micro.supportive && !negativeBucket && estimatedWinProbability >= laneAMinProb && netEv >= laneAMinEv && (positiveBucket || inClearWindow || baseScore >= finite(config.edgeEngineLaneAMinScore, 104));
  const canLaneB = !canLaneS && !canLaneA && fillable && estimatedWinProbability >= laneBMinProb && netEv >= laneBMinEv && !negativeBucket;
  const isXRP = String(symbol || "").toUpperCase() === "XRP";
  const laneBEnabled = process.env.LANE_B_ENABLED === "1";
  const lane = isXRP ? "OBSERVE" : (canLaneS ? "S" : canLaneA ? "A" : (laneBEnabled && canLaneB) ? "B" : "OBSERVE");
  const approved = lane !== "OBSERVE";
  const kellyRaw = projectedFillPrice < 1 ? Math.max(0, (estimatedWinProbability - projectedFillPrice) / Math.max(0.05, 1 - projectedFillPrice)) : 0;
  const kellyLiteFraction = clamp(kellyRaw * finite(config.edgeEngineKellyLiteFraction, 0.28), 0, finite(config.edgeEngineKellyMaxFraction, 0.08));
  const scoreAdjustment = clamp((estimatedWinProbability - finite(config.edgeEngineTargetWinRate, 0.64)) * 120 + netEv * 420 + micro.score * 0.16 + (positiveBucket ? 16 : 0) + (canLaneS ? 28 : canLaneA ? 18 : canLaneB ? 8 : -24), -48, 52);

  let stakeCapUsd = null;
  if (lane === "B") stakeCapUsd = finite(config.edgeEngineLaneBMaxStakeUsd, 1.25);
  else if (lane === "A") stakeCapUsd = finite(config.edgeEngineLaneAMaxStakeUsd, 4.00);
  else if (lane === "S") stakeCapUsd = null;

  const reason = approved
    ? lane === "S" ? "edge_engine_lane_s_positive_ev_premium" : lane === "A" ? "edge_engine_lane_a_fast_positive_ev" : "edge_engine_lane_b_positive_ev_probe"
    : !fillable
      ? "edge_engine_unfillable_or_stale_book_observe"
      : negativeBucket
        ? "edge_engine_negative_expectancy_bucket_observe"
        : netEv <= laneBMinEv
          ? "edge_engine_net_ev_below_threshold"
          : "edge_engine_probability_below_lane_threshold";

  return {
    enabled: true,
    approved,
    lane,
    winProbability: estimatedWinProbability,
    estimatedWinProbability,
    rawWinProbability: estimatedWinProbability,
    bucketProbability: bucket.probability,
    dualProbability,
    microstructureProbability: micro.probability,
    recentRegimeProbability,
    netEv,
    projectedFillPrice,
    projectedSlippageCents: projectedSlippage * 100,
    kellyRaw,
    kellyLiteFraction,
    targetWinProbability: finite(config.edgeEngineTargetWinRate, 0.64),
    scoreAdjustment,
    reason,
    stakeCapUsd,
    bucketExpectancy: { probability: bucket.probability, roi: bucket.roi, confidence: bucket.confidence, positiveBucket, negativeBucket },
    microstructure: micro,
    matchedBuckets: bucket.matchedBuckets,
    noFullStakeReason,
    reasons: [
      `edge_win_prob=${(estimatedWinProbability * 100).toFixed(1)}%`,
      `edge_net_ev=${netEv.toFixed(3)}`,
      `edge_lane=${lane}`,
      `projected_fill=${projectedFillPrice.toFixed(3)}`,
      positiveBucket ? "positive_expectancy_bucket" : "non_positive_expectancy_bucket",
      ...micro.reasons,
      reason,
    ],
  };
}

function isFastWorthItCandidate(candidate = {}, config = {}) {
  if (config.fastWorthItLaneEnabled === false) return false;
  const strategy = String(candidate.strategy || "");
  if (strategy !== "dual_side_ev") return false;
  const side = String(candidate.side || "").toUpperCase();
  const entryPrice = finite(candidate.entryPrice);
  const edge = finite(candidate.feeAdjustedEdge ?? candidate.edge);
  const winProb = finite(candidate.probability, 0.5);
  const netEv = winProb - entryPrice;
  const spreadCents = finite(candidate.spreadCents);
  const bookAgeMs = finite(candidate.bookAgeMs);
  const bookSource = normalizedBookSource(candidate);
  const depthShares = Math.max(finite(candidate.depthShares), finite(candidate.askDepth5), finite(candidate.bidDepth5));
  const depthAdvantage = finite(candidate.depthAdvantage);
  const micropriceEdgeCents = finite(candidate.micropriceEdgeCents);
  const positiveBook = depthAdvantage >= -0.08 && micropriceEdgeCents >= -0.02;
  const sidePenaltyOk = side !== "DOWN" || (edge >= finite(config.fastWorthItMinEdge, 0.003) + 0.006 && positiveBook);
  return Boolean(
    bookSource === "ws+ws" &&
    bookAgeMs <= finite(config.fastWorthItMaxBookAgeMs, 750) &&
    entryPrice >= finite(config.qualityEntryPriceMin, 0.50) &&
    entryPrice <= finite(config.fastWorthItMaxEntryPrice, 0.64) &&
    spreadCents <= finite(config.fastWorthItMaxSpreadCents, 4) &&
    depthShares >= finite(config.fastWorthItMinDepthShares, 1) &&
    edge >= finite(config.fastWorthItMinEdge, 0.003) &&
    netEv >= finite(config.fastWorthItMinNetEv, 0.002) &&
    positiveBook &&
    sidePenaltyOk
  );
}

function executionQualityProfile(candidate = {}, config = {}) {
  if (config.executionQualityEnabled === false) {
    return { approved: true, score: 100, reason: "execution_quality_disabled", reasons: [], observeOnly: false };
  }

  const reasons = [];
  let score = 0;
  const symbol = normalizedSymbol(candidate);
  const side = String(candidate.side || "").toUpperCase();
  const rank = String(candidate.rank || "SKIP").toUpperCase();
  const bookSource = normalizedBookSource(candidate);
  const bookAgeMs = finite(candidate.bookAgeMs);
  const secondsIntoWindow = finite(candidate.secondsIntoWindow);
  const entryPrice = finite(candidate.entryPrice);
  const spreadCents = finite(candidate.spreadCents);
  const micropriceEdgeCents = finite(candidate.micropriceEdgeCents);
  const depthAdvantage = finite(candidate.depthAdvantage);
  const depthPressure = finite(candidate.depthPressure);
  const edgePercent = finite(candidate.selectedEdgePercent, finite(candidate.feeAdjustedEdge ?? candidate.edge) * 100);
  const replayBad = hasReplayBlock(candidate);
  const runtimeToxic = hasRuntimeToxicBucket(candidate);
  const recoveryMode = config.recoveryMode || {};
  const recoveryActive = Boolean(recoveryMode.active);

  if (candidate.strategy === "current_prediction") { score += 20; reasons.push("current_prediction_executable"); }
  else { score -= 80; reasons.push("non_current_prediction_observe_only"); }

  if (bookSource === "ws+ws") { score += 40; reasons.push("fresh_ws_book_source"); }
  else { score -= finite(config.executionNonWsBookPenalty, 40); reasons.push("non_ws_book_source_reduced_precision"); }

  if (bookAgeMs <= finite(config.executionMaxFullStakeBookAgeMs, 250)) { score += 20; reasons.push("book_age_under_250ms"); }
  else if (bookAgeMs <= finite(config.executionMaxReducedBookAgeMs, 750)) { score -= 10; reasons.push("book_age_250_750ms_reduced"); }
  else { score -= 35; reasons.push("book_age_over_750ms_reduced_precision"); }

  if (secondsIntoWindow >= 45 && secondsIntoWindow < 75) { score += 45; reasons.push("window_45_75_high_precision_bucket"); }
  else if (secondsIntoWindow >= 15 && secondsIntoWindow < 30) { score += 8; reasons.push("window_15_30_neutral"); }
  else if (secondsIntoWindow < 15) { score -= 8; reasons.push("window_0_15_lower_precision"); }
  else if (secondsIntoWindow >= 30 && secondsIntoWindow < 45) { score -= 12; reasons.push("window_30_45_reduced_precision"); }
  else if (secondsIntoWindow >= 75 && secondsIntoWindow < 105) { score += 4; reasons.push("window_75_105_reduced_precision"); }
  else if (secondsIntoWindow >= 105) { score -= 16; reasons.push("window_after_105_low_precision"); }

  // Combined Optimization: Boost proven winners (BTC, BNB, XRP, SOL Up) and penalize toxic drains (DOGE, ETH, SOL Down) based on 6,641 historical settlements
  let symbolScore = 0;
  if (symbol === "BTC" || symbol === "BNB") {
    symbolScore = 35;
  } else if (symbol === "XRP") {
    symbolScore = 15;
  } else if (symbol === "SOL") {
    symbolScore = side === "UP" ? 15 : -50;
  } else if (symbol === "DOGE" || symbol === "ETH") {
    symbolScore = -80;
  }
  score += symbolScore;
  if (symbolScore > 0) reasons.push(`symbol_${symbol.toLowerCase()}_runtime_boost`);
  if (symbolScore < 0) reasons.push(`symbol_${symbol.toLowerCase()}_recovery_penalty`);

  const rankScores = { C: 20, B: 20, A: 0, "A+": -6, SKIP: -40 };
  const rankScore = finite(rankScores[rank], -30);
  score += rankScore;
  if (rank === "A" || rank === "A+") reasons.push("high_rank_overconfidence_execution_penalty");
  else if (rank === "B" || rank === "C") reasons.push("rank_b_c_sample_precision_boost");

  if (entryPrice >= 0.50 && entryPrice < 0.55) { score += 10; reasons.push("price_0_50_0_54_precision_boost"); }
  else if (entryPrice >= 0.65 && entryPrice < 0.70) { score -= 25; reasons.push("price_0_65_0_69_precision_penalty"); }
  else if (entryPrice >= 0.70) { score -= 45; reasons.push("price_over_0_70_precision_penalty"); }

  if (spreadCents <= 2) score += 6;
  else if (spreadCents > 5) { score -= 12; reasons.push("spread_over_5c_precision_penalty"); }

  if (micropriceEdgeCents >= 0) score += 6;
  else { score -= 12; reasons.push("microprice_adverse_execution_penalty"); }

  if (depthAdvantage >= 0) score += 6;
  else { score -= 12; reasons.push("depth_adverse_execution_penalty"); }

  if (depthPressure >= 0) score += 4;
  else score -= 8;

  if (replayBad) { score -= finite(config.executionReplayBadPenalty, 35); reasons.push("replay_bad_observe_unless_exceptional"); }
  if (runtimeToxic) { score -= finite(config.executionRuntimeToxicPenalty, 25); reasons.push("runtime_toxic_observe_unless_exceptional"); }

  if (edgePercent >= finite(config.executionSuspiciousEdgePercent, 20) && (micropriceEdgeCents < 0 || depthAdvantage < 0 || replayBad)) {
    score -= finite(config.executionSuspiciousEdgePenalty, 22);
    reasons.push("extreme_edge_unconfirmed_suspicious");
  }

  const cleanCandidate = Boolean(
    candidate.strategy === "current_prediction" &&
    !replayBad &&
    !runtimeToxic &&
    bookSource === "ws+ws" &&
    bookAgeMs <= finite(config.executionMaxReducedBookAgeMs, 750) &&
    micropriceEdgeCents >= 0 &&
    depthAdvantage >= 0 &&
    finite(candidate.softQualityStakeMultiplier, 1) >= finite(config.cleanCandidateMinSoftStakeMultiplier, 0.35)
  );
  if (cleanCandidate) {
    score += 8;
    reasons.push("clean_candidate_dynamic_stake_eligible");
  }

  const calibration = calibratedEntryProfile(candidate, config, {
    baseScore: score,
    replayBad,
    runtimeToxic,
  });
  score += finite(calibration.scoreAdjustment, 0);
  reasons.push(...(calibration.reasons || []));

  let threshold = finite(config.executionMinQualityScore, 104);
  let forcedObserveReason = "";
  if (side === "UP") threshold = Math.max(threshold, finite(config.cleanUpMinScore, 104));
  if (side === "DOWN") {
    threshold = Math.max(threshold, finite(config.cleanDownMinScore, 132));
    reasons.push("down_requires_stronger_confirmation");
  }
  if (config.edgeEngineEnabled !== false && calibration.enabled) {
    if (calibration.lane === "S") {
      threshold = Math.min(threshold, finite(config.edgeEngineLaneSQualityMinScore, 104));
      reasons.push("edge_engine_lane_s_quality_relief");
    } else if (calibration.lane === "A") {
      threshold = Math.min(threshold, side === "DOWN" ? finite(config.edgeEngineLaneADownQualityMinScore, 118) : finite(config.edgeEngineLaneAQualityMinScore, 94));
      reasons.push("edge_engine_lane_a_fast_quality_relief");
    } else if (calibration.lane === "B") {
      threshold = Math.min(threshold, side === "DOWN" ? finite(config.edgeEngineLaneBDownQualityMinScore, 112) : finite(config.edgeEngineLaneBQualityMinScore, 88));
      reasons.push("edge_engine_lane_b_probe_quality_relief");
    }
  }
  if (calibration.lane === "F") {
    threshold = Math.min(threshold, side === "DOWN" ? finite(config.cleanDownMinScore, 118) : finite(config.cleanUpMinScore, 96));
    reasons.push("fast_worth_it_lane_threshold_relief");
  }
  if (replayBad && side === "UP") {
    threshold = Math.max(threshold, finite(config.replayBlockUpMinScore, 142));
    reasons.push("replay_block_up_requires_exceptional_quality");
  }
  if (replayBad && side === "DOWN" && config.replayBlockDownObserveOnly !== false) {
    forcedObserveReason = "replay_block_down_observe_only";
    reasons.push(forcedObserveReason);
  }
  if (recoveryActive) {
    reasons.push("recent_drawdown_recovery_mode_active");
    if (config.recoveryReplayBlockObserveOnly !== false && replayBad) {
      forcedObserveReason = "recovery_replay_block_observe_only";
      reasons.push(forcedObserveReason);
    }
    if (side === "DOWN") {
      threshold = Math.max(threshold, finite(config.recoveryDownMinScore, 155));
      if (!cleanCandidate || replayBad) {
        forcedObserveReason = forcedObserveReason || "recovery_down_observe_until_extreme_confirmed";
        reasons.push("recovery_down_requires_extreme_confirmation");
      }
    }
  }
  if (runtimeToxic) {
    threshold += 10;
    reasons.push("runtime_toxic_raises_execution_threshold");
  }
  if (config.edgeEngineEnabled !== false && calibration.enabled && !calibration.approved) {
    forcedObserveReason = forcedObserveReason || calibration.reason || "edge_engine_observe_only";
    reasons.push("edge_engine_requires_positive_ev_and_fillable_book");
  } else if (calibration.enabled && !calibration.approved && score < finite(config.calibratedFastFallbackScoreMin, 102)) {
    forcedObserveReason = forcedObserveReason || calibration.reason || "calibrated_model_observe_only";
  }
  if (config.executionLowScoreObserveOnly !== false && !cleanCandidate && score <= finite(config.executionLowScoreObserveMax, 96)) {
    forcedObserveReason = forcedObserveReason || "execution_quality_low_band_observe_only";
    reasons.push("score_115_124_or_lower_observe_only");
  }

  const approved = !forcedObserveReason && score >= threshold;
  const reason = approved ? "execution_quality_pass" : (forcedObserveReason || "execution_quality_observe_only");
  return {
    approved,
    score,
    threshold,
    reason,
    reasons,
    observeOnly: !approved,
    cleanCandidate,
    recoveryActive,
    calibratedLane: calibration.lane || "legacy",
    calibratedWinProbability: calibration.winProbability,
    calibratedTargetWinProbability: calibration.targetWinProbability,
    calibratedStakeCapUsd: calibration.stakeCapUsd || null,
    calibratedProfile: calibration,
    edgeEngineProfile: calibration,
    estimatedWinProbability: calibration.estimatedWinProbability ?? calibration.winProbability,
    netEv: calibration.netEv,
    projectedFillPrice: calibration.projectedFillPrice,
    kellyLiteFraction: calibration.kellyLiteFraction,
    bucketExpectancy: calibration.bucketExpectancy,
    microstructure: calibration.microstructure,
  };
}

function getStrategyPerformance(config = {}, strategy = "") {
  const strategies = Array.isArray(config.strategyPerformance?.strategies) ? config.strategyPerformance.strategies : [];
  return strategies.find((item) => item.strategy === strategy) || null;
}

function getRuntimeStrategyPerformance(config = {}, strategy = "") {
  const strategies = Array.isArray(config.strategyRuntimePerformance?.strategies)
    ? config.strategyRuntimePerformance.strategies
    : [];
  return strategies.find((item) => item.strategy === strategy) || null;
}

function isStrategyForceAllowed(config = {}, strategy = "") {
  const allow = Array.isArray(config.strategyForceAllow) ? config.strategyForceAllow : [];
  return !allow.length || allow.includes(strategy);
}

function isStrategyForceBlocked(config = {}, strategy = "") {
  const block = Array.isArray(config.strategyForceBlock) ? config.strategyForceBlock : [];
  return block.includes(strategy);
}

function getStrategyBlockReason(candidate = {}, config = {}) {
  const strategy = candidate.strategy || "unknown";
  const executable = Array.isArray(config.executableStrategies) && config.executableStrategies.length
    ? config.executableStrategies
    : ["current_prediction"];
  if (!executable.includes(strategy)) return "strategy_not_executable";
  if (!isStrategyForceAllowed(config, strategy)) return "strategy_not_in_allowlist";
  if (isStrategyForceBlocked(config, strategy)) return "strategy_force_blocked";

  if (config.profitFocusMode && strategy !== "current_prediction") {
    return "strategy_disabled_by_profit_focus_current_prediction_only";
  }

  if (config.strategyAutoDisableEnabled === false) return "";
  if (config.strategyRuntimeAutoDisableEnabled !== false) {
    const runtimePerformance = getRuntimeStrategyPerformance(config, strategy);
    const runtimeSettled = finite(runtimePerformance?.real?.settled ?? runtimePerformance?.settled);
    const runtimeRoi = finite(runtimePerformance?.real?.roi ?? runtimePerformance?.roi);
    const runtimeWinRate = finite(runtimePerformance?.real?.winRate ?? runtimePerformance?.winRate);
    const runtimeMinSamples = finite(config.strategyRuntimeAutoDisableMinSamples, 20);
    const runtimeMinRoi = finite(config.strategyRuntimeAutoDisableMinRoi, -5);
    const runtimeMinWinRate = finite(config.strategyRuntimeAutoDisableMinWinRate, 45);

    if (runtimeSettled >= runtimeMinSamples && runtimeRoi < runtimeMinRoi) {
      return "strategy_runtime_negative_roi_auto_disabled";
    }
    if (runtimeSettled >= runtimeMinSamples && runtimeWinRate < runtimeMinWinRate) {
      return "strategy_runtime_low_winrate_auto_disabled";
    }
  }

  const performance = getStrategyPerformance(config, strategy);
  if (!performance) return "";
  const settled = finite(performance.real?.settled ?? performance.settled);
  const roi = finite(performance.real?.roi ?? performance.roi);
  const winRate = finite(performance.real?.winRate ?? performance.winRate);
  const minSamples = finite(config.strategyAutoDisableMinSamples, 50);
  const minRoi = finite(config.strategyAutoDisableMinRoi, 0);
  const minWinRate = finite(config.strategyAutoDisableMinWinRate, 50);

  if (settled >= minSamples && roi < minRoi) return "strategy_negative_roi_auto_disabled";
  if (settled >= minSamples && winRate < minWinRate) return "strategy_low_winrate_auto_disabled";
  return "";
}

function orderbookConfirmations(candidate = {}, config = {}) {
  const pressure = finite(candidate.depthPressure);
  const depthAdvantage = finite(candidate.depthAdvantage);
  const micropriceEdgeCents = finite(candidate.micropriceEdgeCents);
  return [
    pressure >= finite(config.qualityOrderbookMinPressure, 0.22),
    depthAdvantage >= finite(config.qualityOrderbookMinDepthAdvantage, 0.30),
    micropriceEdgeCents >= finite(config.qualityOrderbookMinMicroEdgeCents, 0.08),
  ].filter(Boolean).length;
}

function sampleQualityBlockReason(candidate = {}, config = {}) {
  if (config.sampleQualityGuardEnabled === false) return "";

  const side = String(candidate.side || "").toUpperCase();
  if (!side || side === "BOTH") return "";

  const strategy = String(candidate.strategy || "unknown");
  const entryPrice = finite(candidate.entryPrice);
  const edge = finite(candidate.feeAdjustedEdge ?? candidate.edge);
  const edgePercent = finite(candidate.selectedEdgePercent, edge * 100);
  const confidence = finite(candidate.confidence);
  const spreadCents = finite(candidate.spreadCents);
  const depthPressure = finite(candidate.depthPressure);
  const depthAdvantage = finite(candidate.depthAdvantage);
  const micropriceEdgeCents = finite(candidate.micropriceEdgeCents);
  const secondsIntoWindow = finite(candidate.secondsIntoWindow);
  const yesNoAskCost = finite(candidate.yesNoAskCost, 1);

  const adverseBookTriad =
    depthPressure < finite(config.qualityAdverseMaxDepthPressure, -0.05) &&
    depthAdvantage < finite(config.qualityAdverseMaxDepthAdvantage, -0.10) &&
    micropriceEdgeCents < finite(config.qualityAdverseMaxMicroEdgeCents, -0.02);

  if (adverseBookTriad) return "quality_sample_adverse_book_triad";

  const inflatedEdgePercent = finite(config.qualityInflatedEdgePercent, 30);
  const weakBookForInflatedEdge =
    depthPressure < finite(config.qualityInflatedEdgeMinDepthPressure, 0.05) ||
    depthAdvantage < finite(config.qualityInflatedEdgeMinDepthAdvantage, 0.10) ||
    micropriceEdgeCents < finite(config.qualityInflatedEdgeMinMicroEdgeCents, 0.02);
  if ((edgePercent >= inflatedEdgePercent || edge >= inflatedEdgePercent / 100) && weakBookForInflatedEdge) {
    return "quality_sample_inflated_edge_weak_book";
  }

  if (
    confidence >= finite(config.qualityOverconfidentMinConfidence, 98.5) &&
    weakBookForInflatedEdge
  ) {
    return "quality_sample_overconfident_weak_book";
  }

  if (
    secondsIntoWindow >= finite(config.qualityLateWeakBookSeconds, 180) &&
    entryPrice >= finite(config.qualityLateWeakBookEntryPrice, 0.55) &&
    depthAdvantage < finite(config.qualityLateWeakBookMinDepthAdvantage, 0.35)
  ) {
    return "quality_sample_late_weak_book";
  }

  if (
    spreadCents >= finite(config.qualityWeakBookWideSpreadCents, 4) &&
    depthPressure < finite(config.qualityWideSpreadMinDepthPressure, 0.20)
  ) {
    return "quality_sample_wide_spread_weak_depth";
  }

  if (
    yesNoAskCost >= finite(config.qualitySuspectAskCostMin, 0.95) &&
    yesNoAskCost < finite(config.qualitySuspectAskCostMax, 0.98) &&
    depthPressure < finite(config.qualitySuspectAskCostMinDepthPressure, 0.20)
  ) {
    return "quality_sample_suspect_complete_set_cost";
  }

  if (strategy === "price_field" && config.qualityPriceFieldSampleGuard !== false) {
    const hasBookSupport = depthPressure >= 0 || depthAdvantage >= 0.20 || micropriceEdgeCents >= 0.05;
    if (!hasBookSupport) return "quality_price_field_sample_book_weak";
  }

  return "";
}

function sampleQualityScore(candidate = {}) {
  const edge = finite(candidate.feeAdjustedEdge ?? candidate.edge);
  const edgePercent = finite(candidate.selectedEdgePercent, edge * 100);
  const depthPressure = finite(candidate.depthPressure);
  const depthAdvantage = finite(candidate.depthAdvantage);
  const micropriceEdgeCents = finite(candidate.micropriceEdgeCents);
  const spreadCents = finite(candidate.spreadCents);
  const askSlopeCents = finite(candidate.askSlopeCents);
  const bookAgeMs = finite(candidate.bookAgeMs);
  const secondsIntoWindow = finite(candidate.secondsIntoWindow);
  const confidence = finite(candidate.confidence);
  const positiveConfirmations = [
    depthPressure >= 0,
    depthAdvantage >= 0.10,
    micropriceEdgeCents >= 0.02,
  ].filter(Boolean).length;
  const adverseConfirmations = [
    depthPressure < -0.05,
    depthAdvantage < -0.10,
    micropriceEdgeCents < -0.02,
  ].filter(Boolean).length;

  let score = 0;
  score += positiveConfirmations * 18;
  score -= adverseConfirmations * 30;
  score += Math.max(0, depthPressure) * 16;
  score += Math.max(0, depthAdvantage) * 22;
  score += Math.max(0, micropriceEdgeCents) * 4;
  score += Math.min(30, Math.max(0, edgePercent));
  score += Math.min(20, Math.max(0, confidence - 60) * 0.5);
  score -= Math.max(0, spreadCents - 2) * 3;
  score -= Math.max(0, askSlopeCents - 12) * 1.2;
  score -= bookAgeMs / 750;
  if (secondsIntoWindow >= 180) score -= 12;
  if (edgePercent >= 30 && positiveConfirmations < 2) score -= 35;
  return score;
}


function priceBucketLabel(price) {
  const value = finite(price);
  if (value < 0.50) return "lt_0.50";
  if (value < 0.55) return "0.50_0.54";
  if (value < 0.60) return "0.55_0.59";
  if (value < 0.65) return "0.60_0.64";
  if (value < 0.70) return "0.65_0.69";
  if (value <= 0.82) return "0.70_0.82";
  return "gt_0.82";
}

function secondsBucketLabel(seconds) {
  const value = finite(seconds);
  if (value < 15) return "0_15";
  if (value < 30) return "15_30";
  if (value < 60) return "30_60";
  if (value < 75) return "60_75";
  if (value < 105) return "75_105";
  if (value < 135) return "105_135";
  return "135_plus";
}

function normalizedSymbol(candidate = {}) {
  const symbol = String(candidate.symbol || candidate.marketSymbol || "UNKNOWN").toUpperCase().trim();
  return symbol || "UNKNOWN";
}

function normalizedTimeframe(candidate = {}) {
  const timeframe = String(candidate.timeframe || candidate.marketTimeframe || "UNKNOWN").toUpperCase().trim();
  return timeframe || "UNKNOWN";
}

function normalizedBookSource(candidate = {}) {
  return String(candidate.bookSource || "unknown").toLowerCase().trim() || "unknown";
}

function runtimeBucketKeys(candidate = {}) {
  const side = String(candidate.side || "").toUpperCase() || "UNKNOWN";
  const symbol = normalizedSymbol(candidate);
  const timeframe = normalizedTimeframe(candidate);
  const priceBucket = priceBucketLabel(candidate.entryPrice);
  const secondsBucket = secondsBucketLabel(candidate.secondsIntoWindow);
  const rank = String(candidate.rank || "SKIP").toUpperCase();
  const bookSource = normalizedBookSource(candidate);
  return [
    `side:${side}`,
    `symbol:${symbol}`,
    `timeframe:${timeframe}`,
    `price:${priceBucket}`,
    `window:${secondsBucket}`,
    `rank:${rank}`,
    `book_source:${bookSource}`,
    `side_window:${side}:${secondsBucket}`,
    `symbol_side:${symbol}:${side}`,
    `symbol_timeframe:${symbol}:${timeframe}`,
    `side_price:${side}:${priceBucket}`,
    `side_price_window:${side}:${priceBucket}:${secondsBucket}`,
  ];
}

function runtimeAdaptiveModifier(candidate = {}, config = {}) {
  if (config.runtimeRuleCacheEnabled === false) {
    return { scoreAdjustment: 0, stakeMultiplier: 1, matchedBuckets: [], reason: "runtime_rule_cache_disabled" };
  }
  const buckets = config.runtimeRuleCache?.buckets || {};
  const weights = {
    side: 0.65,
    symbol: 0.55,
    timeframe: 0.35,
    price: 0.65,
    window: 0.65,
    rank: 0.35,
    book_source: 0.80,
    side_window: 0.95,
    symbol_side: 0.95,
    symbol_timeframe: 0.75,
    side_price: 0.95,
    side_price_window: 1.15,
  };
  const matchedBuckets = [];
  let weightedScore = 0;
  let weightedStakeDelta = 0;
  let totalWeight = 0;
  for (const key of runtimeBucketKeys(candidate)) {
    const bucket = buckets[key];
    if (!bucket || finite(bucket.trades) <= 0) continue;
    const type = key.split(":")[0];
    const weight = finite(weights[type], 0.5) * clamp(finite(bucket.confidenceWeight, 1), 0.25, 1.5);
    if (weight <= 0) continue;
    const scoreAdjustment = finite(bucket.scoreAdjustment);
    const stakeMultiplier = finite(bucket.stakeMultiplier, 1);
    weightedScore += scoreAdjustment * weight;
    weightedStakeDelta += (stakeMultiplier - 1) * weight;
    totalWeight += weight;
    matchedBuckets.push({
      key,
      trades: finite(bucket.trades),
      winRate: finite(bucket.winRate),
      roi: finite(bucket.roi),
      action: bucket.action || "neutral",
      toxic: Boolean(bucket.toxic || bucket.action === "probe_only_toxic"),
      scoreAdjustment,
      stakeMultiplier,
      weight,
    });
  }
  if (totalWeight <= 0) {
    return { scoreAdjustment: 0, stakeMultiplier: 1, matchedBuckets: [], reason: "runtime_rule_cache_neutral" };
  }
  const maxScoreAdjustment = Math.max(0, finite(config.runtimeRuleCacheMaxScoreAdjustment, 60));
  const minStakeMultiplier = clamp(finite(config.runtimeRuleCacheMinStakeMultiplier, 0.08), 0.05, 1);
  const maxStakeMultiplier = clamp(finite(config.runtimeRuleCacheMaxStakeMultiplier, 1.25), 1, 2);
  const toxicStakeMultiplier = clamp(finite(config.runtimeRuleCacheToxicStakeMultiplier, 0.10), minStakeMultiplier, 0.35);
  const toxicScorePenalty = -Math.max(1, Math.abs(finite(config.runtimeRuleCacheToxicScorePenalty, -60)));
  const toxicBuckets = matchedBuckets.filter((bucket) => bucket.toxic);
  let scoreAdjustment = clamp(weightedScore / Math.max(1, totalWeight / 2.5), -maxScoreAdjustment, maxScoreAdjustment);
  let stakeMultiplier = clamp(1 + weightedStakeDelta / Math.max(1, totalWeight / 2.5), minStakeMultiplier, maxStakeMultiplier);
  const negativeBuckets = matchedBuckets.filter((bucket) => bucket.scoreAdjustment < 0).length;
  const positiveBuckets = matchedBuckets.filter((bucket) => bucket.scoreAdjustment > 0).length;
  let reason = negativeBuckets > positiveBuckets ? "runtime_soft_penalty" : positiveBuckets > 0 ? "runtime_soft_boost" : "runtime_rule_cache_neutral";
  if (toxicBuckets.length > 0) {
    scoreAdjustment = Math.max(-maxScoreAdjustment, Math.min(scoreAdjustment, toxicScorePenalty));
    stakeMultiplier = Math.min(stakeMultiplier, toxicStakeMultiplier);
    reason = "runtime_toxic_probe_only";
  }
  return {
    scoreAdjustment,
    stakeMultiplier,
    matchedBuckets: matchedBuckets.slice(0, 8),
    toxicBuckets: toxicBuckets.slice(0, 8),
    reason,
  };
}

function softQualityModifier(candidate = {}, config = {}) {
  if (config.softQualityMode === false) return { scoreAdjustment: 0, stakeMultiplier: 1, reasons: [] };
  const reasons = [];
  let scoreAdjustment = 0;
  let stakeMultiplier = 1;
  const entryPrice = finite(candidate.entryPrice);
  const edge = finite(candidate.feeAdjustedEdge ?? candidate.edge);
  const rank = String(candidate.rank || "SKIP").toUpperCase();
  const side = String(candidate.side || "").toUpperCase();
  const spreadCents = finite(candidate.spreadCents);
  const depthPressure = finite(candidate.depthPressure);
  const depthAdvantage = finite(candidate.depthAdvantage);
  const micropriceEdgeCents = finite(candidate.micropriceEdgeCents);
  const secondsIntoWindow = finite(candidate.secondsIntoWindow);
  const positiveConfirmations = [depthPressure >= 0, depthAdvantage >= 0.10, micropriceEdgeCents >= 0.02].filter(Boolean).length;
  const adverseConfirmations = [depthPressure < -0.05, depthAdvantage < -0.10, micropriceEdgeCents < -0.02].filter(Boolean).length;

  if (sampleQualityBlockReason(candidate, config)) {
    reasons.push("legacy_sample_quality_soft_penalty");
    scoreAdjustment -= 18;
    stakeMultiplier *= 0.72;
  }
  if (rank === "C") {
    reasons.push("rank_c_probe_stake");
    scoreAdjustment -= 16;
    stakeMultiplier *= 0.45;
  }
  if (entryPrice >= 0.55 && entryPrice < 0.60) {
    reasons.push("price_0.55_0.59_reduced_stake_cap");
    scoreAdjustment -= 12;
    stakeMultiplier *= 0.65;
  } else if (entryPrice >= 0.60 && entryPrice < 0.65) {
    reasons.push("price_0.60_0.64_neutral_protected_bucket");
    scoreAdjustment -= positiveConfirmations >= 2 ? 0 : 6;
    stakeMultiplier *= positiveConfirmations >= 2 ? 1.00 : 0.85;
  } else if (entryPrice >= 0.65 && entryPrice < 0.70) {
    reasons.push("price_0.65_0.69_probe_stake_cap");
    scoreAdjustment -= 34;
    stakeMultiplier *= 0.15;
  } else if (entryPrice >= 0.70) {
    reasons.push("price_0.70_0.82_tiny_probe_stake_cut");
    scoreAdjustment -= 42;
    stakeMultiplier *= 0.10;
  } else if (entryPrice >= 0.50 && entryPrice < 0.55) {
    reasons.push("price_0.50_0.54_current_good_bucket_boost");
    scoreAdjustment += 8;
    stakeMultiplier *= 1.08;
  }
  if (secondsIntoWindow < 15) {
    reasons.push("window_0_15_tiny_probe_stake");
    scoreAdjustment -= 30;
    stakeMultiplier *= 0.15;
  } else if (secondsIntoWindow < 30) {
    reasons.push("window_15_30_probe_stake");
    scoreAdjustment -= 20;
    stakeMultiplier *= 0.35;
  } else if (secondsIntoWindow >= 75 && secondsIntoWindow < 105) {
    reasons.push("window_75_105_reduced_stake");
    scoreAdjustment -= 10;
    stakeMultiplier *= 0.65;
  } else if (secondsIntoWindow >= 105) {
    reasons.push("window_105_135_tiny_probe_stake");
    scoreAdjustment -= 28;
    stakeMultiplier *= 0.25;
  } else if (secondsIntoWindow >= 30 && secondsIntoWindow < 75) {
    reasons.push("window_30_75_current_good_bucket_boost");
    scoreAdjustment += 10;
    stakeMultiplier *= 1.08;
  }
  if (side === "DOWN") {
    reasons.push("down_recovery_probe_not_blocked");
    scoreAdjustment -= 32;
    stakeMultiplier *= 0.20;
  }
  if (normalizedSymbol(candidate) === "SOL") {
    reasons.push("sol_recovery_reduced_stake_not_blocked");
    scoreAdjustment -= 16;
    stakeMultiplier *= 0.35;
  }
  if (normalizedBookSource(candidate) === "rest+rest") {
    reasons.push("rest_rest_book_source_tiny_probe");
    scoreAdjustment -= 50;
    stakeMultiplier *= 0.10;
  }
  if (adverseConfirmations >= 2) {
    reasons.push("adverse_book_soft_penalty");
    scoreAdjustment -= 18;
    stakeMultiplier *= 0.55;
  } else if (positiveConfirmations >= 2) {
    reasons.push("book_confirmed_soft_boost");
    scoreAdjustment += 10;
    stakeMultiplier *= 1.08;
  }
  if (["A+", "A"].includes(rank) && positiveConfirmations < 2) {
    reasons.push("high_rank_overconfidence_probe_guard");
    scoreAdjustment -= 28;
    stakeMultiplier *= 0.35;
  }
  if (spreadCents > finite(config.qualityMaxSpreadCents, 12)) {
    reasons.push("wide_spread_soft_penalty");
    scoreAdjustment -= 16;
    stakeMultiplier *= 0.55;
  }
  if (edge >= 0.10 && positiveConfirmations >= 2) {
    reasons.push("extreme_edge_confirmed_soft_boost");
    scoreAdjustment += 12;
    stakeMultiplier *= 1.10;
  }

  return {
    scoreAdjustment: clamp(scoreAdjustment, -70, 28),
    stakeMultiplier: noDowngradeStakeMultiplier(clamp(stakeMultiplier, finite(config.runtimeRuleCacheMinStakeMultiplier, 0.08), finite(config.runtimeRuleCacheMaxStakeMultiplier, 1.25)), config),
    reasons,
  };
}

function momentumAgainstSignal(candidate = {}, config = {}) {
  const threshold = Math.max(0, finite(config.qualityMomentumAgainstMaxBps, 2));
  if (threshold <= 0) return false;
  const side = String(candidate.side || "").toUpperCase();
  const momentums = [
    finite(candidate.momentum15Bps),
    finite(candidate.momentum30Bps),
    finite(candidate.momentum60Bps),
  ].filter((value) => Math.abs(value) > 0);
  if (!momentums.length) return false;
  if (side === "UP") return Math.min(...momentums) <= -threshold;
  if (side === "DOWN") return Math.max(...momentums) >= threshold;
  return false;
}

function passesDualSideTimeGuard(candidate = {}, config = {}) {
  const secondsIntoWindow = finite(candidate.secondsIntoWindow);
  const rank = String(candidate.rank || "SKIP").toUpperCase();
  const edge = finite(candidate.feeAdjustedEdge ?? candidate.edge);
  const depthAdvantage = finite(candidate.depthAdvantage);
  const micropriceEdgeCents = finite(candidate.micropriceEdgeCents);
  const restrictSeconds = finite(config.qualityDualSideRestrictAfterSeconds, 75);
  const aPlusSeconds = finite(config.qualityDualSideAPlusAfterSeconds, 105);
  const hardBlockSeconds = finite(config.qualityDualSideHardBlockAfterSeconds, 135);

  if (secondsIntoWindow >= hardBlockSeconds) return "quality_time_hard_block_after_135s";
  if (config.softQualityMode !== false) return "";

  if (secondsIntoWindow >= aPlusSeconds) {
    if (rank !== "A+") return "quality_late_105_135_requires_a_plus";
    if (edge < finite(config.qualityDualSideLateAPlusMinEdge, 0.060)) return "quality_late_105_135_edge_weak";
    if (depthAdvantage < finite(config.qualityDualSideLateAPlusMinDepthAdvantage, 0.20)) return "quality_late_105_135_depth_unconfirmed";
    if (micropriceEdgeCents < finite(config.qualityDualSideLateAPlusMinMicroEdgeCents, 0.04)) return "quality_late_105_135_micro_unconfirmed";
  } else if (secondsIntoWindow >= restrictSeconds) {
    if (!["A+", "A"].includes(rank)) return "quality_late_75_105_requires_a_or_a_plus";
    if (edge < finite(config.qualityDualSideRestrictedMinEdge, 0.035)) return "quality_late_75_105_edge_weak";
    if (depthAdvantage < finite(config.qualityDualSideRestrictedMinDepthAdvantage, 0.10)) return "quality_late_75_105_depth_unconfirmed";
    if (micropriceEdgeCents < finite(config.qualityDualSideRestrictedMinMicroEdgeCents, 0.02)) return "quality_late_75_105_micro_unconfirmed";
  }

  return "";
}

function getDownSidePenaltyBlockReason(candidate = {}, config = {}) {
  if (config.softQualityMode !== false) return "";
  if (String(candidate.side || "").toUpperCase() !== "DOWN") return "";
  const edge = finite(candidate.feeAdjustedEdge ?? candidate.edge);
  const depthAdvantage = finite(candidate.depthAdvantage);
  const micropriceEdgeCents = finite(candidate.micropriceEdgeCents);
  if (edge < finite(config.qualityDownMinEdge, 0.021)) return "quality_down_edge_weak";
  if (depthAdvantage < finite(config.qualityDownMinDepthAdvantage, -0.10)) return "quality_down_depth_unconfirmed";
  if (micropriceEdgeCents < finite(config.qualityDownMinMicroEdgeCents, -0.01)) return "quality_down_micro_unconfirmed";
  return "";
}

function getCandidateQualityBlockReason(candidate = {}, config = {}) {
  if (config.candidateQualityEnabled === false) return "";

  const strategy = candidate.strategy || "unknown";
  const side = String(candidate.side || "").toUpperCase();
  const rank = String(candidate.rank || "SKIP").toUpperCase();
  const entryPrice = finite(candidate.entryPrice);
  const edge = finite(candidate.feeAdjustedEdge ?? candidate.edge);
  const spreadCents = finite(candidate.spreadCents);
  const depthPressure = finite(candidate.depthPressure);
  const depthAdvantage = finite(candidate.depthAdvantage);
  const micropriceEdgeCents = finite(candidate.micropriceEdgeCents);
  const secondsIntoWindow = finite(candidate.secondsIntoWindow);
  const maxSpreadCents = finite(config.qualityMaxSpreadCents, finite(config.maxSpreadCents, 8));
  const highEntryPrice = finite(config.qualityHighEntryPrice, 0.72);
  const highEntryMinEdge = finite(config.qualityHighPriceMinEdge, 0.08);
  const hardMinEntryPrice = finite(config.qualityEntryPriceMin, 0.50);
  const hardMaxEntryPrice = finite(config.qualityEntryPriceMax, 0.82);

  if (strategy !== "dual_side_ev") return "quality_non_dual_side_ev_watch_only";
  if (entryPrice < hardMinEntryPrice) return "quality_entry_price_below_0_50";
  if (entryPrice > hardMaxEntryPrice) return "quality_entry_price_above_0_82";
  if (strategy === "dual_side_ev" && secondsIntoWindow >= finite(config.qualityDualSideHardBlockAfterSeconds, 135)) {
    return "quality_time_hard_block_after_135s";
  }

  if (rank === "C" && config.qualityCEntryEnabled !== true) return "quality_rank_c_watch_only";
  if (spreadCents > maxSpreadCents) return "quality_spread_too_wide";
  if (momentumAgainstSignal(candidate, config)) return "quality_momentum_against_signal";

  if (config.softQualityMode !== false) return "";
  const sampleBlockReason = sampleQualityBlockReason(candidate, config);
  if (sampleBlockReason) return sampleBlockReason;
  if (entryPrice >= highEntryPrice && edge < highEntryMinEdge) return "quality_expensive_entry_low_edge";

  if (rank === "A+" && config.qualityAPlusRequireBookConfirmation !== false) {
    if (depthPressure < finite(config.qualityAPlusMinDepthPressure, 0.05)) return "quality_a_plus_depth_pressure_unconfirmed";
    if (depthAdvantage < finite(config.qualityAPlusMinDepthAdvantage, 0.10)) return "quality_a_plus_depth_advantage_unconfirmed";
    if (micropriceEdgeCents < finite(config.qualityAPlusMinMicroEdgeCents, 0.01)) return "quality_a_plus_micro_unconfirmed";
  }

  if (secondsIntoWindow >= finite(config.qualityLateWindowSeconds, 180) && entryPrice >= finite(config.qualityLateEntryPrice, 0.62)) {
    if (edge < finite(config.qualityLateEntryMinEdge, 0.18)) return "quality_late_expensive_edge_weak";
    if (depthAdvantage < finite(config.qualityLateEntryMinDepthAdvantage, 0.35)) return "quality_late_expensive_depth_unconfirmed";
    if (micropriceEdgeCents < finite(config.qualityLateEntryMinMicroEdgeCents, 0.03)) return "quality_late_expensive_micro_unconfirmed";
  }

  if (strategy === "price_field") {
    const minEdge = side === "DOWN"
      ? finite(config.qualityPriceFieldDownMinEdge, 0.09)
      : finite(config.qualityPriceFieldMinEdge, 0.065);
    if (edge < minEdge) return "quality_price_field_edge_weak";
    if (depthAdvantage < finite(config.qualityPriceFieldMinDepthAdvantage, 0.18)) {
      return "quality_price_field_depth_unconfirmed";
    }
    if (micropriceEdgeCents < finite(config.qualityPriceFieldMinMicroEdgeCents, 0.04)) {
      return "quality_price_field_micro_unconfirmed";
    }
  }

  if (strategy === "dual_side_ev") {
    const exceptionalEdge = edge >= finite(config.qualityExceptionalEdge, 0.13);
    const exceptionalBookConfirmed = exceptionalEdge &&
      depthPressure >= finite(config.qualityExceptionalMinDepthPressure, 0) &&
      depthAdvantage >= finite(config.qualityExceptionalMinDepthAdvantage, 0.10) &&
      micropriceEdgeCents >= finite(config.qualityExceptionalMinMicroEdgeCents, 0.02);
    if (edge < finite(config.qualityDualSideMinEdge, 0.006)) return "quality_dual_side_edge_weak";
    const timeGuardReason = passesDualSideTimeGuard(candidate, config);
    if (timeGuardReason) return timeGuardReason;
    const downGuardReason = getDownSidePenaltyBlockReason(candidate, config);
    if (downGuardReason) return downGuardReason;
    if (!exceptionalBookConfirmed && depthAdvantage < finite(config.qualityDualSideMinDepthAdvantage, -0.15)) {
      return "quality_dual_side_depth_unconfirmed";
    }
    if (!exceptionalBookConfirmed && micropriceEdgeCents < finite(config.qualityDualSideMinMicroEdgeCents, -0.02)) {
      return "quality_dual_side_micro_unconfirmed";
    }
  }

  if (strategy === "orderbook_pressure") {
    if (edge < finite(config.qualityOrderbookMinEdge, 0.03)) return "quality_orderbook_edge_weak";
    if (orderbookConfirmations(candidate, config) < finite(config.qualityOrderbookMinConfirmations, 2)) {
      return "quality_orderbook_unconfirmed";
    }
  }

  return "";
}

function buildStrategyCandidates(prediction = {}, config = {}) {
  if (!prediction || prediction.status !== "live") return [];
  const predictedSide = String(prediction.predictedOutcome || "").toUpperCase() === "DOWN" ? "DOWN" : "UP";
  const candidates = [];

  if (config.currentPredictionEnabled !== false) {
    candidates.push(baseCandidate(prediction, "current_prediction", predictedSide, {
      confidence: finite(prediction.confidence),
      probability: finite(prediction.selectedProbability),
      feeAdjustedEdge: finite(prediction.feeAdjustedEdge),
      edge: finite(prediction.feeAdjustedEdge),
      rank: prediction.rank || "SKIP",
      reasons: ["base prediction engine candidate", prediction.reason].filter(Boolean),
    }));
  }

  if (config.priceFieldEnabled !== false) {
    const timeBoost = prediction.secondsIntoWindow >= 150 || prediction.secondsIntoWindow <= 45 ? 5 : 0;
    const distanceBoost = clamp(finite(prediction.volatilityAdjustedDistance) * 5, 0, 12);
    const bookSignal = sideDepthSignal(prediction, predictedSide);
    const bookBoost = sideBookBoost(bookSignal);
    const bookPenalty = sideBookPenalty(bookSignal);
    const candidate = baseCandidate(prediction, "price_field", predictedSide, {
      confidence: clamp(finite(prediction.confidence) + timeBoost + distanceBoost + bookBoost * 100 - bookPenalty * 80, 1, 99),
      feeAdjustedEdge: finite(prediction.feeAdjustedEdge) + distanceBoost / 1000 + bookBoost * 0.25 - bookPenalty,
      reasons: [
        "distance-to-target, time field, and book support aligned",
        `voldist=${finite(prediction.volatilityAdjustedDistance).toFixed(2)}`,
        `bookPenalty=${bookPenalty.toFixed(3)}`,
      ],
    });
    candidate.rank = rankCandidate(candidate.confidence, candidate.feeAdjustedEdge, candidate.entryPrice, candidate.spreadCents);
    candidates.push(candidate);
  }

  if (config.dualSideEnabled !== false) {
    for (const side of ["UP", "DOWN"]) {
      const bookSignal = sideDepthSignal(prediction, side);
      const bookBoost = sideBookBoost(bookSignal);
      const bookPenalty = sideBookPenalty(bookSignal);
      const downProbabilityPenalty = side === "DOWN" ? finite(config.qualityDownProbabilityPenalty, 0) : 0;
      const downScorePenalty = side === "DOWN" ? finite(config.qualityDownEdgePenalty, 0) : 0;
      const assetProbability = sideAssetProbability(prediction, side);
      const assetConfidence = clamp(assetProbability * 100, 1, 99);
      const probability = clamp(sideProbability(prediction, side) + bookBoost - bookPenalty - downProbabilityPenalty, 0.01, 0.99);
      const prices = sidePrice(prediction, side);
      const edge = probability - prices.entryPrice - finite(prediction.feeEstimate, 0.003) - downScorePenalty;
      const confidence = clamp(probability * 100 + Math.max(0, bookSignal.depthAdvantage) * 8 - bookPenalty * 80 - (side === "DOWN" ? finite(config.qualityDownConfidencePenalty, 0) : 0), 1, 99);
      const assetNetEdge = assetProbability - prices.entryPrice - finite(prediction.feeEstimate, 0.003) - 0.005;
      const bookConfirmationScore = sideBookConfirmationScore(bookSignal);
      const candidate = baseCandidate(prediction, "dual_side_ev", side, {
        confidence,
        probability,
        assetProbability,
        assetConfidence,
        assetNetEdge,
        feeAdjustedEdge: edge,
        edge,
        bookConfirmationScore,
        // Zero means neutral/non-contradictory, not affirmative confirmation.
        bookConfirmed: bookConfirmationScore > 0,
        bookRankAdjustment: bookConfirmationScore * 12,
        oddsVelocity: Math.max(Math.abs(finite(prediction.selectedEdgePercent)) / 1000, Math.max(0, bookSignal.micropriceEdgeCents) / 100),
        dislocationScore: clamp(Math.abs(bookSignal.depthAdvantage) + Math.abs(bookSignal.micropriceEdgeCents) / 10, 0, 1),
        reasons: [
          "legacy dual-side score retained for frozen calibration; independent asset EV gates eligibility",
          `pressure=${bookSignal.pressure.toFixed(2)}`,
          `adv=${bookSignal.depthAdvantage.toFixed(2)}`,
          `bookPenalty=${bookPenalty.toFixed(3)}`,
          `bookConfirmation=${bookConfirmationScore.toFixed(3)}`,
        ],
      });
      candidate.rank = rankCandidate(candidate.confidence, candidate.feeAdjustedEdge, candidate.entryPrice, candidate.spreadCents);
      candidates.push(candidate);
    }
  }

  if (config.orderbookPressureEnabled !== false) {
    for (const side of ["UP", "DOWN"]) {
      const bookSignal = sideDepthSignal(prediction, side);
      const enoughPressure = [
        bookSignal.pressure >= finite(config.qualityOrderbookMinPressure, 0.22),
        bookSignal.depthAdvantage >= finite(config.qualityOrderbookMinDepthAdvantage, 0.30),
        bookSignal.micropriceEdgeCents >= finite(config.qualityOrderbookMinMicroEdgeCents, 0.08),
      ].filter(Boolean).length >= finite(config.qualityOrderbookMinConfirmations, 2);
      if (!enoughPressure) continue;
      const pressureBoost = clamp(bookSignal.pressure * 0.05 + bookSignal.depthAdvantage * 0.09 + bookSignal.micropriceEdgeCents * 0.012, 0, 0.14);
      const probability = clamp(Math.max(sideProbability(prediction, side), 0.58) + pressureBoost, 0.01, 0.99);
      const prices = sidePrice(prediction, side);
      const edge = probability - prices.entryPrice - finite(prediction.feeEstimate, 0.003);
      const confidence = clamp(probability * 100 + Math.min(10, finite(prediction.volatilityAdjustedDistance) * 2), 1, 99);
      const candidate = baseCandidate(prediction, "orderbook_pressure", side, {
        confidence,
        probability,
        feeAdjustedEdge: edge,
        edge,
        oddsVelocity: clamp(Math.max(0, bookSignal.micropriceEdgeCents) / 80 + Math.max(0, bookSignal.depthAdvantage) / 10, 0, 1),
        dislocationScore: clamp(Math.max(0, bookSignal.depthAdvantage) + Math.max(0, bookSignal.pressure), 0, 1),
        reasons: [
          "5-depth book pressure candidate",
          `bidAskPressure=${bookSignal.pressure.toFixed(2)}`,
          `microEdge=${bookSignal.micropriceEdgeCents.toFixed(2)}c`,
        ],
      });
      candidate.rank = rankCandidate(candidate.confidence, candidate.feeAdjustedEdge, candidate.entryPrice, candidate.spreadCents);
      candidates.push(candidate);
    }
  }

  if (config.stickyLagEnabled !== false) {
    const momentumSide = finite(prediction.momentum15Bps) >= 0 ? "UP" : "DOWN";
    const lagSide = Math.abs(finite(prediction.momentum15Bps)) >= 0.5 ? momentumSide : predictedSide;
    const prices = sidePrice(prediction, lagSide);
    const lagStrength = clamp(Math.abs(finite(prediction.momentum15Bps)) / 10 + Math.abs(finite(prediction.momentum30Bps)) / 18, 0, 18);
    const candidate = baseCandidate(prediction, "sticky_lag", lagSide, {
      confidence: clamp(58 + lagStrength + finite(prediction.volatilityAdjustedDistance) * 2, 1, 99),
      feeAdjustedEdge: (lagSide === "UP" ? finite(prediction.probabilityUp, 0.5) : finite(prediction.probabilityDown, 0.5)) - prices.entryPrice + lagStrength / 1200,
      oddsVelocity: lagStrength / 100,
      dislocationScore: clamp(lagStrength / 20, 0, 1),
      reasons: ["BTC spot momentum appears ahead of Polymarket odds", `momentum15=${finite(prediction.momentum15Bps).toFixed(2)}bps`],
    });
    candidate.rank = rankCandidate(candidate.confidence, candidate.feeAdjustedEdge, candidate.entryPrice, candidate.spreadCents);
    candidates.push(candidate);
  }

  if (config.newMemberBandEnabled !== false) {
    const upOk = finite(prediction.upBuyPrice) >= finite(config.newMemberEntryPriceMin, 0.14) && finite(prediction.upBuyPrice) <= finite(config.newMemberEntryPriceMax, 0.30);
    const downOk = finite(prediction.downBuyPrice) >= finite(config.newMemberEntryPriceMin, 0.14) && finite(prediction.downBuyPrice) <= finite(config.newMemberEntryPriceMax, 0.30);
    const timeOk = finite(prediction.secondsIntoWindow) >= finite(config.newMemberEntryTimeMin, 25) && finite(prediction.secondsIntoWindow) <= finite(config.newMemberEntryTimeMax, 90);
    if (timeOk && (upOk || downOk)) {
      const side = upOk && (!downOk || finite(prediction.upBuyPrice) <= finite(prediction.downBuyPrice)) ? "UP" : "DOWN";
      const candidate = baseCandidate(prediction, "new_member_band", side, {
        confidence: 62,
        feeAdjustedEdge: Math.max(0.004, (side === "UP" ? finite(prediction.probabilityUp, 0.5) : finite(prediction.probabilityDown, 0.5)) - sidePrice(prediction, side).entryPrice),
        reasons: ["early cheap-side price band hit", `window=${prediction.secondsIntoWindow}s`],
      });
      candidate.rank = rankCandidate(candidate.confidence, candidate.feeAdjustedEdge, candidate.entryPrice, candidate.spreadCents);
      candidates.push(candidate);
    }
  }

  if (config.endcycleSniperEnabled !== false) {
    const timeOk = finite(prediction.secondsIntoWindow) >= finite(config.endcycleMinSecondsIntoWindow, 240) && finite(prediction.secondsIntoWindow) <= finite(config.endcycleMaxSecondsIntoWindow, 295);
    if (timeOk) {
      const candidate = baseCandidate(prediction, "endcycle_sniper", predictedSide, {
        confidence: clamp(Math.max(finite(prediction.confidence), finite(prediction.selectedBuyPrice) * 100), 1, 99),
        feeAdjustedEdge: finite(prediction.feeAdjustedEdge) + 0.002,
        riskFlags: finite(prediction.selectedBuyPrice) > 0.97 ? ["endcycle_price_extreme"] : [],
        reasons: ["late-window high-confidence paper sniper candidate"],
      });
      candidate.rank = rankCandidate(candidate.confidence, candidate.feeAdjustedEdge, candidate.entryPrice, candidate.spreadCents);
      candidates.push(candidate);
    }
  }

  if (config.completeSetArbEnabled === true) {
    const askCost = finite(prediction.upBuyPrice) + finite(prediction.downBuyPrice);
    const grossEdge = 1 - askCost;
    if (askCost > 0 && grossEdge >= finite(config.completeSetMinEdge, 0.01)) {
      candidates.push({
        ...baseCandidate(prediction, "complete_set_arbitrage", "BOTH", {
          action: "BUY_COMPLETE_SET",
          confidence: clamp(60 + grossEdge * 100, 1, 99),
          probability: 1,
          feeAdjustedEdge: grossEdge - finite(config.completeSetFeeBuffer, 0.004),
          edge: grossEdge,
          entryPrice: askCost,
          bidPrice: finite(prediction.bidCost, 0),
          spreadCents: Math.max(0, (askCost - finite(prediction.bidCost, askCost)) * 100),
          depthShares: Math.min(finite(prediction.upDepthShares), finite(prediction.downDepthShares)),
          reasons: ["UP+DOWN complete-set cost below payout"],
        }),
        rank: grossEdge >= 0.03 ? "A" : "B",
      });
    }
  }

  const enrichedCandidates = candidates
    .map((candidate) => {
      const symbol = normalizedSymbol(candidate);
      const side = String(candidate.side || "").toUpperCase();
      const symbolPerf = getSymbolRecentPerformance(symbol, prediction.signals || []);
      const symbolSidePerf = getSymbolSideRecentPerformance(symbol, side, prediction.signals || []);
      
      let recentLossPenalty = 0;
      const recentLossReasons = [];
      
      if (symbolPerf.streak >= 2) {
        const penalty = symbolPerf.streak * 25;
        recentLossPenalty += penalty;
        recentLossReasons.push(`symbol_${symbol.toLowerCase()}_loss_streak_${symbolPerf.streak}_penalty`);
      }
      if (symbolPerf.winRate < 40 && symbolPerf.wins + symbolPerf.losses >= 3) {
        recentLossPenalty += 30;
        recentLossReasons.push(`symbol_${symbol.toLowerCase()}_low_winrate_${symbolPerf.winRate.toFixed(0)}%_penalty`);
      }
      if (symbolSidePerf.streak >= 2) {
        const penalty = symbolSidePerf.streak * 30;
        recentLossPenalty += penalty;
        recentLossReasons.push(`symbol_side_${symbol.toLowerCase()}_${side.toLowerCase()}_loss_streak_${symbolSidePerf.streak}_penalty`);
      }
      if (symbolSidePerf.winRate < 30 && symbolSidePerf.wins + symbolSidePerf.losses >= 2) {
        recentLossPenalty += 40;
        recentLossReasons.push(`symbol_side_${symbol.toLowerCase()}_${side.toLowerCase()}_low_winrate_${symbolSidePerf.winRate.toFixed(0)}%_penalty`);
      }

      const replay = evaluateReplayOptimizer(candidate, config.replayOptimizer);
      const runtimeModifier = runtimeAdaptiveModifier(candidate, config);
      const softQuality = softQualityModifier(candidate, config);
      const rawStrategyBlockReason = getStrategyBlockReason(candidate, config);
      const strategyBlockReason = rerankOnlyQualityReason(rawStrategyBlockReason, config) ? "" : rawStrategyBlockReason;
      const replayWasBlocked = replay.approved === false || String(replay.reason || "").toLowerCase().includes("replay_block");
      const replaySoftStakeMultiplier = isNoStakeReduction(config)
        ? 1
        : (config.softQualityMode !== false && replayWasBlocked)
          ? (String(candidate.side || "").toUpperCase() === "DOWN"
              ? finite(config.replaySoftBlockDownStakeMultiplier, 0.45)
              : finite(config.replaySoftBlockUpStakeMultiplier, 0.65))
          : finite(replay.stakeMultiplier, 1);
      const replaySoftScorePenalty = (config.softQualityMode !== false && replayWasBlocked)
        ? finite(config.replaySoftBlockScorePenalty, 10)
        : 0;
      const rawReplayBlockReason = replay.approved === false ? replay.reason : "";
      const replayBlockReason = rerankOnlyQualityReason(rawReplayBlockReason, config) ? "" : (config.softQualityMode !== false ? "" : rawReplayBlockReason);
      const fastWorthIt = isFastWorthItCandidate(candidate, config);
      const effectiveRank = candidate.rank === "SKIP" && fastWorthIt ? "C" : candidate.rank;
      const candidateWithRank = { ...candidate, rank: effectiveRank };
      const rawQualityBlockReason = getCandidateQualityBlockReason(candidateWithRank, config);
      const qualityBlockReason = rerankOnlyQualityReason(rawQualityBlockReason, config) ? "" : rawQualityBlockReason;
      const qualityRerankReasons = [rawStrategyBlockReason, rawReplayBlockReason, rawQualityBlockReason].filter((reason) => rerankOnlyQualityReason(reason, config));
      const enrichedCandidate = {
        ...candidate,
        rank: effectiveRank,
        fastWorthIt,
        bridgeReason: fastWorthIt ? "fast_worth_it_dual_side_candidate_promoted" : candidate.bridgeReason,
        replayOptimizer: replay,
        runtimeRuleCache: runtimeModifier,
        runtimeScoreAdjustment: finite(runtimeModifier.scoreAdjustment),
        runtimeStakeMultiplier: noDowngradeStakeMultiplier(runtimeModifier.stakeMultiplier, config),
        runtimeMatchedBuckets: runtimeModifier.matchedBuckets || [],
        runtimeRuleReason: runtimeModifier.reason || "runtime_rule_cache_neutral",
        softQuality,
        softQualityScoreAdjustment: finite(softQuality.scoreAdjustment),
        softQualityStakeMultiplier: noDowngradeStakeMultiplier(softQuality.stakeMultiplier, config),
        softQualityReasons: softQuality.reasons || [],
        replayStakeMultiplier: noDowngradeStakeMultiplier(replaySoftStakeMultiplier, config),
        replayOriginalStakeMultiplier: finite(replay.stakeMultiplier, 1),
        replaySoftStakeMultiplier,
        replayScoreAdjustment: finite(replay.scoreAdjustment) - replaySoftScorePenalty,
        replaySoftScorePenalty,
        replaySoftBlocked: replayWasBlocked,
        replayBlockReason,
        strategyBlockReason,
        qualityBlockReason,
        recentLossPenalty,
        recentLossReasons,
      };
      const executionQuality = executionQualityProfile(enrichedCandidate, config);
      const rawExecutionBlockReason = executionQuality.approved ? "" : executionQuality.reason;
      const executionBlockReason = rerankOnlyQualityReason(rawExecutionBlockReason, config) ? "" : rawExecutionBlockReason;
      const allQualityRerankReasons = [...qualityRerankReasons, rawExecutionBlockReason].filter((reason) => rerankOnlyQualityReason(reason, config));
      const preBlockReason = strategyBlockReason || replayBlockReason || qualityBlockReason || executionBlockReason;
      return {
        ...enrichedCandidate,
        executionQuality,
        executionQualityScore: finite(executionQuality.score),
        executionQualityThreshold: finite(executionQuality.threshold),
        executionQualityReasons: executionQuality.reasons || [],
        executionObserveOnly: Boolean(executionQuality.observeOnly),
        calibratedLane: executionQuality.calibratedLane || "legacy",
        calibratedWinProbability: executionQuality.calibratedWinProbability,
        calibratedTargetWinProbability: executionQuality.calibratedTargetWinProbability,
        calibratedProfile: executionQuality.calibratedProfile || null,
        edgeEngineProfile: executionQuality.edgeEngineProfile || executionQuality.calibratedProfile || null,
        estimatedWinProbability: executionQuality.estimatedWinProbability ?? executionQuality.calibratedWinProbability,
        netEv: executionQuality.netEv ?? executionQuality.calibratedProfile?.netEv,
        projectedFillPrice: executionQuality.projectedFillPrice ?? executionQuality.calibratedProfile?.projectedFillPrice,
        kellyLiteFraction: executionQuality.kellyLiteFraction ?? executionQuality.calibratedProfile?.kellyLiteFraction,
        bucketExpectancy: executionQuality.bucketExpectancy ?? executionQuality.calibratedProfile?.bucketExpectancy,
        microstructure: executionQuality.microstructure ?? executionQuality.calibratedProfile?.microstructure,
        executionBlockReason,
        qualityRerankReasons: allQualityRerankReasons,
        qualityRerankPenalty: allQualityRerankReasons.reduce((sum, reason) => sum + qualityPenaltyForReason(reason), 0),
        preBlockReason,
      };
    })
    // In fast-grow/no-entry-reduction mode, SKIP is a quality rank rather than
    // a technical invalidity. Keep it available for the evidence lane, which
    // still enforces real model, direction, source, time and fill invariants.
    .filter((candidate) => candidate.entryPrice > 0 && (candidate.rank !== "SKIP" || isNoEntryReduction(config)));

  return applyV351FastSideCompetition(enrichedCandidates, config)
    .map((candidate) => ({
      ...candidate,
      score: strategyScore(candidate) + finite(candidate.replayScoreAdjustment) - (candidate.preBlockReason ? 10_000 : finite(candidate.qualityRerankPenalty, 0)),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, finite(config.maxCandidates, 12));
}

function evaluateStrategyRouter({ prediction, accountRisk = {}, config = {} } = {}) {
  const rawCandidates = buildStrategyCandidates(prediction, config);
  const candidates = rawCandidates.map((candidate) => {
    const consensus = runConsensusEngine(candidate, accountRisk, {
      minEdge: config.minEdge,
      maxSpreadCents: config.maxSpreadCents,
      maxBookAgeMs: config.maxBookAgeMs,
      minConfidence: config.minConfidence,
      minAgents: config.consensusMinAgents,
      maxActivePositions: config.maxActivePositions,
      allowSingleAgentTinyEntry: config.allowSingleAgentTinyEntry,
      singleAgentStakeMultiplier: config.singleAgentStakeMultiplier,
    });
    const rawStakeMultiplier = finite(consensus.stakeMultiplier, 1) * finite(candidate.replayStakeMultiplier, 1) * finite(candidate.runtimeStakeMultiplier, 1) * finite(candidate.softQualityStakeMultiplier, 1);
    const withConsensus = {
      ...candidate,
      consensus,
      consensusAgreement: consensus.agreementCount,
      stakeMultiplier: noDowngradeStakeMultiplier(rawStakeMultiplier, config),
    };
    const gates = evaluateGateProtocol(withConsensus, accountRisk, config);
    const preBlockReason = candidate.preBlockReason || "";
    const consensusReason = consensus.approved ? "" : consensus.reason;
    const gatesReason = gates.approved ? "" : gates.reason;
    const consensusApproved = consensus.approved || (isNoEntryReduction(config) && rerankOnlyQualityReason(consensusReason, config));
    const gatesApproved = gates.approved || (isNoEntryReduction(config) && rerankOnlyQualityReason(gatesReason, config));
    const preBlockedAt = preBlockReason
      ? {
          gateId: "strategy_quality",
          name: "strategy_quality",
          passed: false,
          status: "BLOCKED",
          reason: preBlockReason,
        }
      : null;
    const approved = !preBlockReason && consensusApproved && gatesApproved;
    const noDowngradeRerankReasons = [
      ...(candidate.qualityRerankReasons || []),
      ...(candidate.recentLossReasons || []),
      consensusReason,
      gatesReason,
    ].filter((reason) => rerankOnlyQualityReason(reason, config));
    return {
      ...withConsensus,
      gates,
      approved,
      noDowngradeRerankReasons,
      noDowngradeOriginalBlockedReason: noDowngradeRerankReasons.join("|"),
      blockedReason: approved ? "" : preBlockReason || (!consensusApproved ? consensus.reason : gates.reason),
      blockedAt: approved ? null : preBlockedAt || gates.blockedAt,
    };
  });
  const selected = candidates.find((candidate) => candidate.approved) || null;

  return {
    enabled: config.enabled !== false,
    mode: config.mode || "paper",
    candidates,
    selected,
    summary: {
      total: candidates.length,
      approved: candidates.filter((candidate) => candidate.approved).length,
      blocked: candidates.filter((candidate) => !candidate.approved).length,
      selectedStrategy: selected?.strategy || "none",
      selectedSide: selected?.side || "WAIT",
    },
    updatedAt: new Date().toISOString(),
  };
}

export { buildStrategyCandidates, evaluateStrategyRouter };
