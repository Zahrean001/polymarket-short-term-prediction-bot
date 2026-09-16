import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { shouldTrainFromSettlement } from "../settlement/settlementPolicy.js";
import { atomicWriteJson, readJsonlDirectory } from "./observerPolicy.js";

const DIRECTION_SHADOW_POLICY_ID = "v3747-direction-only-forward-ensemble-shadow";
const DIRECTION_SHADOW_DECISION_SCHEMA = "v3747.direction-only-decision.1";
const DIRECTION_SHADOW_REPORT_SCHEMA = "v3747.direction-only-report.1";
const DIRECTION_SHADOW_STATE_SCHEMA = "v3747.direction-only-cursor.1";
const DEFAULT_RELEASE_VERSION = "v374.7-direction-only-shadow-fastgrow-full-paper";

function finite(value, fallback = Number.NaN) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
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

function oppositeDirection(direction) {
  return direction === "UP" ? "DOWN" : direction === "DOWN" ? "UP" : "UNKNOWN";
}

function recordKey(row = {}) {
  return String(row.id || row.slug || "").trim();
}

function digest(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function hashPayload(payload = {}, field = "hash") {
  const copy = { ...payload };
  delete copy[field];
  return digest(copy);
}

function priceBucket(value) {
  const price = finite(value);
  if (!Number.isFinite(price)) return "unknown";
  if (price < 0.50) return "below-0.50";
  if (price < 0.60) return "0.50-0.59";
  if (price < 0.70) return "0.60-0.69";
  if (price < 0.80) return "0.70-0.79";
  return "0.80-plus";
}

function secondsBucket(value) {
  const seconds = finite(value);
  if (!Number.isFinite(seconds)) return "unknown";
  if (seconds < 90) return "75-89";
  if (seconds < 120) return "90-119";
  if (seconds < 150) return "120-149";
  return "150-179";
}

function wilsonBound(wins, samples, side = "lower", z = 1.959963984540054) {
  if (!samples) return null;
  const p = wins / samples;
  const denominator = 1 + (z * z) / samples;
  const center = p + (z * z) / (2 * samples);
  const margin = z * Math.sqrt((p * (1 - p) / samples) + (z * z) / (4 * samples * samples));
  return clamp((center + (side === "upper" ? margin : -margin)) / denominator, 0, 1);
}

function officialWinningDirection(settlement = {}) {
  const official = normalizeDirection(settlement.officialOutcome);
  if (official !== "UNKNOWN") return official;
  const entered = normalizeDirection(settlement.direction || settlement.side);
  if (entered === "UNKNOWN") return "UNKNOWN";
  if (settlement.status === "paper_win") return entered;
  if (settlement.status === "paper_loss") return oppositeDirection(entered);
  return "UNKNOWN";
}

function isEligibleMainSignal(row = {}, options = {}) {
  const expectedReleaseVersion = options.releaseVersion || DEFAULT_RELEASE_VERSION;
  const executionStatus = String(row.executionStatus || "").toLowerCase();
  const stakeUsd = finite(row.filledStakeUsd ?? row.paperStakeUsd, 0);
  const entryMs = Date.parse(row.time || "");
  const windowEndMs = Date.parse(row.windowEnd || "");
  return row.botRole === "main_test" &&
    row.sourceType === "real_market" &&
    row.realParityEligible === true &&
    row.learningEligible !== false &&
    (executionStatus === "filled" || executionStatus === "partial_fill") &&
    stakeUsd > 0 &&
    row.status === "paper_open" &&
    normalizeDirection(row.direction || row.side) !== "UNKNOWN" &&
    Number.isFinite(entryMs) &&
    Number.isFinite(windowEndMs) &&
    entryMs < windowEndMs &&
    String(row.releaseVersion || "") === expectedReleaseVersion &&
    String(row.strategyVersion || "") === "v374.5-regime-core-fastgrow-paper";
}

function uniqueEligibleSignals(rows = [], options = {}) {
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isEligibleMainSignal(row, options)) continue;
    const key = recordKey(row);
    if (!key || unique.has(key)) continue;
    unique.set(key, row);
  }
  return [...unique.values()].sort((left, right) =>
    (Date.parse(left.time || "") || 0) - (Date.parse(right.time || "") || 0)
  );
}

function uniqueOfficialSettlements(rows = [], options = {}) {
  const expectedReleaseVersion = options.releaseVersion || DEFAULT_RELEASE_VERSION;
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!shouldTrainFromSettlement(row)) continue;
    if (row.botRole !== "main_test" || row.sourceType !== "real_market" || row.realParityEligible !== true) continue;
    if (String(row.releaseVersion || "") !== expectedReleaseVersion) continue;
    if (String(row.strategyVersion || "") !== "v374.5-regime-core-fastgrow-paper") continue;
    if (officialWinningDirection(row) === "UNKNOWN") continue;
    const key = recordKey(row);
    if (!key) continue;
    const previous = unique.get(key);
    const previousMs = Date.parse(previous?.settledAt || "") || 0;
    const nextMs = Date.parse(row.settledAt || "") || 0;
    if (!previous || nextMs >= previousMs) unique.set(key, row);
  }
  return [...unique.values()].sort((left, right) =>
    (Date.parse(left.settledAt || left.time || "") || 0) - (Date.parse(right.settledAt || right.time || "") || 0)
  );
}

