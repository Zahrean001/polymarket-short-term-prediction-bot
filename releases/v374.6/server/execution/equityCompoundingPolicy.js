function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function applyOptionalUsdHardCap(value, hardCapUsd = 0) {
  const uncappedValue = Math.max(0, finite(value, 0));
  const hardCap = finite(hardCapUsd, 0);
  return hardCap > 0 ? Math.min(uncappedValue, hardCap) : uncappedValue;
}

function computeDynamicEquityTradeCap(input = {}) {
  const equity = Math.max(0, finite(input.equity, 0));
  const minimumExecutableStakeUsd = Math.max(0, finite(input.minimumExecutableStakeUsd, 0));
  const baseTradeUsd = Math.max(minimumExecutableStakeUsd, finite(input.baseTradeUsd, minimumExecutableStakeUsd));
  const maxTradeEquityFraction = Math.min(1, Math.max(0.0001, finite(input.maxTradeEquityFraction, 0.15)));
  const scalingStartEquity = Math.max(0, finite(input.scalingStartEquity, 0));
  const lane = String(input.lane || "A").trim().toUpperCase();
  const hardCapUsd = Math.max(0, finite(input.hardCapUsd, 0));
  const staticUsdHardCapEnabled = hardCapUsd > 0;

  if (equity <= 0) {
    return {
      capUsd: 0,
      unconstrainedCapUsd: 0,
      equity,
      lane,
      maxTradeEquityFraction,
      hardCapUsd,
      staticUsdHardCapEnabled,
      basis: "current_realized_equity",
    };
  }

  let targetCapUsd;
  if (input.scalingEnabled === false) {
    targetCapUsd = baseTradeUsd;
  } else if (lane === "B" || lane === "PROBE") {
    const probeFraction = Math.min(1, Math.max(0.0001, finite(input.probeMaxTradeEquityFraction, 0.0025)));
    const probeLaneCapUsd = Math.max(minimumExecutableStakeUsd, finite(input.laneBMaxTradeUsd, minimumExecutableStakeUsd));
    targetCapUsd = Math.min(probeLaneCapUsd, Math.max(minimumExecutableStakeUsd, equity * probeFraction));
  } else if (equity < scalingStartEquity) {
    targetCapUsd = Math.min(baseTradeUsd, Math.max(minimumExecutableStakeUsd, equity * maxTradeEquityFraction));
  } else {
    const laneScaledBaseCapUsd = Math.max(0, finite(input.laneScaledBaseCapUsd, 0));
    targetCapUsd = Math.max(baseTradeUsd, equity * maxTradeEquityFraction, laneScaledBaseCapUsd);
  }

  // Cash/equity is always a hard ceiling. A zero USD hard cap explicitly means
  // "disabled", so growth cannot silently flatten at a fixed dollar threshold.
  const unconstrainedCapUsd = Math.min(equity, Math.max(0, targetCapUsd));
  const capUsd = applyOptionalUsdHardCap(unconstrainedCapUsd, hardCapUsd);
  return {
    capUsd,
    unconstrainedCapUsd,
    equity,
    lane,
    baseTradeUsd,
    maxTradeEquityFraction,
    hardCapUsd,
    staticUsdHardCapEnabled,
    basis: "current_realized_equity",
  };
}

export { applyOptionalUsdHardCap, computeDynamicEquityTradeCap };
