function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function reject(reason, extra = {}) {
  return { approved: false, reason, ...extra };
}

function approve(extra = {}) {
  return { approved: true, reason: "approved", ...extra };
}

function evaluateRisk(signal, account = {}, config = {}) {
  const minEdge = finite(config.minEdge, 0.10);
  const maxEntryPrice = finite(config.maxEntryPrice, 0.78);
  const maxSpreadCents = finite(config.maxSpreadCents, 3);
  const maxBookAgeMs = finite(config.maxBookAgeMs, 2000);
  const minDepthShares = finite(config.minDepthShares, 5);
  const maxYesNoAskCost = finite(config.maxYesNoAskCost, 1.04);
  const minYesNoAskCost = finite(config.minYesNoAskCost, 0.80);
  const minValidEntryPrice = finite(config.minValidEntryPrice, 0.01);
  const maxConsecutiveLosses = finite(config.maxConsecutiveLosses, 2);
  const maxDailyLossFraction = finite(config.maxDailyLossFraction, 0.25);
  const stableTicksRequired = finite(config.signalStableTicks, 2);
  const maxActivePositions = finite(config.maxActivePositions, Infinity);
  const maxPositionsPerWindow = finite(config.maxPositionsPerWindow, Infinity);
  const maxSameSidePerWindow = finite(config.maxSameSidePerWindow, Infinity);
  const maxStrategyPositionsPerWindow = finite(config.maxStrategyPositionsPerWindow, Infinity);

  if (!signal) return reject("missing_signal");

  const entryPrice = finite(signal.entryPrice ?? signal.selectedBuyPrice);
  const spreadCents = finite(signal.spreadCents ?? signal.selectedSpreadCents);
  const depthShares = finite(signal.depthShares ?? signal.selectedDepthShares);
  const yesNoAskCost = finite(signal.yesNoAskCost, 1);

  if (finite(account.activePositions) >= maxActivePositions) return reject("max_active_positions_reached", { activePositions: finite(account.activePositions), maxActivePositions });
  if (finite(account.positionsThisWindow) >= maxPositionsPerWindow) return reject("max_positions_per_window_reached", { positionsThisWindow: finite(account.positionsThisWindow), maxPositionsPerWindow });
  const side = String(signal.side || signal.direction || signal.predictedOutcome || "").toUpperCase();
  const sameSideCount = side === "UP" ? finite(account.sameSideUpThisWindow) : side === "DOWN" ? finite(account.sameSideDownThisWindow) : 0;
  if (sameSideCount >= maxSameSidePerWindow) return reject("max_same_side_per_window_reached", { side, sameSideCount, maxSameSidePerWindow });
  const strategy = String(signal.strategy || signal.entryStrategy || "").trim();
  const strategyCount = strategy ? finite(account.strategyPositionsThisWindow?.[strategy]) : 0;
  if (strategyCount >= maxStrategyPositionsPerWindow) return reject("max_strategy_positions_per_window_reached", { strategy, strategyCount, maxStrategyPositionsPerWindow });

  if (entryPrice < minValidEntryPrice) return reject("entry_price_sanity_failed", { entryPrice, minValidEntryPrice });
  if (spreadCents < 0) return reject("negative_spread_invalid", { spreadCents });
  if (yesNoAskCost < minYesNoAskCost) return reject("complete_set_cost_sanity_failed", { yesNoAskCost, minYesNoAskCost });

  if (finite(signal.feeAdjustedEdge ?? signal.edge) < minEdge) return reject("edge_too_low");
  if (entryPrice > maxEntryPrice) return reject("entry_too_expensive");
  if (spreadCents > maxSpreadCents) return reject("spread_too_wide");
  if (finite(signal.bookAgeMs) > maxBookAgeMs) return reject("stale_book");
  if (depthShares < minDepthShares) return reject("insufficient_depth");
  if (yesNoAskCost > maxYesNoAskCost) return reject("bad_complete_set_cost");
  if (finite(signal.stableTicks, stableTicksRequired) < stableTicksRequired) return reject("signal_not_stable");
  if (finite(account.consecutiveLosses) >= maxConsecutiveLosses) return reject("loss_streak_stop");
  if (finite(account.dailyLossFraction) >= maxDailyLossFraction) return reject("daily_loss_stop");

  return approve();
}