function entrySnapshot(signal = {}) {
  const baselineDirection = normalizeDirection(signal.direction || signal.side);
  const embedded = signal.directionShadowEntrySnapshot || {};
  const selectedBestAsk = finite(signal.bestAskAtDecision ?? signal.buyPrice ?? signal.averageFillPrice);
  const averageFillPrice = finite(signal.averageFillPrice ?? signal.buyPrice);
  const askCost = finite(signal.yesNoAskCost);
  const reconstructedOppositeAsk = Number.isFinite(askCost) && Number.isFinite(selectedBestAsk)
    ? askCost - selectedBestAsk
    : Number.NaN;
  const upBestAsk = finite(embedded.upBestAsk, baselineDirection === "UP" ? selectedBestAsk : reconstructedOppositeAsk);
  const downBestAsk = finite(embedded.downBestAsk, baselineDirection === "DOWN" ? selectedBestAsk : reconstructedOppositeAsk);
  const upDepthShares = finite(embedded.upBestAskDepthShares, baselineDirection === "UP" ? signal.depthShares : Number.NaN);
  const downDepthShares = finite(embedded.downBestAskDepthShares, baselineDirection === "DOWN" ? signal.depthShares : Number.NaN);
  const pAssetUp = finite(signal.pAssetUp ?? signal.probabilityModelInputs?.probabilityUp ?? signal.probabilityUp);
  const pMarketUp = finite(signal.pMarketUp);
  const secondsIntoWindow = finite(signal.secondsIntoWindow);
  const entryPrice = baselineDirection === "UP" ? upBestAsk : downBestAsk;
  const oppositePrice = baselineDirection === "UP" ? downBestAsk : upBestAsk;
  const oppositeDepthShares = baselineDirection === "UP" ? downDepthShares : upDepthShares;
  const stakeUsd = finite(signal.filledStakeUsd ?? signal.paperStakeUsd, 0);
  const cohortKey = [
    String(signal.symbol || "UNKNOWN").toUpperCase(),
    baselineDirection,
    priceBucket(averageFillPrice),
    secondsBucket(secondsIntoWindow),
    String(signal.entryLane || signal.calibratedLane || "UNKNOWN").toUpperCase(),
  ].join("|");
  return {
    sourceSignalId: recordKey(signal),
    slug: String(signal.slug || ""),
    symbol: String(signal.symbol || "UNKNOWN").toUpperCase(),
    timeframe: String(signal.timeframe || "UNKNOWN").toUpperCase(),
    entryTime: signal.time,
    windowStart: signal.windowStart || null,
    windowEnd: signal.windowEnd,
    baselineDirection,
    baselineAverageFillPrice: round(averageFillPrice),
    baselineBestAsk: round(entryPrice),
    oppositeBestAsk: round(oppositePrice),
    upBestAsk: round(upBestAsk),
    downBestAsk: round(downBestAsk),
    upBestAskDepthShares: round(upDepthShares),
    downBestAskDepthShares: round(downDepthShares),
    oppositeBestAskDepthShares: round(oppositeDepthShares),
    dualSideSnapshotCaptured: embedded.schemaVersion === "v3747.direction-shadow-entry-snapshot.1" &&
      embedded.liveMarketData === true && embedded.syntheticDataUsed === false,
    liveBookSource: String(embedded.bookSource || signal.bookSource || "unknown"),
    liveBookAgeMs: round(embedded.bookAgeMs ?? signal.bookAgeMs),
    pAssetUp: round(pAssetUp, 12),
    pMarketUp: round(pMarketUp, 12),
    priceDelta: round(signal.priceDelta, 12),
    distanceBps: round(signal.distanceBps, 12),
    volatilityAdjustedDistance: round(signal.volatilityAdjustedDistance, 12),
    volatility60Bps: round(signal.volatility60Bps, 12),
    momentum15Bps: round(signal.momentum15Bps, 12),
    momentum30Bps: round(signal.momentum30Bps, 12),
    momentum60Bps: round(signal.momentum60Bps, 12),
    bookConfirmed: signal.bookConfirmed === true,
    bookConfirmationScore: round(signal.bookConfirmationScore, 12),
    secondsIntoWindow: round(secondsIntoWindow),
    entryLane: String(signal.entryLane || signal.calibratedLane || "UNKNOWN").toUpperCase(),
    correlationIndex: Math.max(0, Math.trunc(finite(signal.eligibilityEpisode?.correlation?.correlationIndex, 0))),
    stakeUsd: round(stakeUsd),
    accountEquityUsd: round(signal.accountEquity),
    takerFeeRate: round(signal.takerFeeRate, 12),
    cohortKey,
  };
}

function directionFromProbability(probability, threshold = 0.50) {
  if (!Number.isFinite(probability) || probability === threshold) return "UNKNOWN";
  return probability > threshold ? "UP" : "DOWN";
}

function directionFromSigned(value, deadZone = 0) {
  if (!Number.isFinite(value) || Math.abs(value) <= deadZone) return "UNKNOWN";
  return value > 0 ? "UP" : "DOWN";
}

