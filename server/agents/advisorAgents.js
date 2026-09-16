function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function agentResult(agent, status, payload = {}) {
  return { agent, status, updatedAt: new Date().toISOString(), ...payload };
}

function marketDiscoveryAgent(markets = []) {
  const candidates = markets
    .filter((market) => market.cryptoCandidate || /btc|bitcoin|eth|ethereum|sol|xrp|doge|crypto/i.test(`${market.slug} ${market.question} ${market.category}`))
    .sort((left, right) => finite(right.opportunityScore) - finite(left.opportunityScore))
    .slice(0, 20);
  return agentResult("Market Discovery Agent", "ok", {
    candidates: candidates.length,
    top: candidates.slice(0, 5).map((market) => ({ slug: market.slug, strategy: market.strategy, score: market.opportunityScore })),
  });
}

function strategyRouterAgent(markets = []) {
  const counts = markets.reduce((map, market) => {
    const key = market.strategy || "watch_only";
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
  return agentResult("Strategy Router Agent", "ok", { strategies: counts });
}

function signalAnalystAgent(signal) {
  if (!signal || signal.rank === "SKIP") {
    return agentResult("Signal Analyst Agent", "wait", { decision: "SKIP", reason: signal?.reason || "no_high_quality_signal" });
  }
  return agentResult("Signal Analyst Agent", "ok", {
    decision: "CANDIDATE",
    rank: signal.rank,
    side: signal.side || signal.predictedOutcome,
    probability: signal.probability,
    entryPrice: signal.entryPrice,
    edge: signal.feeAdjustedEdge ?? signal.edge,
    reasons: signal.reasons || [],
  });
}

function microstructureAgent(signal) {
  const flags = [];
  if (finite(signal?.bookAgeMs) > 2_000) flags.push("stale_book");
  if (finite(signal?.spreadCents ?? signal?.selectedSpreadCents) > 3) flags.push("wide_spread");
  if (finite(signal?.yesNoAskCost, 1) > 1.04) flags.push("bad_complete_set_cost");
  if (Math.abs(finite(signal?.selectedBookImbalance)) < 0.02) flags.push("weak_book_confirmation");
  return agentResult("Microstructure Agent", flags.length ? "warn" : "ok", { flags });
}

function walletFillValidationAgent(reference, signal) {
  const agreement = reference?.agreement || {};
  const fresh = finite(agreement.referenceAgeSec, 999999) <= 30 * 60;
  const sameSide = agreement.status === "aligned" || agreement.status === "same_market_aligned";
  const opposite = agreement.status === "opposed" || agreement.status === "same_market_opposed";
  const walletScore = fresh && sameSide ? 3 : fresh && opposite ? -5 : 0;
  return agentResult("Wallet/Fill Validation Agent", "ok", {
    walletScore,
    fresh,
    agreement: agreement.status || "waiting",
    referenceOutcome: agreement.referenceOutcome || "WAIT",
    signalOutcome: signal?.side || signal?.predictedOutcome || "WAIT",
  });
}

function postTradeLearningAgent(calibration) {
  const recommendation = !calibration?.reliable
    ? "collect_more_samples"
    : calibration.roi < 0
      ? "increase_min_edge_and_confidence"
      : calibration.winRate < 75
        ? "tighten_filters"
        : "keep_current_thresholds";
  return agentResult("Post-Trade Learning Agent", "ok", {
    recommendation,
    settled: calibration?.settled || 0,
    winRate: calibration?.winRate || 0,
    roi: calibration?.roi || 0,
  });
}

function runAdvisorAgents({ markets = [], signal = null, reference = null, calibration = null } = {}) {
  const micro = microstructureAgent(signal || {});
  const wallet = walletFillValidationAgent(reference, signal || {});
  const enrichedSignal = signal
    ? {
        ...signal,
        walletScore: wallet.walletScore,
        riskFlags: [...(signal.riskFlags || []), ...(micro.flags || [])],
      }
    : null;
  return {
    mode: "advisor",
    canExecute: false,
    activeAgents: 6,
    agents: [
      marketDiscoveryAgent(markets),
      strategyRouterAgent(markets),
      signalAnalystAgent(enrichedSignal),
      micro,
      wallet,
      postTradeLearningAgent(calibration),
    ],
    decision: enrichedSignal?.rank && enrichedSignal.rank !== "SKIP" ? "CANDIDATE" : "WAIT",
    updatedAt: new Date().toISOString(),
  };
}

export { runAdvisorAgents };
