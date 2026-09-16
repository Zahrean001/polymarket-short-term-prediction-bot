import fs from "node:fs";
import path from "node:path";

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isSettled(signal = {}) {
  return signal.status === "paper_win" || signal.status === "paper_loss";
}

function isWin(signal = {}) {
  return signal.status === "paper_win";
}

function side(signal = {}) {
  const value = String(signal.direction || signal.side || signal.predictedOutcome || "").toUpperCase();
  return value === "UP" || value === "DOWN" ? value : "UNKNOWN";
}

function strategy(signal = {}) {
  return String(signal.strategy || signal.entryStrategy || signal.selectedStrategy || "unknown").trim() || "unknown";
}

function entryPrice(signal = {}) {
  return finite(signal.buyPrice ?? signal.entryPrice ?? signal.selectedBuyPrice);
}

function secondsIntoWindow(signal = {}) {
  return finite(signal.secondsIntoWindow, -1);
}

const WINDOW_BUCKETS = [
  { label: "0-45", min: 0, max: 45 },
  { label: "45-75", min: 45, max: 75 },
  { label: "75-105", min: 75, max: 105 },
  { label: "105-135", min: 105, max: 135 },
  { label: "135-151", min: 135, max: 151 },
  { label: "151-300", min: 151, max: 301 },
];

const ENTRY_BUCKETS = [
  { label: "0.00-0.50", min: 0, max: 0.50 },
  { label: "0.50-0.60", min: 0.50, max: 0.60 },
  { label: "0.60-0.70", min: 0.60, max: 0.70 },
  { label: "0.70-0.82", min: 0.70, max: 0.82 },
  { label: "0.82-1.00", min: 0.82, max: 1.01 },
];

function safeId(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}

function bucketFor(value, buckets) {
  const numeric = finite(value, NaN);
  if (!Number.isFinite(numeric)) return null;
  return buckets.find((bucket) => numeric >= bucket.min && numeric < bucket.max) || null;
}

function summarizeRows(rows = []) {
  const settled = rows.filter(isSettled);
  const wins = settled.filter(isWin).length;
  const losses = settled.length - wins;
  const pnl = settled.reduce((sum, signal) => sum + finite(signal.paperPnlUsd), 0);
  const stake = settled.reduce((sum, signal) => sum + finite(signal.paperStakeUsd), 0);
  return {
    samples: settled.length,
    wins,
    losses,
    winRate: settled.length ? (wins / settled.length) * 100 : 0,
    lossRate: settled.length ? (losses / settled.length) * 100 : 0,
    pnl,
    stake,
    roi: stake ? (pnl / stake) * 100 : 0,
  };
}

function groupedStats(rows, groups, getKey) {
  return groups.map((group) => {
    const groupRows = rows.filter((row) => getKey(row, group));
    return { ...group, ...summarizeRows(groupRows) };
  });
}

function uniqueValues(rows, getValue) {
  return [...new Set(rows.map(getValue).filter(Boolean))].sort();
}

function makeRule(id, label, action, condition, stats, scoreAdjustment = 0, stakeMultiplier = 1) {
  return {
    id,
    label,
    action,
    condition,
    scoreAdjustment,
    stakeMultiplier,
    samples: stats.samples,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.winRate,
    lossRate: stats.lossRate,
    pnl: stats.pnl,
    stake: stats.stake,
    roi: stats.roi,
  };
}

function isBad(stats, config = {}) {
  return (
    stats.samples >= finite(config.minSamples, 3) &&
    stats.losses >= finite(config.minLosses, 2) &&
    stats.roi <= finite(config.badMaxRoi, -5) &&
    stats.lossRate >= finite(config.badMinLossRate, 58)
  );
}

function isGood(stats, config = {}) {
  return (
    stats.samples >= finite(config.minSamples, 3) &&
    stats.roi >= finite(config.goodMinRoi, 8) &&
    stats.winRate >= finite(config.goodMinWinRate, 58)
  );
}