function buildRawVotes(features = {}) {
  const votes = [{
    family: "baseline",
    direction: features.baselineDirection,
    weight: 2.75,
    strength: 1,
    reason: "frozen_main_direction_prior",
  }];
  const pAssetUp = finite(features.pAssetUp);
  if (Number.isFinite(pAssetUp) && Math.abs(pAssetUp - 0.5) >= 0.04) {
    votes.push({
      family: "asset_probability",
      direction: directionFromProbability(pAssetUp),
      weight: clamp(1.5 + Math.abs(pAssetUp - 0.5) * 6, 1.5, 4.5),
      strength: Math.abs(pAssetUp - 0.5) * 2,
      reason: "independent_chainlink_asset_probability",
    });
  }
  const priceDelta = finite(features.priceDelta);
  if (Number.isFinite(priceDelta) && priceDelta !== 0) {
    votes.push({
      family: "price_distance",
      direction: directionFromSigned(priceDelta),
      weight: clamp(2 + Math.abs(finite(features.volatilityAdjustedDistance, 0)) * 0.35, 2, 3.5),
      strength: clamp(Math.abs(finite(features.distanceBps, 0)) / 10, 0, 1),
      reason: "official_chainlink_price_vs_window_target",
    });
  }
  const momentumValues = [features.momentum15Bps, features.momentum30Bps, features.momentum60Bps]
    .map((value) => finite(value))
    .filter(Number.isFinite);
  const momentumDirections = momentumValues.map((value) => directionFromSigned(value, 0.03)).filter((value) => value !== "UNKNOWN");
  const momentumUp = momentumDirections.filter((value) => value === "UP").length;
  const momentumDown = momentumDirections.filter((value) => value === "DOWN").length;
  if (Math.max(momentumUp, momentumDown) >= 2 && momentumUp !== momentumDown) {
    const averageMagnitude = momentumValues.reduce((sum, value) => sum + Math.abs(value), 0) / Math.max(1, momentumValues.length);
    votes.push({
      family: "multi_horizon_momentum",
      direction: momentumUp > momentumDown ? "UP" : "DOWN",
      weight: clamp(1.5 + averageMagnitude * 0.25, 1.5, 2.5),
      strength: clamp(averageMagnitude / 3, 0, 1),
      reason: "two_of_three_momentum_consensus",
    });
  }
  const pMarketUp = finite(features.pMarketUp);
  if (Number.isFinite(pMarketUp) && Math.abs(pMarketUp - 0.5) >= 0.03) {
    votes.push({
      family: "live_market_odds",
      direction: directionFromProbability(pMarketUp),
      weight: clamp(1 + Math.abs(pMarketUp - 0.5) * 2, 1, 1.9),
      strength: Math.abs(pMarketUp - 0.5) * 2,
      reason: "live_dual_side_orderbook_odds",
    });
  }
  const bookScore = finite(features.bookConfirmationScore);
  if (features.bookConfirmed === true && Number.isFinite(bookScore) && bookScore >= 0.15) {
    votes.push({
      family: "book_confirmation",
      direction: features.baselineDirection,
      weight: clamp(0.5 + bookScore * 0.5, 0.5, 1),
      strength: clamp(bookScore, 0, 1),
      reason: "selected_side_book_confirmation",
    });
  }
  return votes;
}

function evidenceSummary(wins, samples) {
  return {
    samples,
    wins,
    losses: samples - wins,
    posteriorAccuracy: samples ? round((wins + 2) / (samples + 4), 8) : null,
    observedAccuracyPct: samples ? round((wins / samples) * 100, 6) : null,
    wilson95Lower: samples ? round(wilsonBound(wins, samples, "lower"), 8) : null,
    wilson95Upper: samples ? round(wilsonBound(wins, samples, "upper"), 8) : null,
  };
}

function buildPriorEvidence(decisions = [], settlements = [], cutoffMs = Date.now()) {
  const settlementById = new Map(settlements.map((row) => [recordKey(row), row]));
  const familyCounters = new Map();
  const cohortCounters = new Map();
  let eligiblePairs = 0;
  for (const decision of decisions) {
    if (decision.causalEligible !== true || decision.observerOnly !== true) continue;
    const entryMs = Date.parse(decision.features?.entryTime || "");
    const generatedAtMs = Date.parse(decision.generatedAt || "");
    const settlement = settlementById.get(decision.sourceSignalId);
    const settledAtMs = Date.parse(settlement?.settledAt || "");
    if (!Number.isFinite(entryMs) || entryMs >= cutoffMs) continue;
    if (!Number.isFinite(generatedAtMs) || !Number.isFinite(settledAtMs)) continue;
    if (settledAtMs >= cutoffMs || settledAtMs <= generatedAtMs) continue;
    const outcome = officialWinningDirection(settlement);
    if (outcome === "UNKNOWN") continue;
    eligiblePairs += 1;
    for (const vote of Array.isArray(decision.votes) ? decision.votes : []) {
      if (!vote.family || normalizeDirection(vote.direction) === "UNKNOWN") continue;
      const counter = familyCounters.get(vote.family) || { samples: 0, wins: 0 };
      counter.samples += 1;
      if (normalizeDirection(vote.direction) === outcome) counter.wins += 1;
      familyCounters.set(vote.family, counter);
    }
    const cohortKey = String(decision.features?.cohortKey || "unknown");
    const cohort = cohortCounters.get(cohortKey) || { samples: 0, wins: 0 };
    cohort.samples += 1;
    if (normalizeDirection(decision.baselineDirection) === outcome) cohort.wins += 1;
    cohortCounters.set(cohortKey, cohort);
  }
  const families = Object.fromEntries([...familyCounters.entries()].map(([key, value]) => [key, evidenceSummary(value.wins, value.samples)]));
  const cohorts = Object.fromEntries([...cohortCounters.entries()].map(([key, value]) => [key, evidenceSummary(value.wins, value.samples)]));
  const payload = { cutoff: new Date(cutoffMs).toISOString(), eligiblePairs, families, cohorts };
  return { ...payload, evidenceHash: digest(payload) };
}

