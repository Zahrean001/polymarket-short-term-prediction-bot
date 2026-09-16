import fs from "node:fs";
import path from "node:path";

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isNoDowngradeObserveAction(config = {}, action = "") {
  return String(action || "").toLowerCase() === "observe" || config.noStakeReductionMode === true || config.noEntryReductionMode === true;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function asTimestamp(signal = {}) {
  return Date.parse(signal.settledAt || signal.windowEnd || signal.time || "") || 0;
}

function isSettled(signal = {}) {
  return signal.status === "paper_win" || signal.status === "paper_loss";
}

function isLoss(signal = {}) {
  return signal.status === "paper_loss";
}

function inferSymbol(signal = {}) {
  const text = `${signal.symbol || ""} ${signal.slug || ""} ${signal.title || ""}`.toLowerCase();
  if (text.includes("ethereum") || /\beth\b/.test(text)) return "ETH";
  if (text.includes("solana") || /\bsol\b/.test(text)) return "SOL";
  if (text.includes("xrp")) return "XRP";
  if (text.includes("doge")) return "DOGE";
  if (text.includes("bitcoin") || /\bbtc\b/.test(text)) return "BTC";
  return "CRYPTO";
}

function inferTimeframe(signal = {}) {
  const text = `${signal.timeframe || ""} ${signal.slug || ""} ${signal.title || ""}`.toLowerCase();
  if (text.includes("15m") || text.includes("15-min") || text.includes("15 min")) return "15M";
  if (text.includes("5m") || text.includes("5-min") || text.includes("5 min")) return "5M";
  const rangeMatch = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)?\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (!rangeMatch) return "UNKNOWN";
  const start = Number(rangeMatch[1]) * 60 + Number(rangeMatch[2]);
  const end = Number(rangeMatch[4]) * 60 + Number(rangeMatch[5]);
  const minutes = end > start ? end - start : end + 24 * 60 - start;
  if (minutes <= 6) return "5M";
  if (minutes <= 18) return "15M";
  return `${minutes}M`;
}

function entryPrice(signal = {}) {
  return finite(signal.buyPrice ?? signal.entryPrice ?? signal.selectedBuyPrice);
}

function spreadCents(signal = {}) {
  return finite(signal.selectedSpreadCents ?? signal.spreadCents);
}

function side(signal = {}) {
  const value = String(signal.direction || signal.side || signal.predictedOutcome || "").toUpperCase();
  if (value === "UP" || value === "DOWN") return value;
  return "UNKNOWN";
}

