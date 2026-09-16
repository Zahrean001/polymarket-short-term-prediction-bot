import fs from "node:fs";
import path from "node:path";
import { buildStrategyPerformanceReport } from "./strategyPerformanceTracker.js";

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readJsonlFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readJsonlDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath)
      .filter((name) => name.endsWith(".jsonl"))
      .sort()
      .flatMap((name) => readJsonlFile(path.join(dirPath, name)));
  } catch {
    return [];
  }
}

function summarizeAllowedStrategies(report) {
  const strategies = Array.isArray(report?.strategies) ? report.strategies : [];
  const allowed = [];
  const blocked = [];
  for (const item of strategies) {
    const settled = finite(item.real?.settled ?? item.settled);
    const roi = finite(item.real?.roi ?? item.roi);
    const winRate = finite(item.real?.winRate ?? item.winRate);
    const strategy = item.strategy || "unknown";
    if (settled >= 20 && roi > 0 && winRate >= 55) allowed.push(strategy);
    if (settled >= 20 && (roi < 0 || winRate < 50)) blocked.push(strategy);
  }
  return {
    allowed: [...new Set(allowed)],
    blocked: [...new Set(blocked)],
  };
}

function buildAdaptiveThresholds(report) {
  const confidenceBuckets = Array.isArray(report?.confidenceBuckets) ? report.confidenceBuckets : [];
  const entryPriceBuckets = Array.isArray(report?.entryPriceBuckets) ? report.entryPriceBuckets : [];
  const goodConfidence = confidenceBuckets
    .filter((bucket) => finite(bucket.settled) >= 10 && finite(bucket.roi) > 0)
    .sort((a, b) => finite(a.min) - finite(b.min))[0];
  const goodEntryPrice = entryPriceBuckets
    .filter((bucket) => finite(bucket.settled) >= 10 && finite(bucket.roi) > 0)
    .sort((a, b) => finite(a.min) - finite(b.min))[0];
  return {
    minConfidence: Math.max(80, finite(goodConfidence?.min, 80)),
    minEntryPrice: Math.max(0.5, finite(goodEntryPrice?.min, 0.5)),
    minFeeAdjustedEdge: 0.025,
    forceAllow: ["dual_side_ev", "price_field"],
    forceBlock: ["sticky_lag", "new_member_band", "endcycle_sniper", "current_prediction"],
  };
}

function loadImportedLearningBrain(dataDir, options = {}) {
  const enabled = options.enabled !== false;
  if (!enabled) return { enabled: false, status: "disabled" };
  const signalDir = path.join(dataDir, "signals");
  const settlementDir = path.join(dataDir, "settlements");
  const gateDir = path.join(dataDir, "gates");
  const sampleRoot = path.join(dataDir, "learning", "samples");
  const rawSignals = [
    ...readJsonlDir(signalDir),
    ...readJsonlDir(path.join(sampleRoot, "signals")),
  ];
  const settlements = [
    ...readJsonlDir(settlementDir),
    ...readJsonlDir(path.join(sampleRoot, "settlements")),
  ];
  const gates = [
    ...readJsonlDir(gateDir),
    ...readJsonlDir(path.join(sampleRoot, "gates")),
  ];
  const signals = settlements.length ? settlements : rawSignals;
  const report = buildStrategyPerformanceReport(signals, gates);
  const strategyLists = summarizeAllowedStrategies(report);
  const adaptiveThresholds = buildAdaptiveThresholds(report);
  const brain = {
    enabled: true,
    status: signals.length ? "loaded" : "empty",
    importedAt: new Date().toISOString(),
    importedSamples: rawSignals.length,
    importedSettlements: settlements.length,
    importedGates: gates.length,
    settled: finite(report.settled),
    adaptiveSignals: signals
      .filter((signal) => signal.status === "paper_win" || signal.status === "paper_loss")
      .slice(-500),
    report,
    allowedStrategies: [...new Set(["dual_side_ev", ...(strategyLists.allowed.length ? strategyLists.allowed : adaptiveThresholds.forceAllow)])],
    blockedStrategies: [...new Set([...strategyLists.blocked, ...adaptiveThresholds.forceBlock])],
    adaptiveThresholds,
  };
  try {
    const learningDir = path.join(dataDir, "learning");
    fs.mkdirSync(learningDir, { recursive: true });
    fs.writeFileSync(path.join(learningDir, "imported-strategy-performance.json"), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(learningDir, "adaptive-thresholds.json"), JSON.stringify(adaptiveThresholds, null, 2));
    fs.writeFileSync(path.join(learningDir, "learning-brain-summary.json"), JSON.stringify({
      importedAt: brain.importedAt,
      importedSamples: brain.importedSamples,
      importedSettlements: brain.importedSettlements,
      settled: brain.settled,
      allowedStrategies: brain.allowedStrategies,
      blockedStrategies: brain.blockedStrategies,
      adaptiveThresholds,
    }, null, 2));
  } catch {
    // Learning brain should never stop the bot.
  }
  return brain;
}

