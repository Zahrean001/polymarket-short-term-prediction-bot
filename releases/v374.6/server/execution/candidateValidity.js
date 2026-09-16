function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function technicalReasonText(candidate = {}) {
  const failedGateReasons = Array.isArray(candidate.gates?.allGates)
    ? candidate.gates.allGates
      .filter((gate) => gate?.passed === false)
      .map((gate) => gate.reason)
    : [];
  return [
    candidate.blockedReason,
    candidate.preBlockReason,
    candidate.gates?.reason,
    candidate.reason,
    ...failedGateReasons,
  ].filter(Boolean).join("|").toLowerCase();
}

function isTechnicalInvalidReason(reason = "") {
  return /missing|invalid|no_liquidity|insufficient_directional_depth|insufficient_real_return_history|closed|duplicate|max_active|max_positions|synthetic|fallback|non_live|live_orderbook_required|strategy_not_executable|strategy_not_in_allowlist|strategy_force_blocked|tick|negative_spread|crossed|stale|anchor_unavailable|external_price_anchor|real_market_data_only|window_almost_closed|outside_entry/.test(String(reason).toLowerCase());
}

function isCandidateTechnicallyExecutable(candidate = {}, options = {}) {
  const entryPrice = finite(candidate.entryPrice, 0);
  const depthShares = finite(candidate.depthShares, 0);
  const maxEntryPrice = finite(options.maxEntryPrice, 0.98);
  if (entryPrice < 0.05 || entryPrice > maxEntryPrice || depthShares <= 0) return false;
  return !isTechnicalInvalidReason(technicalReasonText(candidate));
}

export { isCandidateTechnicallyExecutable, isTechnicalInvalidReason, technicalReasonText };