function applyReliability(vote, evidence = {}) {
  const family = evidence.families?.[vote.family];
  const posterior = finite(family?.posteriorAccuracy);
  const scale = family?.samples >= 20 && Number.isFinite(posterior)
    ? clamp(0.50 + posterior, 0.75, 1.35)
    : 1;
  return {
    ...vote,
    rawWeight: round(vote.weight, 8),
    reliabilityScale: round(scale, 8),
    effectiveWeight: round(vote.weight * scale, 8),
    priorSamples: family?.samples || 0,
    priorPosteriorAccuracy: family?.posteriorAccuracy ?? null,
  };
}

function directionRiskFlags(features = {}) {
  const stakeUsd = finite(features.stakeUsd, 0);
  const equityUsd = finite(features.accountEquityUsd, 0);
  const stakeFraction = equityUsd > 0 ? stakeUsd / equityUsd : 0;
  const flags = [];
  if (features.entryLane === "S") flags.push("lane_s");
  if (finite(features.secondsIntoWindow, 0) >= 135) flags.push("late_135_179");
  if (finite(features.correlationIndex, 0) >= 1) flags.push("correlated_same_window");
  if (finite(features.bookConfirmationScore, 1) < 0.15) flags.push("weak_book_confirmation");
  if (stakeFraction >= 0.12) flags.push("stake_ge_12pct_equity");
  return { flags, stakeToEquityPct: equityUsd > 0 ? round(stakeFraction * 100, 6) : null };
}

function buildDirectionOnlyDecision(signal = {}, options = {}) {
  const now = Math.trunc(finite(options.now, Date.now()));
  const maximumObservationDelayMs = Math.max(1_000, Math.trunc(finite(options.maximumObservationDelayMs, 10_000)));
  const features = entrySnapshot(signal);
  const entryMs = Date.parse(features.entryTime || "");
  const windowEndMs = Date.parse(features.windowEnd || "");
  const observationDelayMs = Number.isFinite(entryMs) ? now - entryMs : Number.POSITIVE_INFINITY;
  const causalEligible = Number.isFinite(entryMs) && Number.isFinite(windowEndMs) &&
    now >= entryMs && now < windowEndMs && observationDelayMs <= maximumObservationDelayMs;
  const causalReason = causalEligible
    ? "forward_entry_snapshot_observed_before_window_end"
    : !Number.isFinite(entryMs) || !Number.isFinite(windowEndMs)
      ? "invalid_entry_timing"
      : now >= windowEndMs
        ? "late_backfill_after_window_end"
        : observationDelayMs > maximumObservationDelayMs
          ? "observer_delay_exceeded_forward_limit"
          : "observer_clock_precedes_entry";
  const priorEvidence = options.priorEvidence || { eligiblePairs: 0, families: {}, cohorts: {}, evidenceHash: null };
  const votes = buildRawVotes(features).map((vote) => applyReliability(vote, priorEvidence));
  const scores = { UP: 0, DOWN: 0 };
  for (const vote of votes) {
    const direction = normalizeDirection(vote.direction);
    if (direction !== "UNKNOWN") scores[direction] += finite(vote.effectiveWeight, 0);
  }
  const proposedDirection = scores.UP === scores.DOWN
    ? features.baselineDirection
    : scores.UP > scores.DOWN ? "UP" : "DOWN";
  const baselineDirection = features.baselineDirection;
  const alternateDirection = oppositeDirection(baselineDirection);
  const independentFamilies = new Set(["asset_probability", "price_distance", "multi_horizon_momentum", "live_market_odds"]);
  const alternateVotes = votes.filter((vote) => independentFamilies.has(vote.family) && vote.direction === alternateDirection);
  const alternateFamilies = new Set(alternateVotes.map((vote) => vote.family));
  const assetSupportsAlternate = alternateFamilies.has("asset_probability") && (
    alternateDirection === "UP" ? finite(features.pAssetUp, 0) >= 0.65 : finite(features.pAssetUp, 1) <= 0.35
  );
  const priceSupportsAlternate = alternateFamilies.has("price_distance");
  const scoreMargin = Math.abs(scores.UP - scores.DOWN);
  const consensusFlip = proposedDirection === alternateDirection &&
    alternateFamilies.size >= 3 && assetSupportsAlternate && priceSupportsAlternate && scoreMargin >= 2.5;
  const cohort = priorEvidence.cohorts?.[features.cohortKey];
  const provenCohortReversal = cohort?.samples >= 50 && finite(cohort.wilson95Upper, 1) < 0.50;

  let selectedDirection = baselineDirection;
  let selectionReason = "retain_frozen_direction_insufficient_independent_contradiction";
  if (consensusFlip) {
    selectedDirection = alternateDirection;
    selectionReason = "flip_independent_three_family_consensus";
  } else if (provenCohortReversal) {
    selectedDirection = alternateDirection;
    selectionReason = "flip_forward_cohort_baseline_failure_proven";
  } else if (proposedDirection === baselineDirection) {
    selectionReason = "retain_frozen_direction_ensemble_consensus";
  }

  const selectedPrice = selectedDirection === "UP" ? finite(features.upBestAsk) : finite(features.downBestAsk);
  const selectedDepthShares = selectedDirection === "UP"
    ? finite(features.upBestAskDepthShares)
    : finite(features.downBestAskDepthShares);
  const stakeUsd = finite(features.stakeUsd, 0);
  const topLevelNotionalUsd = Number.isFinite(selectedPrice) && Number.isFinite(selectedDepthShares)
    ? selectedPrice * selectedDepthShares
    : Number.NaN;
  const dualSideEconomicParity = features.dualSideSnapshotCaptured === true &&
    Number.isFinite(selectedPrice) && selectedPrice > 0 && selectedPrice < 1 &&
    Number.isFinite(topLevelNotionalUsd) && topLevelNotionalUsd + 1e-8 >= stakeUsd;
  const rulePriceParity = Number.isFinite(selectedPrice) && selectedPrice >= 0.50 && selectedPrice <= 0.85;
  const risk = directionRiskFlags(features);
  const generatedAt = new Date(now).toISOString();
  const payload = {
    schemaVersion: DIRECTION_SHADOW_DECISION_SCHEMA,
    policyId: DIRECTION_SHADOW_POLICY_ID,
    generatedAt,
    sourceSignalId: features.sourceSignalId,
    sourceSignalHash: digest(features),
    observerOnly: true,
    executionEligible: false,
    automaticPromotion: false,
    entryAction: "observe_only",
    mainMutation: {
      directionChanged: false,
      stakeChanged: false,
      entryBlocked: false,
      entryCountChanged: false,
      scanIntervalChanged: false,
    },
    causalEligible,
    causalReason,
    observationDelayMs: Number.isFinite(observationDelayMs) ? observationDelayMs : null,
    maximumObservationDelayMs,
    historicalEvidenceCutoff: features.entryTime,
    priorEvidence: {
      eligiblePairs: priorEvidence.eligiblePairs || 0,
      evidenceHash: priorEvidence.evidenceHash || null,
      cohort: cohort || null,
    },
    baselineDirection,
    selectedDirection,
    directionChanged: selectedDirection !== baselineDirection,
    selectionReason,
    scores: { UP: round(scores.UP, 8), DOWN: round(scores.DOWN, 8), margin: round(scoreMargin, 8) },
    votes,
    economicParity: {
      selectedBestAsk: round(selectedPrice),
      selectedBestAskDepthShares: round(selectedDepthShares),
      selectedTopLevelNotionalUsd: round(topLevelNotionalUsd),
      preservedStakeUsd: round(stakeUsd),
      dualSideSnapshotCaptured: features.dualSideSnapshotCaptured,
      topLevelFillParityEligible: dualSideEconomicParity,
      frozenRulePriceParity: rulePriceParity,
      exactExecutionPromotionEvidence: dualSideEconomicParity && rulePriceParity,
    },
    riskResearchOnly: {
      flags: risk.flags,
      stakeToEquityPct: risk.stakeToEquityPct,
      mayBlockOrResizeMain: false,
    },
    features,
    sourceContract: {
      entrySnapshotOnly: true,
      liveMarketSignalOnly: true,
      syntheticDataUsed: false,
      proxySettlementUsedAtDecision: false,
      currentOrFutureOutcomeReadAtDecision: false,
    },
  };
  payload.decisionHash = hashPayload(payload, "decisionHash");
  return payload;
}