function isProfitLeak(stats, config = {}) {
  return (
    stats.samples >= finite(config.minSamples, 3) &&
    stats.losses >= finite(config.minLosses, 1) &&
    stats.pnl < 0 &&
    stats.roi <= finite(config.profitLeakMaxRoi, -8)
  );
}

function isSevereBad(stats, config = {}) {
  return isBad(stats, config) || (
    isProfitLeak(stats, config) &&
    stats.winRate <= finite(config.severeBadMaxWinRate, 50)
  );
}

function buildReplayThresholdOptimizerState(signals = [], config = {}) {
  const rows = (Array.isArray(signals) ? signals : []).filter(isSettled);
  if (config.enabled === false) {
    return { enabled: false, status: "disabled", rules: [], thresholds: {}, summary: { settled: rows.length } };
  }

  const windowStats = groupedStats(rows, WINDOW_BUCKETS, (row, bucket) => {
    const value = secondsIntoWindow(row);
    return value >= bucket.min && value < bucket.max;
  });
  const entryStats = groupedStats(rows, ENTRY_BUCKETS, (row, bucket) => {
    const value = entryPrice(row);
    return value >= bucket.min && value < bucket.max;
  });
  const sideValues = uniqueValues(rows, side).filter((value) => value !== "UNKNOWN");
  const strategyValues = uniqueValues(rows, strategy);
  const sideWindowStats = sideValues.flatMap((entrySide) => WINDOW_BUCKETS.map((bucket) => {
    const stats = summarizeRows(rows.filter((row) => side(row) === entrySide && secondsIntoWindow(row) >= bucket.min && secondsIntoWindow(row) < bucket.max));
    return { side: entrySide, ...bucket, ...stats };
  }));
  const strategyStats = strategyValues.map((name) => ({ strategy: name, ...summarizeRows(rows.filter((row) => strategy(row) === name)) }));
  const strategySideStats = strategyValues.flatMap((name) => sideValues.map((entrySide) => ({
    strategy: name,
    side: entrySide,
    ...summarizeRows(rows.filter((row) => strategy(row) === name && side(row) === entrySide)),
  })));
  const strategySideWindowStats = strategyValues.flatMap((name) => sideValues.flatMap((entrySide) => WINDOW_BUCKETS.map((bucket) => ({
    strategy: name,
    side: entrySide,
    ...bucket,
    ...summarizeRows(rows.filter((row) =>
      strategy(row) === name &&
      side(row) === entrySide &&
      secondsIntoWindow(row) >= bucket.min &&
      secondsIntoWindow(row) < bucket.max
    )),
  }))));
  const strategySideEntryStats = strategyValues.flatMap((name) => sideValues.flatMap((entrySide) => ENTRY_BUCKETS.map((bucket) => ({
    strategy: name,
    side: entrySide,
    ...bucket,
    ...summarizeRows(rows.filter((row) =>
      strategy(row) === name &&
      side(row) === entrySide &&
      entryPrice(row) >= bucket.min &&
      entryPrice(row) < bucket.max
    )),
  }))));

  const rules = [];
  for (const bucket of windowStats) {
    if (isBad(bucket, config)) {
      rules.push(makeRule(`window_${bucket.label}_bad`, `bad window ${bucket.label}`, "block", { type: "seconds_between", min: bucket.min, max: bucket.max }, bucket));
    } else if (isGood(bucket, config)) {
      rules.push(makeRule(`window_${bucket.label}_good`, `good window ${bucket.label}`, "boost", { type: "seconds_between", min: bucket.min, max: bucket.max }, bucket, 8));
    }
  }

  for (const bucket of entryStats) {
    if (isBad(bucket, config)) {
      rules.push(makeRule(`entry_${bucket.label}_bad`, `bad entry ${bucket.label}`, "block", { type: "entry_between", min: bucket.min, max: bucket.max }, bucket));
    } else if (isGood(bucket, config)) {
      rules.push(makeRule(`entry_${bucket.label}_good`, `good entry ${bucket.label}`, "boost", { type: "entry_between", min: bucket.min, max: bucket.max }, bucket, 6));
    }
  }

  for (const bucket of sideWindowStats) {
    if (isBad(bucket, { ...config, minSamples: Math.max(2, finite(config.minSamples, 3) - 1) })) {
      rules.push(makeRule(
        `side_${bucket.side.toLowerCase()}_window_${bucket.label}_bad`,
        `bad ${bucket.side} window ${bucket.label}`,
        "block",
        { type: "side_seconds_between", side: bucket.side, min: bucket.min, max: bucket.max },
        bucket,
      ));
    } else if (isGood(bucket, { ...config, minSamples: Math.max(2, finite(config.minSamples, 3) - 1) })) {
      rules.push(makeRule(
        `side_${bucket.side.toLowerCase()}_window_${bucket.label}_good`,
        `good ${bucket.side} window ${bucket.label}`,
        "boost",
        { type: "side_seconds_between", side: bucket.side, min: bucket.min, max: bucket.max },
        bucket,
        10,
      ));
    }
  }

  for (const item of strategyStats) {
    if (isBad(item, { ...config, minSamples: finite(config.strategyMinSamples, 6) })) {
      rules.push(makeRule(`strategy_${item.strategy}_bad`, `bad strategy ${item.strategy}`, "observe", { type: "strategy_eq", strategy: item.strategy }, item, -8, 0.5));
    } else if (isGood(item, { ...config, minSamples: finite(config.strategyMinSamples, 6) })) {
      rules.push(makeRule(`strategy_${item.strategy}_good`, `good strategy ${item.strategy}`, "boost", { type: "strategy_eq", strategy: item.strategy }, item, 8));
    }
  }

  for (const item of strategySideStats) {
    const scopedConfig = {
      ...config,
      minSamples: finite(config.strategySideMinSamples, 4),
      minLosses: finite(config.strategySideMinLosses, 2),
      profitLeakMaxRoi: finite(config.strategySideProfitLeakMaxRoi, -8),
    };
    const id = `strategy_side_${safeId(item.strategy)}_${item.side.toLowerCase()}`;
    if (isSevereBad(item, scopedConfig)) {
      rules.push(makeRule(
        `${id}_bad`,
        `bad ${item.strategy} ${item.side}`,
        String(config.strategySideBadAction || "observe"),
        { type: "strategy_side_eq", strategy: item.strategy, side: item.side },
        item,
        -10,
        finite(config.strategySideReduceStakeMultiplier, 0.35),
      ));
    } else if (isGood(item, { ...config, minSamples: finite(config.strategySideMinSamples, 4) })) {
      rules.push(makeRule(
        `${id}_good`,
        `good ${item.strategy} ${item.side}`,
        "boost",
        { type: "strategy_side_eq", strategy: item.strategy, side: item.side },
        item,
        10,
      ));
    }
  }

  for (const bucket of strategySideWindowStats) {
    const scopedConfig = {
      ...config,
      minSamples: finite(config.strategySideWindowMinSamples, 3),
      minLosses: finite(config.strategySideWindowMinLosses, 1),
      profitLeakMaxRoi: finite(config.strategySideWindowProfitLeakMaxRoi, -8),
    };
    const id = `strategy_side_window_${safeId(bucket.strategy)}_${bucket.side.toLowerCase()}_${bucket.label}`;
    if (isBad(bucket, scopedConfig) || isProfitLeak(bucket, scopedConfig)) {
      rules.push(makeRule(
        `${id}_bad`,
        `bad ${bucket.strategy} ${bucket.side} window ${bucket.label}`,
        "block",
        { type: "strategy_side_seconds_between", strategy: bucket.strategy, side: bucket.side, min: bucket.min, max: bucket.max },
        bucket,
      ));
    } else if (isGood(bucket, { ...config, minSamples: finite(config.strategySideWindowMinSamples, 3) })) {
      rules.push(makeRule(
        `${id}_good`,
        `good ${bucket.strategy} ${bucket.side} window ${bucket.label}`,
        "boost",
        { type: "strategy_side_seconds_between", strategy: bucket.strategy, side: bucket.side, min: bucket.min, max: bucket.max },
        bucket,
        12,
      ));
    }
  }

  for (const bucket of strategySideEntryStats) {
    const scopedConfig = {
      ...config,
      minSamples: finite(config.strategySideEntryMinSamples, 3),
      minLosses: finite(config.strategySideEntryMinLosses, 1),
      profitLeakMaxRoi: finite(config.strategySideEntryProfitLeakMaxRoi, -8),
    };
    const id = `strategy_side_entry_${safeId(bucket.strategy)}_${bucket.side.toLowerCase()}_${bucket.label}`;
    if (isBad(bucket, scopedConfig) || isProfitLeak(bucket, scopedConfig)) {
      rules.push(makeRule(
        `${id}_bad`,
        `bad ${bucket.strategy} ${bucket.side} entry ${bucket.label}`,
        "block",
        { type: "strategy_side_entry_between", strategy: bucket.strategy, side: bucket.side, min: bucket.min, max: bucket.max },
        bucket,
      ));
    } else if (isGood(bucket, { ...config, minSamples: finite(config.strategySideEntryMinSamples, 3) })) {
      rules.push(makeRule(
        `${id}_good`,
        `good ${bucket.strategy} ${bucket.side} entry ${bucket.label}`,
        "boost",
        { type: "strategy_side_entry_between", strategy: bucket.strategy, side: bucket.side, min: bucket.min, max: bucket.max },
        bucket,
        10,
      ));
    }
  }

  const goodWindows = windowStats.filter((bucket) => isGood(bucket, config));
  const thresholds = {
    preferredWindows: goodWindows.map((bucket) => bucket.label),
    badWindows: windowStats.filter((bucket) => isBad(bucket, config)).map((bucket) => bucket.label),
    badEntryBuckets: entryStats.filter((bucket) => isBad(bucket, config)).map((bucket) => bucket.label),
    goodEntryBuckets: entryStats.filter((bucket) => isGood(bucket, config)).map((bucket) => bucket.label),
  };

  const normalizedRules = rules.map((rule) => {
    if (config.noEntryReductionMode && rule.action === "block") {
      return { ...rule, action: "observe", scoreAdjustment: Math.min(finite(rule.scoreAdjustment, -8), -8), stakeMultiplier: 1 };
    }
    if (config.noStakeReductionMode && rule.action === "reduce_stake") {
      return { ...rule, action: "observe", scoreAdjustment: Math.min(finite(rule.scoreAdjustment, -8), -8), stakeMultiplier: 1 };
    }
    return config.noStakeReductionMode ? { ...rule, stakeMultiplier: Math.max(1, finite(rule.stakeMultiplier, 1)) } : rule;
  });
  const activeRules = normalizedRules.filter((rule) => rule.action !== "boost");
  return {
    enabled: true,
    actionMode: config.noEntryReductionMode || config.noStakeReductionMode ? "observe" : (config.actionMode || "observe"),
    blockingEnabled: config.noEntryReductionMode ? false : config.blockingEnabled !== false,
    reduceStakeEnabled: config.noStakeReductionMode ? false : config.reduceStakeEnabled !== false,
    status: rows.length ? "loaded" : "empty",
    generatedAt: new Date().toISOString(),
    summary: {
      settled: rows.length,
      total: summarizeRows(rows),
      activeRules: activeRules.length,
      boostRules: normalizedRules.filter((rule) => rule.action === "boost").length,
    },
    thresholds,
    stats: {
      windows: windowStats,
      entries: entryStats,
      sideWindows: sideWindowStats,
      strategies: strategyStats,
      strategySides: strategySideStats,
      strategySideWindows: strategySideWindowStats,
      strategySideEntries: strategySideEntryStats,
    },
    rules: normalizedRules,
  };
}

