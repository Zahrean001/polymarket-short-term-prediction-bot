import { priceBucket } from "../research/observerPolicy.js";
import { shouldTrainFromSettlement } from "../settlement/settlementPolicy.js";

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function direction(value) {
  return String(value || "").trim().toUpperCase();
}

function cohortKey(row = {}) {
  return [
    String(row.symbol || "UNKNOWN").trim().toUpperCase(),
    direction(row.direction || row.side || row.predictedOutcome),
    priceBucket(row.averageFillPrice ?? row.buyPrice ?? row.selectedBuyPrice ?? row.entryPrice),
  ].join("|");
}

function canonicalSettlementKey(signal = {}) {
  return String(signal.id || signal.slug || "").trim();
}

function uniqueOfficialSettlements(signals = []) {
  const unique = new Map();
  for (const signal of Array.isArray(signals) ? signals : []) {
    if (!shouldTrainFromSettlement(signal)) continue;
    if (signal.botRole !== "main_test") continue;
    if (String(signal.sourceType || "").toLowerCase() !== "real_market") continue;
    if (signal.realParityEligible !== true) continue;
    const key = canonicalSettlementKey(signal);
    if (!key) continue;
    unique.set(key, signal);
  }
  return [...unique.values()].sort((left, right) =>
    (Date.parse(left.settledAt || left.time || "") || 0) - (Date.parse(right.settledAt || right.time || "") || 0)
  );
}

function evaluateCohortRegimeGuard(signals = [], candidate = {}, config = {}) {
  if (config.enabled === false) {
    return { enabled: false, active: false, reason: "cohort_regime_guard_disabled", laneCeiling: "S" };
  }
  const lookback = Math.max(3, Math.trunc(finite(config.lookback, 3)));
  const lossTrigger = Math.max(1, Math.trunc(finite(config.lossTrigger, 2)));
  const ttlSettlements = Math.max(1, Math.trunc(finite(config.ttlSettlements, 3)));
  const all = uniqueOfficialSettlements(signals);
  const key = cohortKey(candidate);
  const same = all.filter((signal) => cohortKey(signal) === key);
  const recent = same.slice(-lookback);
  const losses = recent.filter((signal) => signal.status === "paper_loss").length;
  const trigger = recent.length >= lookback && losses >= lossTrigger;
  const latestCohort = recent.at(-1);
  const latestGlobalIndex = latestCohort
    ? all.findIndex((signal) => canonicalSettlementKey(signal) === canonicalSettlementKey(latestCohort))
    : -1;
  const settlementsSinceTrigger = latestGlobalIndex >= 0 ? all.length - latestGlobalIndex - 1 : null;
  const active = trigger && settlementsSinceTrigger <= ttlSettlements;
  return {
    enabled: true,
    active,
    reason: active ? "cohort_loss_2_of_3_lane_s_temporarily_downgraded" : "cohort_regime_clear",
    cohortKey: key,
    lookback,
    lossTrigger,
    ttlSettlements,
    observedSettlements: recent.length,
    wins: recent.length - losses,
    losses,
    settlementsSinceTrigger,
    laneCeiling: active ? "A" : "S",
    globalEntryFreeze: false,
    otherCohortsAffected: false,
  };
}

export { cohortKey, evaluateCohortRegimeGuard, uniqueOfficialSettlements };
