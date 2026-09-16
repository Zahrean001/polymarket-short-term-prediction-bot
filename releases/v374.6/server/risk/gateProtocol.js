function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function bool(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function gate(gateId, name, passed, reason = "", value = null, required = null, extra = {}) {
  return {
    gateId,
    name,
    passed: Boolean(passed),
    status: passed ? "PASS" : "BLOCKED",
    reason: passed ? "passed" : reason,
    value,
    required,
    ...extra,
  };
}

function volatilityRegime(volatilityBps = 0) {
  const value = Math.abs(finite(volatilityBps));
  if (value >= 18) return "extreme";
  if (value >= 9) return "high";
  if (value >= 2) return "normal";
  return "low";
}

function zScoreFromCandidate(candidate = {}) {
  const distance = Math.abs(finite(candidate.distanceBps));
  const vol = Math.max(1, Math.abs(finite(candidate.volatility60Bps, 1)));
  return distance / vol;
}

function psiFromCandidate(candidate = {}) {
  const velocity = Math.abs(finite(candidate.oddsVelocity));
  const dislocation = Math.abs(finite(candidate.dislocationScore));
  const probabilityEdge = Math.abs(finite(candidate.probability) - finite(candidate.entryPrice));
  return Math.max(velocity * 10, dislocation, probabilityEdge);
}

function evaluateGateProtocol(candidate = {}, account = {}, config = {}) {
  const gates = [];
  const strictSanity = config.strictSanity !== false;
  const side = String(candidate.side || candidate.direction || "").toUpperCase();
  const entryPrice = finite(candidate.entryPrice ?? candidate.selectedBuyPrice);
  const bidPrice = finite(candidate.bidPrice ?? candidate.selectedBidPrice);
  const spreadCents = finite(candidate.spreadCents ?? candidate.selectedSpreadCents);
  const bookAgeMs = finite(candidate.bookAgeMs);
  const depthShares = finite(candidate.depthShares ?? candidate.selectedDepthShares);
  const yesNoAskCost = finite(candidate.yesNoAskCost, 1);
  const confidence = finite(candidate.confidence);
  const edge = finite(candidate.feeAdjustedEdge ?? candidate.edge);
  const secondsIntoWindow = finite(candidate.secondsIntoWindow);
  const timeLeftSec = finite(candidate.timeLeftSec, 999);
  const stableTicks = finite(candidate.stableTicks);
  const maxBookAgeMs = finite(config.maxBookAgeMs, 3_000);
  const minTicks = finite(config.minTicks, 1);
  const minOddsTicks = finite(config.minOddsTicks, 1);
  const minBookTicks = finite(config.minBookTicks, 1);
  const minSecondsIntoWindow = finite(config.minSecondsIntoWindow, 0);
  const maxSecondsIntoWindow = finite(config.maxSecondsIntoWindow, 300);
  const minSecondsLeft = finite(config.minSecondsLeft, 3);
  const minEdge = finite(config.minEdge, 0);
  const maxEntryPrice = finite(config.maxEntryPrice, 1);
  const maxSpreadCents = finite(config.maxSpreadCents, 100);
  const minDepthShares = finite(config.minDepthShares, 0);
  const maxYesNoAskCost = finite(config.maxYesNoAskCost, 1.25);
  const minYesNoAskCost = finite(config.minYesNoAskCost, 0.80);
  const minValidEntryPrice = finite(config.minValidEntryPrice, 0.01);
  const minConfidence = finite(config.minConfidence, 0);
  const requireRealMarketData = config.requireRealMarketData === true;
  const blockSyntheticBook = config.blockSyntheticBook === true;
  const blockLearningFallback = config.blockLearningFallback === true;
  const sourceText = `${candidate.bookSource || ""} ${candidate.title || ""} ${candidate.sourceType || ""}`.toLowerCase();
  const hasFallbackSource = sourceText.includes("synthetic") || sourceText.includes("learning fallback") || sourceText.includes("fallback");
  const bookSourceTokens = String(candidate.bookSource || "").toLowerCase().split("+").map((value) => value.trim()).filter(Boolean);
  const hasLiveBookSource = bookSourceTokens.length >= 2 &&
    bookSourceTokens.every((value) => value.startsWith("ws") || value.startsWith("rest") || value.startsWith("live")) &&
    !sourceText.includes("none") && !sourceText.includes("unknown") && !sourceText.includes("pending");
  const minZScore = finite(config.minZScore, 0);
  const minPsi = finite(config.minPsi, 0);
  const minOddsVelocity = finite(config.minOddsVelocity, -Infinity);
  const minDislocationScore = finite(config.minDislocationScore, -Infinity);
  const maxActivePositions = finite(config.maxActivePositions, Infinity);
  const maxPositionsPerWindow = finite(config.maxPositionsPerWindow, Infinity);
  const maxSameSidePerWindow = finite(config.maxSameSidePerWindow, Infinity);
  const maxStrategyPositionsPerWindow = finite(config.maxStrategyPositionsPerWindow, Infinity);
  const replayBoostCount = Array.isArray(candidate.replayOptimizer?.matchedRules)
    ? candidate.replayOptimizer.matchedRules.filter((rule) => rule.action === "boost").length
    : 0;
  const boostedPyramidStrategyAllow = Array.isArray(config.boostedPyramidStrategies)
    ? config.boostedPyramidStrategies.includes(candidate.strategy)
    : true;
  const boostedPyramidAllowed =
    config.boostedPyramidEnabled === true &&
    boostedPyramidStrategyAllow &&
    replayBoostCount >= finite(config.boostedPyramidMinReplayBoosts, 2) &&
    edge >= finite(config.boostedPyramidMinEdge, 0.06) &&
    entryPrice <= finite(config.boostedPyramidMaxEntryPrice, maxEntryPrice);
  const effectiveMaxSameSidePerWindow = boostedPyramidAllowed
    ? Math.max(maxSameSidePerWindow, finite(config.boostedPyramidMaxSameSidePerWindow, maxSameSidePerWindow))
    : maxSameSidePerWindow;
  const maxConsecutiveLosses = finite(config.maxConsecutiveLosses, Infinity);
  const maxDailyLossFraction = finite(config.maxDailyLossFraction, Infinity);
  const regime = volatilityRegime(candidate.volatility60Bps);
  const allowedRegimes = config.allowedVolatilityRegimes || { low: true, normal: true, high: true, extreme: false };
  const zScore = zScoreFromCandidate(candidate);
  const psi = psiFromCandidate(candidate);
  const activePositions = finite(account.activePositions);
  const positionsThisWindow = finite(account.positionsThisWindow);
  const sameSidePositionsThisWindow = finite(side === "UP" ? account.sameSideUpThisWindow : account.sameSideDownThisWindow);
  const strategyPositionsThisWindow = finite(account.strategyPositionsThisWindow?.[candidate.strategy || ""]);
  const gate0Passed = bookAgeMs <= maxBookAgeMs && !candidate.staleData;
  gates.push(gate(0, "data_freshness", gate0Passed, "stale_data", bookAgeMs, maxBookAgeMs));
  gates.push(gate(1, "entry_timing_window", secondsIntoWindow >= minSecondsIntoWindow && secondsIntoWindow <= maxSecondsIntoWindow && timeLeftSec >= minSecondsLeft, "outside_entry_window", secondsIntoWindow, `${minSecondsIntoWindow}-${maxSecondsIntoWindow}`));
  gates.push(gate(2.5, "minimum_tick_counts", stableTicks >= minTicks && finite(candidate.oddsTicks, minOddsTicks) >= minOddsTicks && finite(candidate.bookTicks, minBookTicks) >= minBookTicks, "insufficient_tick_history", { stableTicks, oddsTicks: finite(candidate.oddsTicks, minOddsTicks), bookTicks: finite(candidate.bookTicks, minBookTicks) }, { minTicks, minOddsTicks, minBookTicks }));
  gates.push(gate(2.7, "volatility_regime", bool(allowedRegimes[regime]), `volatility_regime_${regime}_blocked`, regime, Object.entries(allowedRegimes).filter(([,v]) => v).map(([k]) => k).join(",")));
  gates.push(gate(3, "zscore_psi_threshold", zScore >= minZScore && psi >= minPsi, "zscore_or_psi_too_low", { zScore, psi }, { minZScore, minPsi }));
  gates.push(gate(4, "fee_adjusted_edge", edge >= minEdge, "edge_after_fee_too_small", edge, minEdge));
  gates.push(gate(5, "spread_filter", spreadCents >= 0 && spreadCents <= maxSpreadCents, spreadCents < 0 ? "negative_spread_invalid" : "spread_too_wide", spreadCents, `0-${maxSpreadCents}`));
  gates.push(gate(6, "odds_velocity", finite(candidate.oddsVelocity, 0) >= minOddsVelocity, "odds_velocity_too_low", finite(candidate.oddsVelocity, 0), minOddsVelocity));
  gates.push(gate(7, "dislocation_check", finite(candidate.dislocationScore, 0) >= minDislocationScore, "dislocation_score_too_low", finite(candidate.dislocationScore, 0), minDislocationScore));
  gates.push(gate(8, "composite_confidence", confidence >= minConfidence, "confidence_below_threshold", confidence, minConfidence));
  gates.push(gate(9, "consensus_gate", finite(candidate.consensusAgreement, 0) >= finite(config.minConsensusAgreement, 0), "insufficient_agent_consensus", finite(candidate.consensusAgreement, 0), finite(config.minConsensusAgreement, 0)));
  gates.push(gate(10, "exposure_active_position", activePositions < maxActivePositions && positionsThisWindow < maxPositionsPerWindow && sameSidePositionsThisWindow < effectiveMaxSameSidePerWindow && strategyPositionsThisWindow < maxStrategyPositionsPerWindow, "exposure_limit_reached", { activePositions, positionsThisWindow, sameSidePositionsThisWindow, strategyPositionsThisWindow, replayBoostCount, boostedPyramidAllowed }, { maxActivePositions, maxPositionsPerWindow, maxSameSidePerWindow: effectiveMaxSameSidePerWindow, baseMaxSameSidePerWindow: maxSameSidePerWindow, maxStrategyPositionsPerWindow }));
  gates.push(gate(11, "loss_streak", finite(account.consecutiveLosses) < maxConsecutiveLosses && finite(account.dailyLossFraction) < maxDailyLossFraction, finite(account.consecutiveLosses) >= maxConsecutiveLosses ? "loss_streak_stop" : "daily_loss_stop", { consecutiveLosses: finite(account.consecutiveLosses), dailyLossFraction: finite(account.dailyLossFraction) }, { maxConsecutiveLosses, maxDailyLossFraction }));
  const sanityPassed = !strictSanity || (
    entryPrice >= minValidEntryPrice &&
    entryPrice <= maxEntryPrice &&
    bidPrice >= 0 &&
    depthShares >= minDepthShares &&
    yesNoAskCost >= minYesNoAskCost &&
    yesNoAskCost <= maxYesNoAskCost &&
    Number.isFinite(entryPrice) &&
    Number.isFinite(yesNoAskCost)
  );
  gates.push(gate(12, "orderbook_sanity", sanityPassed, "orderbook_sanity_failed", { entryPrice, bidPrice, depthShares, yesNoAskCost }, { minValidEntryPrice, maxEntryPrice, minDepthShares, minYesNoAskCost, maxYesNoAskCost }));
  const realMarketGatePassed = !requireRealMarketData || (hasLiveBookSource && !hasFallbackSource);
  gates.push(gate(13, "real_market_data_only", realMarketGatePassed, hasFallbackSource ? "learning_fallback_or_synthetic_blocked" : "live_orderbook_required", { bookSource: candidate.bookSource || "", sourceType: candidate.sourceType || "", hasLiveBookSource, hasFallbackSource }, { requireRealMarketData, blockSyntheticBook, blockLearningFallback }));

  const blockedAt = gates.find((item) => !item.passed) || null;
  return {
    approved: !blockedAt,
    reason: blockedAt ? blockedAt.reason : "approved",
    blockedAt,
    allGates: gates,
    gateSummary: {
      passed: gates.filter((item) => item.passed).length,
      total: gates.length,
      firstBlockedGate: blockedAt?.gateId ?? null,
      firstBlockedName: blockedAt?.name || "",
      firstBlockedReason: blockedAt?.reason || "",
    },
  };
}

export { evaluateGateProtocol, volatilityRegime };
