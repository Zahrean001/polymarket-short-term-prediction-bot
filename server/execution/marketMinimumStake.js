function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveMarketMinimumShares(...values) {
  const advertised = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return advertised.length > 0 ? Math.max(...advertised) : null;
}

function calculateActualMinimumStake(input = {}) {
  const minimumRecordedFillUsd = Math.max(0, finite(input.minimumRecordedFillUsd, 0));
  const marketMinimumShares = Math.max(0, finite(input.marketMinimumShares, 0));
  const executablePrice = finite(input.executablePrice, Number.NaN);
  const validPrice = Number.isFinite(executablePrice) && executablePrice > 0 && executablePrice < 1;
  const marketMinimumStakeUsd = validPrice ? marketMinimumShares * executablePrice : Number.POSITIVE_INFINITY;
  const actualMinimumStakeUsd = validPrice
    ? Math.max(minimumRecordedFillUsd, marketMinimumStakeUsd)
    : Number.POSITIVE_INFINITY;
  return {
    valid: validPrice && marketMinimumShares > 0 && Number.isFinite(actualMinimumStakeUsd),
    reason: !validPrice
      ? "market_minimum_executable_price_invalid"
      : marketMinimumShares <= 0
        ? "market_minimum_shares_invalid"
        : "actual_market_minimum_ready",
    minimumRecordedFillUsd,
    marketMinimumShares,
    executablePrice: validPrice ? executablePrice : null,
    marketMinimumStakeUsd: Number.isFinite(marketMinimumStakeUsd) ? marketMinimumStakeUsd : null,
    actualMinimumStakeUsd: Number.isFinite(actualMinimumStakeUsd) ? actualMinimumStakeUsd : null,
    artificialFixedUsdFloorApplied: false,
  };
}

function feeRatioToStake(entryPrice, feeRate) {
  const price = Math.min(0.9999, Math.max(0.0001, finite(entryPrice, 0)));
  return Math.max(0, finite(feeRate, 0)) * (1 - price);
}

function maximumStakeWithinUnresolvedReserve(input = {}) {
  const realizedEquityUsd = Math.max(0, finite(input.realizedEquityUsd, 0));
  const openReservedUsd = Math.max(0, finite(input.openReservedUsd, 0));
  const maxReserveFraction = Math.min(1, Math.max(0, finite(input.maxReserveFraction, 0.30)));
  const minimumStakeUsd = Math.max(0, finite(input.minimumStakeUsd, 0));
  const reserveLimitUsd = realizedEquityUsd * maxReserveFraction;
  const availableReserveUsd = Math.max(0, reserveLimitUsd - openReservedUsd);
  const feeRatio = feeRatioToStake(input.entryPrice, input.feeRate);
  const maximumStakeUsd = availableReserveUsd / (1 + feeRatio);
  const executable = maximumStakeUsd + 1e-9 >= minimumStakeUsd;
  return {
    executable,
    reason: executable ? "unresolved_reserve_available" : "unresolved_reserve_cap_reached",
    realizedEquityUsd,
    maxReserveFraction,
    reserveLimitUsd,
    openReservedUsd,
    availableReserveUsd,
    feeRatioToStake: feeRatio,
    maximumStakeUsd: executable ? maximumStakeUsd : 0,
    minimumStakeUsd,
  };
}

export {
  calculateActualMinimumStake,
  feeRatioToStake,
  maximumStakeWithinUnresolvedReserve,
  resolveMarketMinimumShares,
};
