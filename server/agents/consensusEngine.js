function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function vote(name, approved, score, reason, extra = {}) {
  return { name, approved: Boolean(approved), score: finite(score), reason, ...extra };
}

function runConsensusEngine(candidate = {}, context = {}, config = {}) {
  const minEdge = finite(config.minEdge, 0.003);
  const maxSpreadCents = finite(config.maxSpreadCents, 15);
  const maxBookAgeMs = finite(config.maxBookAgeMs, 10_000);
  const minConfidence = finite(config.minConfidence, 52);
  const minAgents = finite(config.minAgents, 2);
  const allowSingleTiny = config.allowSingleAgentTinyEntry !== false;

  const marketQuality = vote(
    "Market Quality Agent",
    finite(candidate.spreadCents ?? candidate.selectedSpreadCents) <= maxSpreadCents && finite(candidate.bookAgeMs) <= maxBookAgeMs,
    clamp(100 - finite(candidate.spreadCents ?? candidate.selectedSpreadCents) * 4 - finite(candidate.bookAgeMs) / 200, 0, 100),
    "spread_bookage_depth_check",
  );
  const signal = vote(
    "Signal Agent",
    finite(candidate.confidence) >= minConfidence && finite(candidate.feeAdjustedEdge ?? candidate.edge) >= minEdge,
    clamp(finite(candidate.confidence) + finite(candidate.feeAdjustedEdge ?? candidate.edge) * 250, 0, 100),
    "confidence_edge_check",
  );
  const flow = vote(
    "Flow/Wallet Agent",
    finite(candidate.walletScore, 0) >= 0 && finite(candidate.oddsVelocity, 0) >= finite(config.minOddsVelocity, -Infinity),
    clamp(55 + finite(candidate.walletScore, 0) * 6 + finite(candidate.oddsVelocity, 0) * 500, 0, 100),
    "wallet_flow_odds_velocity_check",
  );
  const risk = vote(
    "Risk Agent",
    !candidate.riskFlags?.length && finite(context.activePositions, 0) < finite(config.maxActivePositions, Infinity),
    clamp(100 - finite(context.activePositions, 0) * 4 - finite(context.consecutiveLosses, 0) * 12, 0, 100),
    candidate.riskFlags?.length ? candidate.riskFlags.join(",") : "risk_limits_clear",
  );

  const votes = [marketQuality, signal, flow, risk];
  const agreed = votes.filter((item) => item.approved).length;
  const averageScore = votes.reduce((sum, item) => sum + item.score, 0) / Math.max(1, votes.length);
  const approved = agreed >= minAgents || (allowSingleTiny && agreed >= 1 && averageScore >= 70);
  const stakeMultiplier = agreed >= 3
    ? 1
    : agreed === 2
      ? 0.65
      : approved
        ? finite(config.singleAgentStakeMultiplier, 0.35)
        : 0;

  return {
    approved,
    decision: approved ? "CANDIDATE" : "NO_TRADE",
    agreementCount: agreed,
    requiredAgreement: minAgents,
    averageScore,
    stakeMultiplier,
    votes,
    reason: approved ? "consensus_approved" : "consensus_rejected",
  };
}

export { runConsensusEngine };