function sizeStake(balance, signal, config = {}) {
  const numericBalance = Math.max(0, finite(balance));
  if (numericBalance <= 0 || !signal) return 0;
  const rank = String(signal.rank || "SKIP").toUpperCase();
  const caps = {
    "A+": finite(config.maxStakeFractionAPlus, 0.15),
    A: finite(config.maxStakeFractionA, 0.08),
    B: finite(config.maxStakeFractionB, 0.05),
    C: finite(config.maxStakeFractionC, 0.03),
  };
  const fraction = caps[rank] ?? 0;
  const kellyFraction = config.kellySizingEnabled ? Math.max(0, Math.min(finite(config.kellyMaxFraction, 0.15), finite(signal.kellyFraction, fraction))) * finite(config.kellyFractionMultiplier, 0.25) : fraction;
  const finalFraction = config.kellySizingEnabled ? Math.max(finite(config.kellyMinFraction, 0.005), Math.min(fraction || kellyFraction, kellyFraction)) : fraction;
  const maxUsd = finite(config.maxTradeUsd, numericBalance * finalFraction);
  const multiplier = finite(signal.stakeMultiplier, 1);
  return Math.max(0, Math.min(numericBalance * finalFraction * multiplier, maxUsd || numericBalance * finalFraction));
}

function getWindowKey(signal = {}) {
  return signal.slug || signal.windowStart || signal.marketSlug || "";
}

function accountRiskFromSignals(signals = [], balance = 0, startBalance = 0, context = {}) {
  const rows = Array.isArray(signals) ? signals : [];
  const settled = rows
    .filter((signal) => signal.status === "paper_win" || signal.status === "paper_loss")
    .sort((left, right) => Date.parse(right.settledAt || right.windowEnd || right.time || "") - Date.parse(left.settledAt || left.windowEnd || left.time || ""));
  const open = rows.filter((signal) => signal.status === "paper_open");
  let consecutiveLosses = 0;
  for (const signal of settled) {
    if (signal.status === "paper_loss") consecutiveLosses += 1;
    else break;
  }
  const dayStart = Date.now() - 24 * 60 * 60 * 1000;
  const dailyPnl = settled
    .filter((signal) => Date.parse(signal.settledAt || signal.time || "") >= dayStart)
    .reduce((sum, signal) => sum + finite(signal.paperPnlUsd), 0);
  const basis = Math.max(1, finite(startBalance, balance));
  const activeWindowKey = context.activeWindowKey || context.slug || "";
  const positionsThisWindow = activeWindowKey ? open.filter((signal) => getWindowKey(signal) === activeWindowKey).length : 0;
  const sameSideUpThisWindow = activeWindowKey ? open.filter((signal) => getWindowKey(signal) === activeWindowKey && String(signal.direction || signal.side).toUpperCase() === "UP").length : 0;
  const sameSideDownThisWindow = activeWindowKey ? open.filter((signal) => getWindowKey(signal) === activeWindowKey && String(signal.direction || signal.side).toUpperCase() === "DOWN").length : 0;
  const strategyPositionsThisWindow = activeWindowKey
    ? open
        .filter((signal) => getWindowKey(signal) === activeWindowKey)
        .reduce((map, signal) => {
          const strategy = String(signal.strategy || signal.entryStrategy || "unknown");
          map[strategy] = (map[strategy] || 0) + 1;
          return map;
        }, {})
    : {};
  const exposureUsd = open.reduce((sum, signal) => sum + finite(signal.paperStakeUsd), 0);
  return {
    balance: finite(balance),
    baseBalance: basis,
    consecutiveLosses,
    dailyPnl,
    dailyLossFraction: Math.max(0, -dailyPnl / basis),
    activePositions: open.length,
    positionsThisWindow,
    sameSideUpThisWindow,
    sameSideDownThisWindow,
    strategyPositionsThisWindow,
    exposureUsd,
  };
}

export { accountRiskFromSignals, evaluateRisk, getWindowKey, sizeStake };