function conditionMatches(condition = {}, candidate = {}) {
  const entrySide = side(candidate);
  const seconds = secondsIntoWindow(candidate);
  const price = entryPrice(candidate);
  switch (condition.type) {
    case "seconds_between":
      return seconds >= finite(condition.min) && seconds < finite(condition.max);
    case "entry_between":
      return price >= finite(condition.min) && price < finite(condition.max);
    case "side_seconds_between":
      return entrySide === String(condition.side || "").toUpperCase() && seconds >= finite(condition.min) && seconds < finite(condition.max);
    case "strategy_eq":
      return strategy(candidate) === String(condition.strategy || "");
    case "strategy_side_eq":
      return strategy(candidate) === String(condition.strategy || "") && entrySide === String(condition.side || "").toUpperCase();
    case "strategy_side_seconds_between":
      return strategy(candidate) === String(condition.strategy || "") && entrySide === String(condition.side || "").toUpperCase() && seconds >= finite(condition.min) && seconds < finite(condition.max);
    case "strategy_side_entry_between":
      return strategy(candidate) === String(condition.strategy || "") && entrySide === String(condition.side || "").toUpperCase() && price >= finite(condition.min) && price < finite(condition.max);
    default:
      return false;
  }
}

function evaluateReplayOptimizer(candidate = {}, state = {}) {
  let bootstrapRules = [];
  const bootstrapEnabled = process.env.BOOTSTRAP_LEARNING_ENABLED === "1";
  if (bootstrapEnabled) {
    try {
      const jsonPath = path.join(process.cwd(), "server", "learning", "bootstrapReplayThresholdOptimizer.json");
      if (fs.existsSync(jsonPath)) {
        const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        if (parsed && Array.isArray(parsed.rules)) {
          bootstrapRules = parsed.rules;
        }
      }
    } catch {}
  }

  const rules = (state?.enabled && Array.isArray(state.rules) && state.rules.length > 0)
    ? state.rules
    : bootstrapRules;

  if (rules.length === 0) {
    return { approved: true, reason: "replay_optimizer_disabled", matchedRules: [], scoreAdjustment: 0, stakeMultiplier: 1 };
  }

  const matchedRules = rules.filter((rule) => conditionMatches(rule.condition, candidate));
  const blockingRule = matchedRules.find((rule) => rule.action === "block");
  const observeOnly = state?.enabled ? (state.actionMode === "observe" || state.blockingEnabled === false) : true;
  const reduceEnabled = state?.enabled ? (state.reduceStakeEnabled !== false && !observeOnly) : false;
  const reduceRules = reduceEnabled ? matchedRules.filter((rule) => rule.action === "reduce_stake") : [];
  const boostRules = matchedRules.filter((rule) => rule.action === "boost");
  const observedBlockPenalty = observeOnly && blockingRule ? -12 : 0;
  const scoreAdjustment = matchedRules.reduce((sum, rule) => sum + finite(rule.scoreAdjustment), 0) + observedBlockPenalty;
  const stakeMultiplier = reduceRules.reduce((multiplier, rule) => Math.min(multiplier, finite(rule.stakeMultiplier, 1)), 1);

  if (blockingRule && !observeOnly) {
    return {
      approved: false,
      reason: `replay_block_${blockingRule.id}`,
      matchedRules,
      scoreAdjustment,
      stakeMultiplier: 0,
    };
  }

  return {
    approved: true,
    reason: observeOnly && blockingRule ? `replay_observe_${blockingRule.id}` : matchedRules.length ? "replay_optimizer_matched" : "replay_optimizer_clear",
    matchedRules,
    scoreAdjustment: scoreAdjustment + boostRules.length * 2,
    stakeMultiplier,
  };
}

function persistReplayThresholdOptimizerState(dataDir, state = {}) {
  try {
    const learningDir = path.join(dataDir, "learning");
    fs.mkdirSync(learningDir, { recursive: true });
    fs.writeFileSync(path.join(learningDir, "replay-threshold-optimizer.json"), JSON.stringify(state, null, 2));
  } catch {
    // Replay optimizer persistence must not stop scans.
  }
}

export {
  buildReplayThresholdOptimizerState,
  evaluateReplayOptimizer,
  persistReplayThresholdOptimizerState,
};
