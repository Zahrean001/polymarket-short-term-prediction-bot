function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function classifySource(signal = {}) {
  const text = `${signal.bookSource || ""} ${signal.title || ""}`.toLowerCase();
  return text.includes("synthetic") || text.includes("learning fallback") ? "fallback" : "real_market";
}

function strategyName(signal = {}) {
  return signal.strategy || signal.strategyName || signal.entryStrategy || signal.strategyVersion || "current_prediction";
}

function summarizeRows(rows = []) {
  const settled = rows.filter((item) => item.status === "paper_win" || item.status === "paper_loss");
  const wins = settled.filter((item) => item.status === "paper_win").length;
  const losses = settled.length - wins;
  const pnl = settled.reduce((sum, item) => sum + finite(item.paperPnlUsd), 0);
  const stake = settled.reduce((sum, item) => sum + finite(item.paperStakeUsd), 0);
  return {
    samples: rows.length,
    settled: settled.length,
    wins,
    losses,
    winRate: settled.length ? (wins / settled.length) * 100 : 0,
    pnl,
    stake,
    roi: stake ? (pnl / stake) * 100 : 0,
    avgConfidence: settled.length ? settled.reduce((sum, item) => sum + finite(item.confidence), 0) / settled.length : 0,
    avgBuyPrice: settled.length ? settled.reduce((sum, item) => sum + finite(item.buyPrice), 0) / settled.length : 0,
  };
}

function bucketBy(rows, name, ranges, getValue) {
  return ranges.map((range) => {
    const bucketRows = rows.filter((row) => {
      const value = getValue(row);
      return value >= range.min && value < range.max;
    });
    return { name, label: range.label, min: range.min, max: range.max, ...summarizeRows(bucketRows) };
  });
}

function buildStrategyPerformanceReport(signals = [], gates = []) {
  const settled = signals.filter((item) => item.status === "paper_win" || item.status === "paper_loss");
  const bySource = ["real_market", "fallback"].map((source) => ({ source, ...summarizeRows(signals.filter((signal) => classifySource(signal) === source)) }));
  const names = [...new Set(signals.map(strategyName))];
  const strategies = names.map((name) => {
    const rows = signals.filter((signal) => strategyName(signal) === name);
    const summary = summarizeRows(rows);
    const real = summarizeRows(rows.filter((signal) => classifySource(signal) === "real_market"));
    const fallback = summarizeRows(rows.filter((signal) => classifySource(signal) === "fallback"));
    return { strategy: name, ...summary, real, fallback };
  }).sort((left, right) => right.roi - left.roi);
  const confidenceBuckets = bucketBy(settled, "confidence", [
    { label: "0-60", min: 0, max: 60 },
    { label: "60-70", min: 60, max: 70 },
    { label: "70-80", min: 70, max: 80 },
    { label: "80-85", min: 80, max: 85 },
    { label: "85-90", min: 85, max: 90 },
    { label: "90-95", min: 90, max: 95 },
    { label: "95-100", min: 95, max: 101 },
  ], (row) => finite(row.confidence));
  const entryPriceBuckets = bucketBy(settled, "buyPrice", [
    { label: "0.00-0.20", min: 0, max: 0.20 },
    { label: "0.20-0.50", min: 0.20, max: 0.50 },
    { label: "0.50-0.75", min: 0.50, max: 0.75 },
    { label: "0.75-0.90", min: 0.75, max: 0.90 },
    { label: "0.90-1.00", min: 0.90, max: 1.01 },
  ], (row) => finite(row.buyPrice));
  const gateFailures = gates.reduce((map, row) => {
    const reason = row?.blockedAt?.reason || row?.reason || "unknown";
    map[reason] = (map[reason] || 0) + 1;
    return map;
  }, {});
  const realMarket = bySource.find((item) => item.source === "real_market") || summarizeRows([]);
  const recommendations = [];
  if ((bySource.find((item) => item.source === "fallback")?.roi || 0) < realMarket.roi) recommendations.push("keep_fallback_separate_from_real_learning");
  if (confidenceBuckets.find((bucket) => bucket.label === "60-70")?.roi < 0) recommendations.push("avoid_low_confidence_real_entries");
  if (entryPriceBuckets.find((bucket) => bucket.label === "0.00-0.20")?.roi > 500) recommendations.push("apply_low_price_outlier_sanity_filter");
  return {
    updatedAt: new Date().toISOString(),
    total: summarizeRows(signals),
    settled: settled.length,
    bySource,
    strategies,
    confidenceBuckets,
    entryPriceBuckets,
    gateFailures,
    recommendations,
  };
}

export { buildStrategyPerformanceReport, classifySource };
