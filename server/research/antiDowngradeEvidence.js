import { shouldTrainFromSettlement } from "../settlement/settlementPolicy.js";

const ANTI_DOWNGRADE_EVIDENCE_SCHEMA = "v3746.anti-downgrade-evidence.1";

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round(value, digits = 8) {
  if (!Number.isFinite(Number(value))) return null;
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function normalizeDirection(value) {
  const direction = String(value || "").trim().toUpperCase();
  return direction === "UP" || direction === "DOWN" ? direction : "UNKNOWN";
}

function priceBucket(row = {}) {
  const price = finite(row.averageFillPrice ?? row.buyPrice ?? row.selectedBuyPrice ?? row.entryPrice, Number.NaN);
  if (!Number.isFinite(price)) return "unknown";
  if (price < 0.60) return "0.50-0.59";
  if (price < 0.70) return "0.60-0.69";
  if (price < 0.80) return "0.70-0.79";
  return "0.80-plus";
}

function rowKey(row = {}) {
  return String(row.id || row.slug || "").trim();
}

function cohortKey(row = {}) {
  return [
    String(row.symbol || "UNKNOWN").trim().toUpperCase(),
    normalizeDirection(row.direction || row.side || row.predictedOutcome),
    priceBucket(row),
  ].join("|");
}

function entryTimeMs(row = {}) {
  const parsed = Date.parse(row.time || row.entryTime || row.createdAt || "");
  if (Number.isFinite(parsed)) return parsed;
  const settled = settlementTimeMs(row);
  return Number.isFinite(settled) ? settled - 300_000 : 0;
}

function settlementTimeMs(row = {}) {
  const parsed = Date.parse(row.settledAt || row.settlementTime || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function isEvidenceEligible(row = {}) {
  const version = String(row.strategyVersion || row.releaseVersion || "");
  return shouldTrainFromSettlement(row) &&
    row.botRole === "main_test" &&
    String(row.sourceType || "").toLowerCase() === "real_market" &&
    row.realParityEligible === true &&
    (version.includes("374.5") || version.includes("374.6"));
}

function uniqueEvidenceRows(rows = []) {
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isEvidenceEligible(row)) continue;
    const key = rowKey(row);
    if (!key) continue;
    const previous = unique.get(key);
    if (!previous || settlementTimeMs(row) >= settlementTimeMs(previous)) unique.set(key, row);
  }
  return [...unique.values()].sort((left, right) => settlementTimeMs(left) - settlementTimeMs(right));
}

function wilsonLower(wins, total, z = 1.959963984540054) {
  if (!total) return null;
  const p = wins / total;
  const denominator = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) / total) + (z * z) / (4 * total * total));
  return Math.max(0, (center - margin) / denominator);
}