function selectLearningPerformanceReport(runtimeReport, importedBrain, options = {}) {
  const runtimeSettled = finite(runtimeReport?.settled ?? runtimeReport?.total?.settled);
  const minRuntimeSettled = finite(options.minRuntimeSettled, 100);
  
  if (runtimeSettled >= minRuntimeSettled) {
    return { ...runtimeReport, learningSource: "runtime" };
  }
  
  if (importedBrain?.enabled && importedBrain.status === "loaded") {
    return {
      ...importedBrain.report,
      learningSource: "imported_learning_brain",
      runtimeSettled,
      importedSamples: importedBrain.importedSamples,
    };
  }
  
  // Fallback to bootstrap strategy performance report to avoid dumb cold start
  const bootstrapEnabled = process.env.BOOTSTRAP_LEARNING_ENABLED === "1";
  if (bootstrapEnabled) {
    try {
      const jsonPath = path.join(process.cwd(), "server", "learning", "bootstrapStrategyPerformance.json");
      if (fs.existsSync(jsonPath)) {
        const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        return {
          ...parsed,
          learningSource: "bootstrap_strategy_performance_json",
          runtimeSettled,
          importedSamples: 637,
        };
      }
    } catch {}
  }

  return {
    ...runtimeReport,
    learningSource: "runtime_empty_fallback",
    runtimeSettled,
  };
}

function summarizeRuntime(signals = []) {
  const settled = signals
    .filter((signal) => signal.status === "paper_win" || signal.status === "paper_loss")
    .sort((left, right) => Date.parse(right.settledAt || right.windowEnd || right.time || "") - Date.parse(left.settledAt || left.windowEnd || left.time || ""));
  const wins = settled.filter((signal) => signal.status === "paper_win").length;
  const losses = settled.length - wins;
  const pnl = settled.reduce((sum, signal) => sum + finite(signal.paperPnlUsd), 0);
  const stake = settled.reduce((sum, signal) => sum + finite(signal.paperStakeUsd), 0);
  let consecutiveLosses = 0;
  for (const signal of settled) {
    if (signal.status === "paper_loss") consecutiveLosses += 1;
    else break;
  }
  return {
    settled: settled.length,
    wins,
    losses,
    winRate: settled.length ? (wins / settled.length) * 100 : 0,
    pnl,
    stake,
    roi: stake ? (pnl / stake) * 100 : 0,
    consecutiveLosses,
  };
}

function getProgressiveStage({ signals = [], accountRisk = {}, equity = 0, config = {} } = {}) {
  const stats = summarizeRuntime(signals);
  const drawdownStop = finite(accountRisk.dailyLossFraction) >= finite(config.maxDailyLossFraction, 0.35);
  const lossStreak = Math.max(stats.consecutiveLosses, finite(accountRisk.consecutiveLosses));
  const settled = stats.settled;
  let stage = "warmup";
  let stakeMultiplier = finite(config.warmupStakeMultiplier, 0.65);
  let reason = "runtime_warmup";

  if (drawdownStop || lossStreak >= finite(config.recoveryLossStreak, 3)) {
    stage = "recovery";
    stakeMultiplier = finite(config.recoveryStakeMultiplier, 0.35);
    reason = drawdownStop ? "daily_drawdown_recovery" : "loss_streak_recovery";
  } else if (
    settled >= finite(config.aggressiveSettled, 50) &&
    stats.roi >= finite(config.aggressiveMinRoi, 8) &&
    stats.winRate >= finite(config.aggressiveMinWinRate, 65)
  ) {
    stage = "aggressive_growth";
    stakeMultiplier = finite(config.aggressiveStakeMultiplier, 1.15);
    reason = "runtime_aggressive_growth_unlocked";
  } else if (
    settled >= finite(config.growthSettled, 20) &&
    stats.roi > finite(config.growthMinRoi, 0) &&
    stats.winRate >= finite(config.growthMinWinRate, 58)
  ) {
    stage = "growth";
    stakeMultiplier = finite(config.growthStakeMultiplier, 0.9);
    reason = "runtime_growth_unlocked";
  }

  const equityBoost = equity >= 80 ? 1.2 : equity >= 60 ? 1.1 : equity >= 50 ? 1.05 : 1;
  return {
    stage,
    reason,
    stakeMultiplier: stage === "recovery" ? stakeMultiplier : stakeMultiplier * equityBoost,
    equityBoost,
    stats,
  };
}

export {
  getProgressiveStage,
  loadImportedLearningBrain,
  selectLearningPerformanceReport,
  summarizeRuntime,
};