function readDecisionDirectory(directory) {
  if (!directory || !fs.existsSync(directory)) return [];
  const rows = [];
  for (const name of fs.readdirSync(directory).filter((value) => value.endsWith(".json")).sort()) {
    const filePath = path.join(directory, name);
    let decision;
    try {
      decision = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new Error(`direction_shadow_decision_corruption:${filePath}:${error.message}`);
    }
    if (decision.schemaVersion !== DIRECTION_SHADOW_DECISION_SCHEMA) {
      throw new Error(`direction_shadow_decision_schema_mismatch:${filePath}`);
    }
    if (decision.decisionHash !== hashPayload(decision, "decisionHash")) {
      throw new Error(`direction_shadow_decision_hash_mismatch:${filePath}`);
    }
    rows.push(decision);
  }
  return rows;
}

function decisionFilePath(directory, signalId) {
  return path.join(directory, `${digest(String(signalId))}.json`);
}

function persistDecisionOnce(directory, decision) {
  const filePath = decisionFilePath(directory, decision.sourceSignalId);
  if (fs.existsSync(filePath)) {
    const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (existing.sourceSignalId !== decision.sourceSignalId || existing.decisionHash !== hashPayload(existing, "decisionHash")) {
      throw new Error(`direction_shadow_existing_decision_invalid:${filePath}`);
    }
    return { created: false, decision: existing, filePath };
  }
  atomicWriteJson(filePath, decision);
  return { created: true, decision, filePath };
}

function theoreticalPnl(stakeUsd, price, won, feeRate = 0.07) {
  const stake = finite(stakeUsd, 0);
  const executablePrice = finite(price);
  const rate = clamp(finite(feeRate, 0.07), 0, 0.25);
  if (!(stake > 0) || !(executablePrice > 0 && executablePrice < 1)) return null;
  const feeUsd = stake * rate * (1 - executablePrice);
  const pnlUsd = won
    ? stake * ((1 - executablePrice) / executablePrice) - feeUsd
    : -stake - feeUsd;
  return { stakeUsd: stake, price: executablePrice, feeUsd, pnlUsd };
}