function summarizeReplay(rows = [], startEquityUsd = 40) {
  const chronological = [...rows].sort((left, right) => finite(left.settledAtMs) - finite(right.settledAtMs));
  const samples = chronological.length;
  const wins = chronological.filter((row) => row.won === true).length;
  const pnlUsd = chronological.reduce((sum, row) => sum + finite(row.pnlUsd), 0);
  const stakeUsd = chronological.reduce((sum, row) => sum + finite(row.stakeUsd), 0);
  const grossProfitUsd = chronological.reduce((sum, row) => sum + Math.max(0, finite(row.pnlUsd)), 0);
  const grossLossUsd = Math.abs(chronological.reduce((sum, row) => sum + Math.min(0, finite(row.pnlUsd)), 0));
  let equity = Math.max(0.01, finite(startEquityUsd, 40));
  let peak = equity;
  let maxDrawdownPct = 0;
  for (const row of chronological) {
    equity += finite(row.pnlUsd);
    peak = Math.max(peak, equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
  }
  const rolling = chronological.slice(-50);
  const rollingWins = rolling.filter((row) => row.won === true).length;
  return {
    samples,
    wins,
    losses: samples - wins,
    winRate: samples ? round((wins / samples) * 100, 6) : 0,
    wilson95LowerPct: samples ? round(wilsonLower(wins, samples) * 100, 6) : null,
    rolling50Samples: rolling.length,
    rolling50WinRate: rolling.length ? round((rollingWins / rolling.length) * 100, 6) : 0,
    stakeUsd: round(stakeUsd, 8),
    pnlUsd: round(pnlUsd, 8),
    roiPct: stakeUsd > 0 ? round((pnlUsd / stakeUsd) * 100, 6) : 0,
    grossProfitUsd: round(grossProfitUsd, 8),
    grossLossUsd: round(grossLossUsd, 8),
    profitFactor: grossLossUsd > 0 ? round(grossProfitUsd / grossLossUsd, 6) : null,
    endingEquityUsd: round(equity, 8),
    maxDrawdownPct: round(maxDrawdownPct, 6),
  };
}

function actualMarketMinimumStake(row = {}) {
  const source = row.actualMarketMinimumStake || {};
  return Math.max(0, finite(
    source.actualMinimumStakeUsd ??
    source.minimumStakeUsd ??
    source.requiredStakeUsd ??
    source.minimumOrderStakeUsd,
    0,
  ));
}

function appendHistory(map, key, row, maximum = 3) {
  const history = map.get(key) || [];
  history.push(row);
  if (history.length > maximum) history.splice(0, history.length - maximum);
  map.set(key, history);
}

function lossTrigger(history = []) {
  return history.length >= 2 && history.filter((row) => row.status === "paper_loss").length >= 2;
}

function isLaneS(row = {}) {
  return [row.entryLane, row.calibratedLane, row.fastGrowEvPolicy?.lane, row.fastGrowSizing?.lane]
    .some((value) => String(value || "").trim().toUpperCase() === "S");
}

function buildEpochChecks(baselineRows, candidateRows, epochSize = 50) {
  const candidateById = new Map(candidateRows.map((row) => [row.id, row]));
  const epochs = [];
  for (let offset = 0; offset < baselineRows.length; offset += epochSize) {
    const baselineEpoch = baselineRows.slice(offset, offset + epochSize);
    const candidateEpoch = baselineEpoch.map((row) => candidateById.get(row.id)).filter(Boolean);
    const baseline = summarizeReplay(baselineEpoch.map((row) => ({
      id: row.id,
      won: row.status === "paper_win",
      pnlUsd: finite(row.paperPnlUsd),
      stakeUsd: finite(row.filledStakeUsd ?? row.paperStakeUsd),
      settledAtMs: settlementTimeMs(row),
    })));
    const challenger = summarizeReplay(candidateEpoch);
    epochs.push({
      index: epochs.length + 1,
      baselineSamples: baselineEpoch.length,
      challengerSamples: candidateEpoch.length,
      coveragePct: baselineEpoch.length ? round((candidateEpoch.length / baselineEpoch.length) * 100, 6) : 0,
      baseline,
      challenger,
    });
  }
  return epochs;
}

function buildAntiDowngradeEvidence(rows = [], options = {}) {
  const startEquityUsd = Math.max(3, finite(options.startEquityUsd, 40));
  const official = uniqueEvidenceRows(rows);
  const byEntry = [...official].sort((left, right) => entryTimeMs(left) - entryTimeMs(right));
  const bySettlement = [...official].sort((left, right) => settlementTimeMs(left) - settlementTimeMs(right));
  const directionHistory = new Map();
  const cohortHistory = new Map();
  const candidateRows = [];
  const decisions = [];
  const counters = {
    directionLossTrigger: 0,
    exactCohortLossTrigger: 0,
    laneSCappedToLaneA: 0,
    correlatedReserveCapped: 0,
    highPriceWeakBookRejected: 0,
    belowActualMarketMinimumRejected: 0,
  };
  let settlementCursor = 0;
  let avoidedLossUsd = 0;
  let foregoneProfitUsd = 0;

  for (const row of byEntry) {
    const enteredAtMs = entryTimeMs(row);
    while (settlementCursor < bySettlement.length && settlementTimeMs(bySettlement[settlementCursor]) <= enteredAtMs) {
      const settled = bySettlement[settlementCursor];
      appendHistory(directionHistory, normalizeDirection(settled.direction || settled.side), settled);
      appendHistory(cohortHistory, cohortKey(settled), settled);
      settlementCursor += 1;
    }

    const id = rowKey(row);
    const baselineStakeUsd = Math.max(0, finite(row.filledStakeUsd ?? row.paperStakeUsd));
    const baselinePnlUsd = finite(row.paperPnlUsd);
    const equityAtEntryUsd = Math.max(0.01, finite(row.accountEquity, startEquityUsd));
    const direction = normalizeDirection(row.direction || row.side);
    const directionTriggered = lossTrigger(directionHistory.get(direction));
    const cohortTriggered = lossTrigger(cohortHistory.get(cohortKey(row)));
    if (directionTriggered) counters.directionLossTrigger += 1;
    if (cohortTriggered) counters.exactCohortLossTrigger += 1;

    let candidateStakeUsd = baselineStakeUsd;
    const reasons = [];
    if (isLaneS(row) && (directionTriggered || cohortTriggered)) {
      const laneACapUsd = equityAtEntryUsd * 0.10;
      if (candidateStakeUsd > laneACapUsd) {
        candidateStakeUsd = laneACapUsd;
        counters.laneSCappedToLaneA += 1;
        reasons.push("two_losses_latest_three_lane_s_capped_to_lane_a");
      }
    }

    const correlation = row.eligibilityEpisode?.correlation || {};
    if (finite(correlation.correlationIndex, 0) > 0) {
      const correlatedOpenReservedUsd = Math.max(0, finite(
        correlation.correlatedOpenReservedUsd,
        finite(row.paperOpenReservedBeforeEntryUsd, 0),
      ));
      const correlationAvailableUsd = Math.max(0, equityAtEntryUsd * 0.20 - correlatedOpenReservedUsd);
      if (candidateStakeUsd > correlationAvailableUsd) {
        candidateStakeUsd = correlationAvailableUsd;
        counters.correlatedReserveCapped += 1;
        reasons.push("same_window_same_direction_reserve_capped_at_20pct_equity");
      }
    }

    const price = finite(row.averageFillPrice ?? row.buyPrice, Number.NaN);
    const bookScore = finite(row.bookConfirmationScore, Number.NaN);
    const legacyNetEdge = finite(
      row.legacyCalibrationTelemetry?.netEdge ?? row.calibratedNetEdge ?? row.calibratedNetEv?.netEdge,
      Number.NaN,
    );
    if (price >= 0.80 && Number.isFinite(bookScore) && bookScore < 0.10 && Number.isFinite(legacyNetEdge) && legacyNetEdge <= 0) {
      candidateStakeUsd = 0;
      counters.highPriceWeakBookRejected += 1;
      reasons.push("high_price_weak_book_negative_legacy_edge_shadow_veto");
    }

    const minimumStakeUsd = actualMarketMinimumStake(row);
    if (candidateStakeUsd > 0 && minimumStakeUsd > 0 && candidateStakeUsd + 1e-9 < minimumStakeUsd) {
      candidateStakeUsd = 0;
      counters.belowActualMarketMinimumRejected += 1;
      reasons.push("shadow_stake_below_actual_market_minimum");
    }

    candidateStakeUsd = Math.max(0, Math.min(baselineStakeUsd, candidateStakeUsd));
    const accepted = candidateStakeUsd > 0 && baselineStakeUsd > 0;
    const scale = accepted ? candidateStakeUsd / baselineStakeUsd : 0;
    const candidatePnlUsd = baselinePnlUsd * scale;
    if (baselinePnlUsd < 0) avoidedLossUsd += Math.abs(baselinePnlUsd - candidatePnlUsd);
    if (baselinePnlUsd > 0) foregoneProfitUsd += Math.max(0, baselinePnlUsd - candidatePnlUsd);
    if (accepted) {
      candidateRows.push({
        id,
        won: row.status === "paper_win",
        pnlUsd: candidatePnlUsd,
        stakeUsd: candidateStakeUsd,
        settledAtMs: settlementTimeMs(row),
      });
    }
    decisions.push({
      id,
      accepted,
      baselineStakeUsd: round(baselineStakeUsd, 8),
      challengerStakeUsd: round(candidateStakeUsd, 8),
      stakeScale: round(scale, 8),
      reasons,
    });
  }

  const baselineRows = official.map((row) => ({
    id: rowKey(row),
    won: row.status === "paper_win",
    pnlUsd: finite(row.paperPnlUsd),
    stakeUsd: finite(row.filledStakeUsd ?? row.paperStakeUsd),
    settledAtMs: settlementTimeMs(row),
  }));
  const baseline = summarizeReplay(baselineRows, startEquityUsd);
  const challenger = summarizeReplay(candidateRows, startEquityUsd);
  const coveragePct = baseline.samples ? (challenger.samples / baseline.samples) * 100 : 0;
  const epochs = buildEpochChecks(official, candidateRows, 50);
  const completedEpochs = epochs.filter((epoch) => epoch.baselineSamples === 50);
  const profitableEpochs = completedEpochs.filter((epoch) => epoch.challenger.pnlUsd > 0).length;
  const noCompletedEpochBelow70 = completedEpochs.every((epoch) => epoch.challenger.winRate >= 70);
  const thresholds = {
    baselineSamplesAtLeast: 200,
    challengerCoveragePctAtLeast: 90,
    challengerWinRateAtLeast: 80,
    challengerWilson95LowerPctAtLeast: 70,
    challengerRolling50WinRateAtLeast: 78,
    challengerRoiPctAbove: 0,
    challengerProfitFactorAtLeast: 1.30,
    challengerMaxDrawdownPctAtMost: 30,
    challengerPnlNotBelowBaseline: true,
    challengerDrawdownNotAboveBaseline: true,
    completedProfitableEpochsAtLeast: 3,
    noCompletedEpochBelow70: true,
  };
  const checks = {
    baselineSamples: baseline.samples >= thresholds.baselineSamplesAtLeast,
    coverage: coveragePct >= thresholds.challengerCoveragePctAtLeast,
    winRate: challenger.winRate >= thresholds.challengerWinRateAtLeast,
    wilsonLower: finite(challenger.wilson95LowerPct, 0) >= thresholds.challengerWilson95LowerPctAtLeast,
    rolling50: challenger.rolling50Samples >= 50 && challenger.rolling50WinRate >= thresholds.challengerRolling50WinRateAtLeast,
    positiveRoi: challenger.roiPct > thresholds.challengerRoiPctAbove,
    profitFactor: finite(challenger.profitFactor, 0) >= thresholds.challengerProfitFactorAtLeast,
    maxDrawdown: challenger.maxDrawdownPct <= thresholds.challengerMaxDrawdownPctAtMost,
    pnlNoDowngrade: challenger.pnlUsd + 1e-8 >= baseline.pnlUsd,
    drawdownNoDowngrade: challenger.maxDrawdownPct <= baseline.maxDrawdownPct + 1e-8,
    profitableEpochs: profitableEpochs >= thresholds.completedProfitableEpochsAtLeast,
    epochWinRateFloor: completedEpochs.length >= 3 && noCompletedEpochBelow70,
  };
  const promotionEligible = Object.values(checks).every(Boolean);

  return {
    schemaVersion: ANTI_DOWNGRADE_EVIDENCE_SCHEMA,
    observerOnly: true,
    executionEligible: false,
    automaticPromotion: false,
    analysisMode: "official_settlement_causal_replay_no_execution",
    source: {
      officialRealFilledUniqueOnly: true,
      syntheticDataUsed: false,
      proxySettlementUsed: false,
      sameRunRetrospectiveIsForwardProof: false,
    },
    controlPolicyId: "v3745-frozen-control",
    challengerPolicyId: "v3746-correlation-direction-high-price-shadow",
    startEquityUsd,
    baseline,
    challenger,
    paired: {
      baselineSamples: baseline.samples,
      challengerSamples: challenger.samples,
      coveragePct: round(coveragePct, 6),
      avoidedLossUsd: round(avoidedLossUsd, 8),
      foregoneProfitUsd: round(foregoneProfitUsd, 8),
      netPnlDeltaUsd: round(challenger.pnlUsd - baseline.pnlUsd, 8),
      maxDrawdownDeltaPct: round(challenger.maxDrawdownPct - baseline.maxDrawdownPct, 6),
    },
    counters,
    epochs,
    thresholds,
    checks,
    promotionEligible,
    promotionStatus: promotionEligible ? "forward_thresholds_met_manual_review_required" : "shadow_evidence_insufficient_or_no_downgrade_failed",
    decisionDigest: decisions.slice(-200),
  };
}

export {
  ANTI_DOWNGRADE_EVIDENCE_SCHEMA,
  buildAntiDowngradeEvidence,
  isEvidenceEligible,
  summarizeReplay,
  uniqueEvidenceRows,
};
