function finite(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function classifyFastGrowEv(calibratedNetEv = {}, config = {}) {
  const minNetEdge = finite(config.minNetEdge, 0.05);
  const laneSMinNetEdge = Math.max(minNetEdge, finite(config.laneSMinNetEdge, 0.10));
  const netEdge = finite(calibratedNetEv.netEdge);
  const calibratedProbability = finite(calibratedNetEv.calibratedProbability);
  const executable = calibratedNetEv.eligible === true && Number.isFinite(netEdge) && netEdge >= minNetEdge;
  const requestedLane = executable ? (netEdge >= laneSMinNetEdge ? "S" : "A") : "OBSERVE";
  const laneCeiling = String(config.laneCeiling || "S").trim().toUpperCase();
  const laneSEvidenceReady = config.laneSEvidenceReady !== false;
  const lane = requestedLane === "S" && (laneCeiling === "A" || !laneSEvidenceReady) ? "A" : requestedLane;
  return {
    executable,
    lane,
    reason: executable
      ? (lane === "S"
          ? "fastgrow_lane_s_regime_core_ready"
          : requestedLane === "S"
            ? "fastgrow_lane_s_locally_downgraded_to_a"
            : "fastgrow_lane_a_ready")
      : (calibratedNetEv.reason || "fastgrow_net_edge_below_floor"),
    netEdge: Number.isFinite(netEdge) ? netEdge : null,
    calibratedProbability: Number.isFinite(calibratedProbability) ? calibratedProbability : null,
    minNetEdge,
    laneSMinNetEdge,
    requestedLane,
    laneCeiling,
    laneSEvidenceReady,
    cheapPriceAloneCanPromoteLaneS: false,
  };
}

function interpolateFraction(value, start, end, minFraction, maxFraction) {
  if (end <= start) return maxFraction;
  const progress = clamp((value - start) / (end - start), 0, 1);
  return minFraction + progress * (maxFraction - minFraction);
}

function sizeFastGrowStake(input = {}, config = {}) {
  const policy = input.policy || classifyFastGrowEv(input.calibratedNetEv, config);
  const equity = Math.max(0, finite(input.equity, 0));
  const entryPrice = finite(input.entryPrice);
  const depthShares = Math.max(0, finite(input.depthShares, 0));
  const maxTradeUsd = Math.max(0, finite(input.maxTradeUsd, equity));
  const minimumOrderShares = finite(input.minimumOrderShares, Number.NaN);
  const minimumRecordedFillUsd = Math.max(0, finite(input.minimumRecordedFillUsd, 1));
  const depthUtilization = clamp(finite(config.depthUtilization, 1), 0.10, 1);
  if (!policy.executable || equity <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
    return {
      executable: false,
      reason: policy.reason || "fastgrow_sizing_input_invalid",
      lane: policy.lane || "OBSERVE",
      stakeUsd: 0,
      stakeFraction: 0,
      equity,
      entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
    };
  }
  if (!Number.isFinite(minimumOrderShares) || minimumOrderShares <= 0) {
    return {
      executable: false,
      reason: "fastgrow_market_minimum_shares_unavailable",
      lane: policy.lane || "OBSERVE",
      stakeUsd: 0,
      stakeFraction: 0,
      equity,
      entryPrice,
      minimumOrderShares: null,
    };
  }

  const edge = Math.max(0, finite(policy.netEdge, 0));
  const lane = policy.lane;
  const laneAMinFraction = clamp(finite(config.laneAMinFraction, 0.08), 0, 1);
  const laneAMaxFraction = clamp(finite(config.laneAMaxFraction, 0.10), laneAMinFraction, 1);
  const laneSMinFraction = clamp(finite(config.laneSMinFraction, 0.12), 0, 1);
  const laneSMaxFraction = clamp(finite(config.laneSMaxFraction, 0.15), laneSMinFraction, 1);
  const stakeFraction = lane === "S"
    ? interpolateFraction(edge, policy.laneSMinNetEdge, finite(config.laneSMaxEdge, 0.20), laneSMinFraction, laneSMaxFraction)
    : interpolateFraction(edge, policy.minNetEdge, policy.laneSMinNetEdge, laneAMinFraction, laneAMaxFraction);
  const equityStakeUsd = equity * stakeFraction;
  const visibleDepthStakeUsd = depthShares > 0 ? depthShares * entryPrice * depthUtilization : 0;
  const minimumOrderStakeUsd = minimumOrderShares * entryPrice;
  const minimumExecutableStakeUsd = Math.max(minimumRecordedFillUsd, minimumOrderStakeUsd);
  const stakeUsd = Math.max(0, Math.min(equity, maxTradeUsd, equityStakeUsd, visibleDepthStakeUsd));
  const executable = stakeUsd + 1e-9 >= minimumExecutableStakeUsd;
  return {
    executable,
    reason: executable ? "fastgrow_depth_equity_stake_ready" : "fastgrow_stake_below_market_minimum",
    lane,
    stakeUsd,
    stakeFraction,
    stakeToEquityPct: equity > 0 ? (stakeUsd / equity) * 100 : 0,
    equity,
    entryPrice,
    netEdge: edge,
    equityStakeUsd,
    visibleDepthStakeUsd,
    depthShares,
    depthUtilization,
    maxTradeUsd,
    minimumOrderShares,
    minimumOrderStakeUsd,
    minimumExecutableStakeUsd,
  };
}

export { classifyFastGrowEv, sizeFastGrowStake };