function summarizeMetricRows(rows = [], startEquityUsd = 40) {
  const samples = rows.length;
  const wins = rows.filter((row) => row.won).length;
  const stakeUsd = rows.reduce((sum, row) => sum + finite(row.stakeUsd, 0), 0);
  const pnlUsd = rows.reduce((sum, row) => sum + finite(row.pnlUsd, 0), 0);
  const grossProfitUsd = rows.reduce((sum, row) => sum + Math.max(0, finite(row.pnlUsd, 0)), 0);
  const grossLossUsd = Math.abs(rows.reduce((sum, row) => sum + Math.min(0, finite(row.pnlUsd, 0)), 0));
  let equity = startEquityUsd;
  let peak = startEquityUsd;
  let maximumDrawdownPct = 0;
  for (const row of rows) {
    equity += finite(row.pnlUsd, 0);
    peak = Math.max(peak, equity);
    if (peak > 0) maximumDrawdownPct = Math.max(maximumDrawdownPct, ((peak - equity) / peak) * 100);
  }
  const rolling = rows.slice(-50);
  return {
    samples,
    wins,
    losses: samples - wins,
    winRate: samples ? round((wins / samples) * 100, 6) : 0,
    wilson95LowerPct: samples ? round(wilsonBound(wins, samples, "lower") * 100, 6) : null,
    rolling50Samples: rolling.length,
    rolling50WinRate: rolling.length ? round((rolling.filter((row) => row.won).length / rolling.length) * 100, 6) : 0,
    stakeUsd: round(stakeUsd),
    pnlUsd: round(pnlUsd),
    roiPct: stakeUsd > 0 ? round((pnlUsd / stakeUsd) * 100, 6) : 0,
    grossProfitUsd: round(grossProfitUsd),
    grossLossUsd: round(grossLossUsd),
    profitFactor: grossLossUsd > 0 ? round(grossProfitUsd / grossLossUsd, 6) : grossProfitUsd > 0 ? null : 0,
    startingEquityUsd: round(startEquityUsd),
    endingEquityUsd: round(equity),
    maxDrawdownPct: round(maximumDrawdownPct, 6),
  };
}

function completedEpochs(rows = [], size = 50) {
  const epochs = [];
  for (let offset = 0; offset + size <= rows.length; offset += size) {
    epochs.push({ index: epochs.length + 1, ...summarizeMetricRows(rows.slice(offset, offset + size), 0) });
  }
  return epochs;
}

