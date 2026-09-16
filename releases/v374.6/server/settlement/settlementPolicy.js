function isOfficialFinalStatus(status = "") {
  return status === "paper_win" || status === "paper_loss";
}

function isProxyStatus(status = "") {
  return status === "paper_proxy_win" || status === "paper_proxy_loss";
}

function provisionalProxyStatus(won) {
  return won ? "paper_proxy_win" : "paper_proxy_loss";
}

function shouldTrainFromSettlement(signal = {}) {
  const source = String(signal.settlementSource || signal.settlementFinality || "").toLowerCase();
  const executionStatus = String(signal.executionStatus || "").toLowerCase();
  const explicitFilledStake = Number(signal.filledStakeUsd);
  const legacyStake = Number(signal.paperStakeUsd ?? signal.stakeUsd);
  const filled = (executionStatus === "filled" || executionStatus === "partial_fill") && (
    (Number.isFinite(explicitFilledStake) && explicitFilledStake > 0) ||
    (!Number.isFinite(explicitFilledStake) && Number.isFinite(legacyStake) && legacyStake > 0)
  );
  return signal.learningEligible !== false && filled && isOfficialFinalStatus(signal.status) && (
    signal.officialSettlementUsed === true ||
    source.includes("official_poly") ||
    source.includes("polymarket_gamma") ||
    source.includes("polymarket_web")
  );
}

export { isOfficialFinalStatus, isProxyStatus, provisionalProxyStatus, shouldTrainFromSettlement };
