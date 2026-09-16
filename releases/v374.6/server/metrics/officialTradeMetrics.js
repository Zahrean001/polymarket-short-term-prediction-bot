import { shouldTrainFromSettlement } from "../settlement/settlementPolicy.js";

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isFilledTrade(signal = {}) {
  const executionStatus = String(signal.executionStatus || "").toLowerCase();
  if (executionStatus !== "filled" && executionStatus !== "partial_fill") return false;
  const filledStakeUsd = finite(signal.filledStakeUsd, Number.NaN);
  if (Number.isFinite(filledStakeUsd)) return filledStakeUsd > 0;
  return finite(signal.paperStakeUsd ?? signal.stakeUsd, 0) > 0;
}

function outcomeKey(signal = {}) {
  const slug = String(signal.slug || "").trim().toLowerCase();
  if (slug) return `slug:${slug}`;
  const conditionId = String(signal.conditionId || signal.marketId || "").trim().toLowerCase();
  if (conditionId) return `condition:${conditionId}`;
  return [
    String(signal.symbol || "UNKNOWN").toUpperCase(),
    String(signal.timeframe || "UNKNOWN").toUpperCase(),
    signal.windowStart || "",
    signal.windowEnd || "",
  ].join(":");
}

function officialFilledTrades(signals = [], options = {}) {
  const timeframe = String(options.timeframe || "").trim().toUpperCase();
  return (Array.isArray(signals) ? signals : [])
    .filter((signal) => signal && shouldTrainFromSettlement(signal) && isFilledTrade(signal))
    .filter((signal) => !timeframe || String(signal.timeframe || "").toUpperCase() === timeframe)
    .sort((left, right) => {
      const leftTime = Date.parse(left.time || left.createdAt || left.windowStart || "") || 0;
      const rightTime = Date.parse(right.time || right.createdAt || right.windowStart || "") || 0;
      return leftTime - rightTime;
    });
}

function uniqueOfficialFilledTrades(signals = [], options = {}) {
  const firstByOutcome = new Map();
  for (const signal of officialFilledTrades(signals, options)) {
    const key = outcomeKey(signal);
    if (!firstByOutcome.has(key)) firstByOutcome.set(key, signal);
  }
  return [...firstByOutcome.values()];
}

function wilsonInterval(wins, total, z = 1.959963984540054) {
  if (!total) return { lower: null, upper: null };
  const p = wins / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p) / total) + (z * z) / (4 * total * total));
  return { lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function summarizeOfficialFilledUnique(signals = [], options = {}) {
  const raw = officialFilledTrades(signals, options);
  const unique = uniqueOfficialFilledTrades(signals, options);
  const wins = unique.filter((signal) => signal.status === "paper_win").length;
  const losses = unique.length - wins;
  const interval = wilsonInterval(wins, unique.length);
  return {
    definition: `official_filled_unique_${String(options.timeframe || "all").toLowerCase()}`,
    rawFilledSettledTrades: raw.length,
    uniqueOutcomes: unique.length,
    duplicatesExcluded: Math.max(0, raw.length - unique.length),
    wins,
    losses,
    winRate: unique.length ? (wins / unique.length) * 100 : 0,
    wilson95Lower: interval.lower === null ? null : interval.lower * 100,
    wilson95Upper: interval.upper === null ? null : interval.upper * 100,
  };
}

export {
  isFilledTrade,
  officialFilledTrades,
  outcomeKey,
  summarizeOfficialFilledUnique,
  uniqueOfficialFilledTrades,
  wilsonInterval,
};