function buildDirectionShadowReport(input = {}) {
  const now = Math.trunc(finite(input.now, Date.now()));
  const startEquityUsd = finite(input.startEquityUsd, 40);
  const signals = Array.isArray(input.signals) ? input.signals : [];
  const allDecisions = Array.isArray(input.decisions) ? input.decisions : [];
  const settlements = Array.isArray(input.settlements) ? input.settlements : [];
  const signalIds = new Set(signals.map(recordKey));
  const decisions = allDecisions.filter((row) => signalIds.has(row.sourceSignalId));
  const decisionById = new Map(decisions.map((row) => [row.sourceSignalId, row]));
  const settlementById = new Map(settlements.map((row) => [recordKey(row), row]));
  const forwardDecisions = decisions.filter((row) => row.causalEligible === true);
  const lateDecisions = decisions.filter((row) => row.causalEligible !== true);
  const paired = [];
  for (const signal of signals) {
    const id = recordKey(signal);
    const decision = decisionById.get(id);
    const settlement = settlementById.get(id);
    if (!decision || decision.causalEligible !== true || !settlement) continue;
    const settledAtMs = Date.parse(settlement.settledAt || "");
    const generatedAtMs = Date.parse(decision.generatedAt || "");
    if (!Number.isFinite(settledAtMs) || !Number.isFinite(generatedAtMs) || settledAtMs <= generatedAtMs) continue;
    const outcome = officialWinningDirection(settlement);
    if (outcome === "UNKNOWN") continue;
    const baselineDirection = normalizeDirection(decision.baselineDirection);
    const selectedDirection = normalizeDirection(decision.selectedDirection);
    const baselineWon = baselineDirection === outcome;
    const challengerWon = selectedDirection === outcome;
    const baselineStakeUsd = finite(settlement.filledStakeUsd ?? settlement.paperStakeUsd, 0);
    const baselinePnlUsd = finite(settlement.paperPnlUsd, 0);
    const baselinePrice = finite(settlement.averageFillPrice ?? settlement.buyPrice);
    const selectedPrice = selectedDirection === "UP"
      ? finite(decision.features?.upBestAsk)
      : finite(decision.features?.downBestAsk);
    const theoretical = theoreticalPnl(baselineStakeUsd, selectedPrice, challengerWon, settlement.takerFeeRate);
    const unchanged = selectedDirection === baselineDirection;
    const parity = unchanged || decision.economicParity?.exactExecutionPromotionEvidence === true;
    paired.push({
      settledAtMs,
      signalId: id,
      decision,
      settlement,
      outcome,
      baseline: { won: baselineWon, stakeUsd: baselineStakeUsd, pnlUsd: baselinePnlUsd, price: baselinePrice },
      challenger: {
        won: challengerWon,
        stakeUsd: baselineStakeUsd,
        pnlUsd: unchanged ? baselinePnlUsd : theoretical?.pnlUsd ?? 0,
        price: unchanged ? baselinePrice : theoretical?.price ?? null,
        theoretical: !unchanged,
        exactExecutionParity: parity,
      },
    });
  }
  paired.sort((left, right) => left.settledAtMs - right.settledAtMs);
  const baselineRows = paired.map((row) => row.baseline);
  const challengerRows = paired.map((row) => row.challenger);
  const baseline = summarizeMetricRows(baselineRows, startEquityUsd);
  const challenger = summarizeMetricRows(challengerRows, startEquityUsd);
  const epochs = completedEpochs(challengerRows, 50);
  const directionChanges = paired.filter((row) => row.decision.directionChanged).length;
  const paritySamples = paired.filter((row) => row.challenger.exactExecutionParity).length;
  const eligibleOfficialForSignals = signals.filter((row) => settlementById.has(recordKey(row))).length;
  const coveragePct = signals.length ? (forwardDecisions.length / signals.length) * 100 : 0;
  const settledCoveragePct = eligibleOfficialForSignals ? (paired.length / eligibleOfficialForSignals) * 100 : 0;
  const executionParityCoveragePct = paired.length ? (paritySamples / paired.length) * 100 : 0;
  const profitableEpochs = epochs.filter((row) => finite(row.pnlUsd, 0) > 0).length;
  const failedChecks = [];
  const check = (condition, name) => { if (!condition) failedChecks.push(name); };
  check(challenger.samples >= 200, "forward_official_samples_below_200");
  check(coveragePct >= 99.5, "forward_decision_coverage_below_99_5pct");
  check(settledCoveragePct >= 99.5, "official_settlement_match_coverage_below_99_5pct");
  check(challenger.winRate >= 90, "challenger_win_rate_below_90pct");
  check(finite(challenger.wilson95LowerPct, 0) >= 85, "challenger_wilson95_lower_below_85pct");
  check(challenger.rolling50Samples >= 50 && challenger.rolling50WinRate >= 90, "challenger_rolling50_below_90pct");
  check(challenger.pnlUsd > 0, "challenger_pnl_not_positive");
  check(challenger.profitFactor === null || finite(challenger.profitFactor, 0) >= 2, "challenger_profit_factor_below_2");
  check(challenger.maxDrawdownPct <= 25, "challenger_drawdown_above_25pct");
  check(challenger.maxDrawdownPct <= baseline.maxDrawdownPct + 1e-9, "challenger_drawdown_worse_than_control");
  check(challenger.pnlUsd + 1e-9 >= baseline.pnlUsd, "challenger_pnl_below_control");
  check(directionChanges >= 10, "direction_changes_below_10");
  check(challenger.winRate >= baseline.winRate + 2, "accuracy_lift_below_2pp");
  check(executionParityCoveragePct >= 99.5, "exact_execution_parity_coverage_below_99_5pct");
  check(epochs.length >= 3 && profitableEpochs >= 3, "three_profitable_50_trade_epochs_unavailable");
  check(epochs.every((row) => row.winRate >= 80), "completed_epoch_win_rate_below_80pct");

  const riskGroups = new Map();
  for (const row of paired) {
    const flags = row.decision.riskResearchOnly?.flags?.length ? row.decision.riskResearchOnly.flags : ["no_flag"];
    for (const flag of flags) {
      const values = riskGroups.get(flag) || [];
      values.push(row.baseline);
      riskGroups.set(flag, values);
    }
  }
  const riskResearch = Object.fromEntries([...riskGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => [key, summarizeMetricRows(rows, 0)]));
  const generatedAt = new Date(now).toISOString();
  const report = {
    schemaVersion: DIRECTION_SHADOW_REPORT_SCHEMA,
    policyId: DIRECTION_SHADOW_POLICY_ID,
    generatedAt,
    observerOnly: true,
    executionEligible: false,
    automaticPromotion: false,
    source: {
      signalData: "main_real_market_filled_entry_snapshot_only",
      outcomeData: "official_polymarket_final_settlement_only",
      syntheticDataUsed: false,
      proxySettlementUsed: false,
      futureOutcomeUsedAtDecision: false,
      retrospectiveDecisionsCountedAsForward: false,
    },
    isolation: {
      mainBehaviorPolicyId: "v3745-frozen-control",
      mainDirectionMutations: 0,
      mainStakeMutations: 0,
      mainEntryBlocks: 0,
      mainEntryCountChanges: 0,
      mainScanSlowdowns: 0,
    },
    counts: {
      eligibleMainSignals: signals.length,
      immutableDecisions: decisions.length,
      forwardCausalDecisions: forwardDecisions.length,
      lateBackfillDecisionsExcluded: lateDecisions.length,
      eligibleOfficialSettlements: eligibleOfficialForSignals,
      forwardOfficialMatches: paired.length,
      directionChanges,
      exactExecutionParityMatches: paritySamples,
    },
    coverage: {
      forwardDecisionPct: round(coveragePct, 6),
      officialSettlementMatchPct: round(settledCoveragePct, 6),
      exactExecutionParityPct: round(executionParityCoveragePct, 6),
    },
    control: baseline,
    challenger: {
      ...challenger,
      metricType: directionChanges ? "actual_when_unchanged_counterfactual_when_flipped" : "actual_execution_identical_to_control",
      directionChanges,
      accuracyLiftPp: round(challenger.winRate - baseline.winRate, 6),
      pnlDeltaUsd: round(challenger.pnlUsd - baseline.pnlUsd),
      drawdownDeltaPct: round(challenger.maxDrawdownPct - baseline.maxDrawdownPct, 6),
    },
    completedEpochs: epochs,
    riskResearchOnly: riskResearch,
    promotion: {
      evidenceGatePassed: failedChecks.length === 0,
      eligibleForManualReview: failedChecks.length === 0,
      promotionEligible: false,
      executionEligible: false,
      automaticPromotion: false,
      failedChecks,
      note: "Passing evidence creates a manual review candidate only; this package can never promote or execute the challenger.",
    },
  };
  report.reportHash = hashPayload(report, "reportHash");
  return report;
}