function groupCounts(signals = [], keyFn) {
  const map = new Map();
  for (const signal of signals) {
    const key = keyFn(signal);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function summarizeRulePattern(id, label, rows, config, condition, action, stakeMultiplier) {
  const settled = rows.filter(isSettled);
  const losses = settled.filter(isLoss);
  const wins = settled.length - losses.length;
  const pnl = settled.reduce((sum, signal) => sum + finite(signal.paperPnlUsd), 0);
  const stake = settled.reduce((sum, signal) => sum + finite(signal.paperStakeUsd), 0);
  const lossRate = settled.length ? (losses.length / settled.length) * 100 : 0;
  const roi = stake ? (pnl / stake) * 100 : 0;
  const latestLossAtMs = losses.reduce((latest, signal) => Math.max(latest, asTimestamp(signal)), 0);
  const blockMs = finite(config.patternBlockMinutes, 0) * 60_000;
  const cooldownActive = blockMs <= 0 || (latestLossAtMs > 0 && Date.now() - latestLossAtMs <= blockMs);
  const enoughLosses = losses.length >= finite(config.blockAfterLosses, 2);
  const enoughSamples = settled.length >= finite(config.minSamples, 2);
  const negative = roi < finite(config.minPatternRoi, 0) || lossRate >= finite(config.minLossRatePercent, 55);
  const active = config.autoBlock !== false && enoughSamples && enoughLosses && negative && cooldownActive;

  return {
    id,
    label,
    active,
    action,
    condition,
    stakeMultiplier,
    samples: settled.length,
    wins,
    losses: losses.length,
    lossRate,
    pnl,
    stake,
    roi,
    latestLossAt: latestLossAtMs ? new Date(latestLossAtMs).toISOString() : null,
    expiresAt: blockMs > 0 && latestLossAtMs ? new Date(latestLossAtMs + blockMs).toISOString() : null,
  };
}

function recentSettledSignals(signals = [], lookback = 50) {
  return (signals || [])
    .filter(isSettled)
    .sort((left, right) => asTimestamp(right) - asTimestamp(left))
    .slice(0, Math.max(1, finite(lookback, 50)));
}

function countRecentConsecutiveLosses(settled = []) {
  let count = 0;
  for (const signal of settled) {
    if (isLoss(signal)) count += 1;
    else break;
  }
  return count;
}

function buildAdaptiveLearningState(signals = [], now = Date.now(), config = {}) {
  const settled = recentSettledSignals(signals, config.lookback);
  const sameSideCounts = groupCounts(settled, (signal) => `${signal.slug || signal.windowStart || ""}:${side(signal)}`);
  const annotated = settled.map((signal) => ({
    ...signal,
    adaptiveSymbol: inferSymbol(signal),
    adaptiveTimeframe: inferTimeframe(signal),
    sameSideClusterSize: sameSideCounts.get(`${signal.slug || signal.windowStart || ""}:${side(signal)}`) || 0,
  }));
  const reduceMultiplier = config.noStakeReductionMode ? 1 : clamp(finite(config.reduceStakeMultiplier, 0.5), 0.05, 1);
  const blockMultiplier = (config.noEntryReductionMode || config.noStakeReductionMode) ? 1 : clamp(finite(config.blockStakeMultiplier, 0), 0, 1);
  const rules = [
    summarizeRulePattern(
      "early_window_losses",
      "early window losses",
      annotated.filter((signal) => finite(signal.secondsIntoWindow) < finite(config.earlyWindowSeconds, 61)),
      config,
      { type: "seconds_into_window_lt", value: finite(config.earlyWindowSeconds, 61) },
      (config.noEntryReductionMode || config.noStakeReductionMode ? "observe" : String(config.earlyWindowAction || "block")),
      blockMultiplier,
    ),
    summarizeRulePattern(
      "late_window_losses",
      "late window losses",
      annotated.filter((signal) => finite(signal.secondsIntoWindow) >= finite(config.lateWindowSeconds, 120)),
      config,
      { type: "seconds_into_window_gte", value: finite(config.lateWindowSeconds, 120) },
      (config.noEntryReductionMode || config.noStakeReductionMode ? "observe" : String(config.lateWindowAction || "block")),
      blockMultiplier,
    ),
    summarizeRulePattern(
      "high_entry_price_losses",
      "high entry price losses",
      annotated.filter((signal) => entryPrice(signal) > finite(config.highEntryPrice, 0.75)),
      config,
      { type: "entry_price_gt", value: finite(config.highEntryPrice, 0.75) },
      (config.noEntryReductionMode || config.noStakeReductionMode ? "observe" : String(config.highEntryPriceAction || "observe")),
      reduceMultiplier,
    ),
    summarizeRulePattern(
      "wide_spread_losses",
      "wide spread losses",
      annotated.filter((signal) => spreadCents(signal) > finite(config.wideSpreadCents, 6)),
      config,
      { type: "spread_cents_gt", value: finite(config.wideSpreadCents, 6) },
      (config.noEntryReductionMode || config.noStakeReductionMode ? "observe" : String(config.wideSpreadAction || "observe")),
      reduceMultiplier,
    ),
    summarizeRulePattern(
      "same_side_cluster_losses",
      "same-side cluster losses",
      annotated.filter((signal) => finite(signal.sameSideClusterSize) >= finite(config.sameSideClusterSize, 2)),
      config,
      { type: "same_side_positions_gte", value: finite(config.sameSideRuntimeLimit, 1) },
      (config.noEntryReductionMode || config.noStakeReductionMode ? "observe" : String(config.sameSideClusterAction || "block")),
      blockMultiplier,
    ),
  ];

  const symbolRules = ["BTC", "ETH", "SOL", "XRP", "DOGE"]
    .map((symbol) => summarizeRulePattern(
      `symbol_${symbol.toLowerCase()}_losses`,
      `${symbol} loss cluster`,
      annotated.filter((signal) => signal.adaptiveSymbol === symbol),
      { ...config, blockAfterLosses: finite(config.symbolBlockAfterLosses, 3) },
      { type: "symbol_eq", value: symbol },
      (config.noEntryReductionMode || config.noStakeReductionMode ? "observe" : String(config.symbolLossAction || "observe")),
      reduceMultiplier,
    ))
    .filter((rule) => rule.losses > 0);

  const timeframeRules = ["5M", "15M"]
    .map((timeframe) => summarizeRulePattern(
      `timeframe_${timeframe.toLowerCase()}_losses`,
      `${timeframe} loss cluster`,
      annotated.filter((signal) => signal.adaptiveTimeframe === timeframe),
      { ...config, blockAfterLosses: finite(config.timeframeBlockAfterLosses, 4) },
      { type: "timeframe_eq", value: timeframe },
      (config.noEntryReductionMode || config.noStakeReductionMode ? "observe" : String(config.timeframeLossAction || "observe")),
      reduceMultiplier,
    ))
    .filter((rule) => rule.losses > 0);

  const sideRules = ["UP", "DOWN"]
    .map((entrySide) => summarizeRulePattern(
      `side_${entrySide.toLowerCase()}_losses`,
      `${entrySide} side loss cluster`,
      annotated.filter((signal) => side(signal) === entrySide),
      { ...config, blockAfterLosses: finite(config.sideBlockAfterLosses, 4) },
      { type: "side_eq", value: entrySide },
      (config.noEntryReductionMode || config.noStakeReductionMode ? "observe" : String(config.sideLossAction || "observe")),
      reduceMultiplier,
    ))
    .filter((rule) => rule.losses > 0);

  const allRules = [...rules, ...symbolRules, ...timeframeRules, ...sideRules];
  const activeRules = allRules.filter((rule) => rule.active);
  const consecutiveLosses = countRecentConsecutiveLosses(settled);
  const recoveryActive = consecutiveLosses >= finite(config.recoveryLossStreak, 2);
  const hardStopActive =
    finite(config.hardStopLossStreak, 0) > 0 &&
    consecutiveLosses >= finite(config.hardStopLossStreak, 0) &&
    finite(config.globalCooldownMs, 0) > 0;

  return {
    enabled: config.enabled !== false,
    mode: config.mode || "enforce",
    updatedAt: new Date(now).toISOString(),
    lookback: finite(config.lookback, 50),
    summary: {
      settled: settled.length,
      losses: settled.filter(isLoss).length,
      consecutiveLosses,
      activeRules: activeRules.length,
      recoveryActive,
      hardStopActive,
    },
    patterns: allRules,
    avoidRules: activeRules,
    recovery: {
      active: recoveryActive,
      reason: recoveryActive ? "recent_loss_streak_recovery" : "normal",
      consecutiveLosses,
      stakeMultiplier: recoveryActive ? clamp(finite(config.recoveryStakeMultiplier, 0.35), 0.05, 1) : 1,
      hardStopActive,
      globalCooldownMs: finite(config.globalCooldownMs, 0),
    },
  };
}

function signalSymbol(signal = {}) {
  return inferSymbol(signal);
}

function signalTimeframe(signal = {}) {
  return inferTimeframe(signal);
}

function ruleMatches(rule = {}, signal = {}, accountRisk = {}) {
  const condition = rule.condition || {};
  switch (condition.type) {
    case "seconds_into_window_lt":
      return finite(signal.secondsIntoWindow) < finite(condition.value);
    case "seconds_into_window_gte":
      return finite(signal.secondsIntoWindow) >= finite(condition.value);
    case "entry_price_gt":
      return entryPrice(signal) > finite(condition.value);
    case "spread_cents_gt":
      return spreadCents(signal) > finite(condition.value);
    case "same_side_positions_gte": {
      const signalSide = side(signal);
      const count = signalSide === "UP" ? finite(accountRisk.sameSideUpThisWindow) : signalSide === "DOWN" ? finite(accountRisk.sameSideDownThisWindow) : 0;
      return count >= finite(condition.value, 1);
    }
    case "symbol_eq":
      return signalSymbol(signal) === String(condition.value || "").toUpperCase();
    case "timeframe_eq":
      return signalTimeframe(signal) === String(condition.value || "").toUpperCase();
    case "side_eq":
      return side(signal) === String(condition.value || "").toUpperCase();
    default:
      return false;
  }
}

function evaluateAdaptiveAvoidance({ signal, accountRisk = {}, state, config = {} } = {}) {
  if (!signal || config.enabled === false || state?.enabled === false) {
    return { approved: true, reason: "adaptive_disabled", stakeMultiplier: 1, matchedRules: [] };
  }

  const mode = state?.mode || config.mode || "enforce";
  const matchedRules = (state?.avoidRules || []).filter((rule) => ruleMatches(rule, signal, accountRisk));
  const noDowngrade = config.noEntryReductionMode === true;
  const blockingRule = noDowngrade ? null : matchedRules.find((rule) => rule.action === "block");
  let stakeMultiplier = 1;

  for (const rule of matchedRules) {
    if (!config.noStakeReductionMode && rule.action === "reduce_stake") {
      stakeMultiplier = Math.min(stakeMultiplier, clamp(finite(rule.stakeMultiplier, 1), 0.05, 1));
    }
  }

  if (!config.noStakeReductionMode && state?.recovery?.active) {
    stakeMultiplier = Math.min(stakeMultiplier, clamp(finite(state.recovery.stakeMultiplier, 1), 0.05, 1));
  }

  if (mode === "shadow") {
    return {
      approved: true,
      reason: matchedRules.length ? "adaptive_shadow_match" : "adaptive_clear",
      mode,
      stakeMultiplier: 1,
      shadowStakeMultiplier: stakeMultiplier,
      matchedRules,
    };
  }

  if (blockingRule) {
    return {
      approved: false,
      reason: `adaptive_block_${blockingRule.id}`,
      mode,
      stakeMultiplier: 0,
      matchedRules,
    };
  }

  return {
    approved: true,
    reason: matchedRules.length || state?.recovery?.active ? "adaptive_stake_adjusted" : "adaptive_clear",
    mode,
    stakeMultiplier,
    matchedRules,
  };
}

function persistAdaptiveLearningState(dataDir, state = {}) {
  try {
    const learningDir = path.join(dataDir, "learning");
    fs.mkdirSync(learningDir, { recursive: true });
    fs.writeFileSync(path.join(learningDir, "runtime-loss-patterns.json"), JSON.stringify({
      updatedAt: state.updatedAt,
      summary: state.summary,
      patterns: state.patterns || [],
    }, null, 2));
    fs.writeFileSync(path.join(learningDir, "adaptive-avoidance-rules.json"), JSON.stringify({
      updatedAt: state.updatedAt,
      mode: state.mode,
      avoidRules: state.avoidRules || [],
    }, null, 2));
    fs.writeFileSync(path.join(learningDir, "recovery-state.json"), JSON.stringify({
      updatedAt: state.updatedAt,
      recovery: state.recovery || {},
    }, null, 2));
  } catch {
    // Adaptive persistence must not stop scans.
  }
}

function createEmptyAdaptiveLearningState(overrides = {}) {
  return {
    enabled: false,
    mode: "disabled",
    updatedAt: null,
    summary: {
      settled: 0,
      losses: 0,
      consecutiveLosses: 0,
      activeRules: 0,
      recoveryActive: false,
      hardStopActive: false,
    },
    patterns: [],
    avoidRules: [],
    recovery: {
      active: false,
      reason: "waiting",
      consecutiveLosses: 0,
      stakeMultiplier: 1,
      hardStopActive: false,
      globalCooldownMs: 0,
    },
    ...overrides,
  };
}

export {
  buildAdaptiveLearningState,
  createEmptyAdaptiveLearningState,
  evaluateAdaptiveAvoidance,
  inferSymbol,
  inferTimeframe,
  persistAdaptiveLearningState,
};