function createDirectionOnlyShadowObserver(options = {}) {
  const signalDirectory = path.resolve(options.signalDirectory || "server/data-main-v3747/signals");
  const settlementDirectory = path.resolve(options.settlementDirectory || "server/data-main-v3747/settlements");
  const decisionDirectory = path.resolve(options.decisionDirectory || "server/data-observer-v3747/research/direction-only-decisions");
  const statePath = path.resolve(options.statePath || "server/data-observer-v3747/observer/direction-only-cursor-v3747.json");
  const reportPath = path.resolve(options.reportPath || "server/data-observer-v3747/reports/direction-only-shadow-latest.json");
  const releaseVersion = options.releaseVersion || DEFAULT_RELEASE_VERSION;
  const maximumObservationDelayMs = Math.max(1_000, Math.trunc(finite(options.maximumObservationDelayMs, 10_000)));
  const startEquityUsd = finite(options.startEquityUsd, 40);
  let lastStatus = { status: "not_run", observerOnly: true, executionEligible: false, reportPath };

  function runOnce(now = Date.now()) {
    const signalRead = readJsonlDirectory(signalDirectory);
    const settlementRead = readJsonlDirectory(settlementDirectory);
    const signals = uniqueEligibleSignals(signalRead.rows, { releaseVersion });
    const settlements = uniqueOfficialSettlements(settlementRead.rows, { releaseVersion });
    let decisions = readDecisionDirectory(decisionDirectory);
    const known = new Set(decisions.map((row) => row.sourceSignalId));
    let newDecisions = 0;
    for (const signal of signals) {
      const signalId = recordKey(signal);
      if (known.has(signalId)) continue;
      const cutoffMs = Date.parse(signal.time || "");
      const priorEvidence = buildPriorEvidence(decisions, settlements, cutoffMs);
      const decision = buildDirectionOnlyDecision(signal, { now, maximumObservationDelayMs, priorEvidence });
      const persisted = persistDecisionOnce(decisionDirectory, decision);
      if (persisted.created) newDecisions += 1;
      decisions.push(persisted.decision);
      known.add(signalId);
    }
    decisions = readDecisionDirectory(decisionDirectory);
    const report = buildDirectionShadowReport({ now, signals, decisions, settlements, startEquityUsd });
    atomicWriteJson(reportPath, report);
    const signalIds = signals.map(recordKey);
    const decisionIds = decisions.map((row) => row.sourceSignalId).sort();
    atomicWriteJson(statePath, {
      schemaVersion: DIRECTION_SHADOW_STATE_SCHEMA,
      updatedAt: new Date(now).toISOString(),
      observerOnly: true,
      executionEligible: false,
      automaticPromotion: false,
      releaseVersion,
      eligibleSignalIdsHash: digest(signalIds.join("\n")),
      decisionIdsHash: digest(decisionIds.join("\n")),
      eligibleSignalCount: signals.length,
      immutableDecisionCount: decisions.length,
      newDecisions,
      forwardCausalDecisionCount: report.counts.forwardCausalDecisions,
      forwardOfficialMatches: report.counts.forwardOfficialMatches,
      signalFiles: signalRead.files,
      settlementFiles: settlementRead.files,
      truncatedSignalLinesIgnored: signalRead.truncatedLinesIgnored,
      truncatedSettlementLinesIgnored: settlementRead.truncatedLinesIgnored,
      reportHash: report.reportHash,
    });
    lastStatus = {
      status: "ready",
      generatedAt: report.generatedAt,
      observerOnly: true,
      executionEligible: false,
      automaticPromotion: false,
      eligibleSignalCount: signals.length,
      immutableDecisionCount: decisions.length,
      newDecisions,
      forwardCausalDecisionCount: report.counts.forwardCausalDecisions,
      forwardOfficialMatches: report.counts.forwardOfficialMatches,
      directionChanges: report.counts.directionChanges,
      challengerWinRate: report.challenger.winRate,
      evidenceGatePassed: report.promotion.evidenceGatePassed,
      reportPath,
      statePath,
      decisionDirectory,
    };
    return { report, status: lastStatus };
  }

  return {
    runOnce,
    status() { return { ...lastStatus }; },
    signalDirectory,
    settlementDirectory,
    decisionDirectory,
    statePath,
    reportPath,
  };
}

export {
  DEFAULT_RELEASE_VERSION,
  DIRECTION_SHADOW_DECISION_SCHEMA,
  DIRECTION_SHADOW_POLICY_ID,
  DIRECTION_SHADOW_REPORT_SCHEMA,
  buildDirectionOnlyDecision,
  buildDirectionShadowReport,
  buildPriorEvidence,
  createDirectionOnlyShadowObserver,
  entrySnapshot,
  isEligibleMainSignal,
  officialWinningDirection,
  readDecisionDirectory,
  theoreticalPnl,
  uniqueEligibleSignals,
  uniqueOfficialSettlements,
};
