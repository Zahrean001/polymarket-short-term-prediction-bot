const DEFAULT_ELIGIBILITY_EPISODE_CONFIG = Object.freeze({
  minAssetNetEdge: 0.05,
  strongAssetNetEdge: 0.075,
  nearRequiredSnapshots: 3,
  strongRequiredSnapshots: 2,
  requiredChainlinkEvents: 2,
  nearRequiredDurationMs: 400,
  strongRequiredDurationMs: 150,
  maxObservationGapMs: 2_000,
  maxChainlinkAgeMs: 2_000,
  maxBookAgeMs: 1_500,
  maxSamples: 12,
  maxEntries: 512,
  ttlMs: 10 * 60_000,
  correlationSnapshotIncrement: 1,
  correlationDurationIncrementMs: 200,
  correlationCurrentEdgeIncrement: 0.010,
  correlationMedianEdgeIncrement: 0.0075,
  correlationLowerEdgeIncrement: 0.005,
});

function finite(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSide(value) {
  const side = String(value || "").trim().toUpperCase();
  if (side === "UP" || side === "YES") return "UP";
  if (side === "DOWN" || side === "NO") return "DOWN";
  return "UNKNOWN";
}

function median(values = []) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return Number.NaN;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(values = [], probability = 0.25) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return Number.NaN;
  if (sorted.length === 1) return sorted[0];
  const position = clamp(probability, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function edgeDistribution(samples = []) {
  const edges = samples.map((sample) => finite(sample.assetNetEdge)).filter(Number.isFinite);
  const medianAssetNetEdge = median(edges);
  const deviations = edges.map((edge) => Math.abs(edge - medianAssetNetEdge));
  const madAssetNetEdge = median(deviations);
  const q25AssetNetEdge = quantile(edges, 0.25);
  const robustLowerAssetNetEdge = Math.min(
    q25AssetNetEdge,
    medianAssetNetEdge - 1.4826 * madAssetNetEdge,
  );
  return {
    medianAssetNetEdge,
    madAssetNetEdge,
    q25AssetNetEdge,
    robustLowerAssetNetEdge,
    minAssetNetEdge: edges.length ? Math.min(...edges) : Number.NaN,
    maxAssetNetEdge: edges.length ? Math.max(...edges) : Number.NaN,
    medianEdge: medianAssetNetEdge,
    madEdge: madAssetNetEdge,
    q25Edge: q25AssetNetEdge,
    robustLowerEdge: robustLowerAssetNetEdge,
    minEdge: edges.length ? Math.min(...edges) : Number.NaN,
    maxEdge: edges.length ? Math.max(...edges) : Number.NaN,
  };
}

function buildEligibilityEpisodeKey({ sessionGeneration = 0, slug = "", side = "" } = {}) {
  const normalizedSlug = String(slug || "").trim();
  const normalizedSide = normalizeSide(side);
  if (!normalizedSlug || normalizedSide === "UNKNOWN") return "";
  return `${Math.max(0, Math.trunc(finite(sessionGeneration, 0)))}|${normalizedSlug}|${normalizedSide}`;
}

function buildBookEconomicGeneration(book = {}) {
  const explicit = String(book.economicGeneration || "").trim();
  if (explicit) return explicit;
  const epoch = Math.max(0, Math.trunc(finite(book.economicEpochMs, 0)));
  const revision = Math.max(0, Math.trunc(finite(book.economicRevision, 0)));
  return epoch > 0 && revision > 0 ? `${epoch}:${revision}` : "";
}

function deriveRequirements(distribution = {}, correlationIndex = 0, config = {}) {
  const cfg = { ...DEFAULT_ELIGIBILITY_EPISODE_CONFIG, ...config };
  const medianEdge = finite(distribution.medianAssetNetEdge, cfg.minAssetNetEdge);
  const strength = clamp(
    (medianEdge - cfg.minAssetNetEdge) /
      Math.max(1e-9, cfg.strongAssetNetEdge - cfg.minAssetNetEdge),
    0,
    1,
  );
  const correlated = Math.min(2, Math.max(0, Math.trunc(finite(correlationIndex, 0))));
  const requiredCurrentAssetNetEdge = cfg.minAssetNetEdge + correlated * cfg.correlationCurrentEdgeIncrement;
  const requiredMedianAssetNetEdge = cfg.minAssetNetEdge + correlated * cfg.correlationMedianEdgeIncrement;
  const requiredRobustLowerAssetNetEdge = cfg.minAssetNetEdge + correlated * cfg.correlationLowerEdgeIncrement;
  return {
    strength,
    correlationIndex: correlated,
    requiredSnapshots: Math.min(
      6,
      Math.ceil(
        cfg.nearRequiredSnapshots -
          (cfg.nearRequiredSnapshots - cfg.strongRequiredSnapshots) * strength,
      ) + correlated * cfg.correlationSnapshotIncrement,
    ),
    requiredChainlinkEvents: Math.max(2, Math.trunc(cfg.requiredChainlinkEvents)),
    requiredDurationMs: Math.min(
      1_800,
      Math.round(
        cfg.nearRequiredDurationMs -
          (cfg.nearRequiredDurationMs - cfg.strongRequiredDurationMs) * strength,
      ) + correlated * cfg.correlationDurationIncrementMs,
    ),
    requiredCurrentAssetNetEdge,
    requiredMedianAssetNetEdge,
    requiredRobustLowerAssetNetEdge,
    requiredCurrentEdge: requiredCurrentAssetNetEdge,
    requiredMedianEdge: requiredMedianAssetNetEdge,
    requiredRobustLowerEdge: requiredRobustLowerAssetNetEdge,
  };
}

function invalidObservationReason(observation = {}, cfg = DEFAULT_ELIGIBILITY_EPISODE_CONFIG) {
  if (!observation.key) return "eligibility_episode_key_invalid";
  if (!String(observation.bookGeneration || "")) return "eligibility_episode_book_generation_missing";
  if (!String(observation.chainlinkGeneration || "")) return "eligibility_episode_chainlink_generation_missing";
  if (!observation.independentAssetPolicyEligible) {
    return observation.independentAssetPolicyReason || "eligibility_episode_independent_asset_ineligible";
  }
  if (finite(observation.assetNetEdge, -Infinity) < cfg.minAssetNetEdge) {
    return "eligibility_episode_asset_edge_below_floor";
  }
  if (!observation.bookIntegrityOk) return "eligibility_episode_book_integrity_invalid";
  if (!observation.wsBook) return "eligibility_episode_ws_book_required";
  const chainlinkAgeMs = finite(observation.chainlinkAgeMs, Infinity);
  if (chainlinkAgeMs < 0 || chainlinkAgeMs > cfg.maxChainlinkAgeMs) {
    return "eligibility_episode_chainlink_stale";
  }
  const bookAgeMs = finite(observation.bookAgeMs, Infinity);
  if (bookAgeMs < 0 || bookAgeMs > cfg.maxBookAgeMs) return "eligibility_episode_book_stale";
  if (!observation.officialTarget) return "eligibility_episode_official_target_required";
  return "";
}

function advanceEligibilityEpisode(previousState = null, rawObservation = {}, config = {}) {
  const cfg = { ...DEFAULT_ELIGIBILITY_EPISODE_CONFIG, ...config };
  const nowMs = Math.max(1, Math.trunc(finite(rawObservation.nowMs, Date.now())));
  const observation = { ...rawObservation, nowMs };
  const invalidReason = invalidObservationReason(observation, cfg);
  if (invalidReason) {
    return {
      state: null,
      decision: {
        ready: false,
        reason: invalidReason,
        transition: previousState ? "reset" : "ignored",
        reset: Boolean(previousState),
      },
    };
  }

  const previousSample = previousState?.samples?.at(-1);
  const sameEconomicEvidence = previousSample &&
    String(previousSample.bookGeneration || "") === String(observation.bookGeneration || "") &&
    String(previousSample.chainlinkGeneration || "") === String(observation.chainlinkGeneration || "");
  const expiredByGap = previousState && nowMs - finite(
    previousState.lastDistinctAtMs,
    finite(previousState.startedAtMs, 0),
  ) > cfg.maxObservationGapMs;
  if (expiredByGap && sameEconomicEvidence) {
    const reason = "eligibility_episode_stale_duplicate_ignored";
    const state = {
      ...previousState,
      lastObservedAtMs: nowMs,
      ready: false,
      reason,
      duplicatesIgnored: Math.max(0, Math.trunc(finite(previousState.duplicatesIgnored, 0))) + 1,
    };
    return {
      state,
      decision: {
        ...state,
        samples: undefined,
        transition: "stale_duplicate",
        reset: previousState.reason !== reason,
      },
    };
  }

  const reusable = previousState && previousState.key === observation.key && !expiredByGap;
  let samples = reusable ? [...(previousState.samples || [])] : [];
  const sample = {
    bookGeneration: String(observation.bookGeneration),
    chainlinkGeneration: String(observation.chainlinkGeneration),
    observedAtMs: nowMs,
    assetNetEdge: finite(observation.assetNetEdge),
    assetProbability: finite(observation.assetProbability, null),
    calibratedNetEdge: finite(observation.calibratedNetEdge, null),
    calibratedProbability: finite(observation.calibratedProbability, null),
    bookConfirmationScore: finite(observation.bookConfirmationScore, null),
    bookConfirmed: observation.bookConfirmed === true,
    chainlinkAgeMs: finite(observation.chainlinkAgeMs, null),
    bookAgeMs: finite(observation.bookAgeMs, null),
  };
  const duplicateEconomicEvidence = samples.length > 0 &&
    samples.at(-1).bookGeneration === sample.bookGeneration &&
    samples.at(-1).chainlinkGeneration === sample.chainlinkGeneration;
  if (duplicateEconomicEvidence) samples[samples.length - 1] = sample;
  else samples.push(sample);
  samples = samples.slice(-Math.max(2, Math.trunc(cfg.maxSamples)));

  const startedAtMs = reusable ? finite(previousState.startedAtMs, nowMs) : nowMs;
  const distribution = edgeDistribution(samples);
  const requirements = deriveRequirements(distribution, observation.correlationIndex, cfg);
  const durationMs = Math.max(0, nowMs - startedAtMs);
  const distinctSnapshots = new Set(samples.map((item) => item.bookGeneration)).size;
  const distinctChainlinkEvents = new Set(samples.map((item) => item.chainlinkGeneration)).size;
  const currentAssetNetEdge = finite(sample.assetNetEdge, -Infinity);
  const ready = distinctSnapshots >= requirements.requiredSnapshots &&
    distinctChainlinkEvents >= requirements.requiredChainlinkEvents &&
    durationMs >= requirements.requiredDurationMs &&
    currentAssetNetEdge >= requirements.requiredCurrentAssetNetEdge &&
    finite(distribution.medianAssetNetEdge, -Infinity) >= requirements.requiredMedianAssetNetEdge &&
    finite(distribution.robustLowerAssetNetEdge, -Infinity) >= requirements.requiredRobustLowerAssetNetEdge;

  let reason = "eligibility_episode_asset_evidence_ready";
  if (distinctSnapshots < requirements.requiredSnapshots) reason = "eligibility_episode_more_distinct_books_required";
  else if (distinctChainlinkEvents < requirements.requiredChainlinkEvents) reason = "eligibility_episode_more_distinct_chainlink_events_required";
  else if (durationMs < requirements.requiredDurationMs) reason = "eligibility_episode_more_duration_required";
  else if (currentAssetNetEdge < requirements.requiredCurrentAssetNetEdge) reason = "eligibility_episode_current_asset_edge_not_strong_enough";
  else if (finite(distribution.medianAssetNetEdge, -Infinity) < requirements.requiredMedianAssetNetEdge) reason = "eligibility_episode_median_asset_edge_not_strong_enough";
  else if (finite(distribution.robustLowerAssetNetEdge, -Infinity) < requirements.requiredRobustLowerAssetNetEdge) reason = "eligibility_episode_asset_lower_bound_not_strong_enough";

  const state = {
    key: observation.key,
    version: "v374.4-independent-asset-economic-evidence",
    slug: observation.slug,
    side: normalizeSide(observation.side),
    startedAtMs,
    lastObservedAtMs: nowMs,
    lastDistinctAtMs: duplicateEconomicEvidence
      ? finite(previousState?.lastDistinctAtMs, startedAtMs)
      : nowMs,
    samples,
    duplicatesIgnored: Math.max(0, Math.trunc(finite(previousState?.duplicatesIgnored, 0))) +
      (duplicateEconomicEvidence ? 1 : 0),
    distribution,
    requirements,
    durationMs,
    distinctSnapshots,
    distinctChainlinkEvents,
    ready,
    reason,
    latest: sample,
  };
  return {
    state,
    decision: {
      ...state,
      samples: undefined,
      transition: ready && !previousState?.ready
        ? "ready"
        : !reusable
          ? (expiredByGap ? "restart_after_gap" : "started")
          : duplicateEconomicEvidence
            ? "duplicate"
            : "progress",
      reset: Boolean(expiredByGap),
    },
  };
}

class EligibilityEpisodeStore {
  constructor(config = {}) {
    this.config = { ...DEFAULT_ELIGIBILITY_EPISODE_CONFIG, ...config };
    this.states = new Map();
    this.stats = {
      observedDistinct: 0,
      duplicatesIgnored: 0,
      resets: 0,
      staleResets: 0,
      ready: 0,
      committedBase: 0,
      committedCorrelated: 0,
    };
  }

  prune(nowMs = Date.now()) {
    const now = finite(nowMs, Date.now());
    for (const [key, state] of this.states) {
      if (now - finite(state.lastDistinctAtMs, finite(state.lastObservedAtMs, 0)) > this.config.ttlMs) {
        this.states.delete(key);
      }
    }
    while (this.states.size > this.config.maxEntries) {
      const oldest = [...this.states.entries()].sort((a, b) =>
        finite(a[1].lastDistinctAtMs, finite(a[1].lastObservedAtMs, 0)) -
        finite(b[1].lastDistinctAtMs, finite(b[1].lastObservedAtMs, 0))
      )[0];
      if (!oldest) break;
      this.states.delete(oldest[0]);
    }
  }

  observe(observation = {}) {
    const key = String(observation.key || "");
    this.prune(observation.nowMs);
    const previous = key ? this.states.get(key) : null;
    const result = advanceEligibilityEpisode(previous, observation, this.config);
    if (result.state && key) this.states.set(key, result.state);
    else if (key) this.states.delete(key);
    if (["duplicate", "stale_duplicate"].includes(result.decision.transition)) this.stats.duplicatesIgnored += 1;
    else if (["started", "progress", "ready", "restart_after_gap"].includes(result.decision.transition)) this.stats.observedDistinct += 1;
    if (result.decision.reset) this.stats.resets += 1;
    if (/stale|gap/.test(result.decision.reason) || result.decision.transition === "restart_after_gap") this.stats.staleResets += 1;
    if (result.decision.transition === "ready") this.stats.ready += 1;
    this.prune(observation.nowMs);
    return result.decision;
  }

  revalidateFinalEdge(key, raw = {}) {
    const normalizedKey = String(key || "");
    const previous = normalizedKey ? this.states.get(normalizedKey) : null;
    if (!previous || !Array.isArray(previous.samples) || !previous.samples.length) {
      return {
        ready: false,
        reason: "eligibility_episode_final_fill_state_missing",
        transition: "final_fill_rejected",
        finalFillRevalidation: true,
      };
    }

    const finalAssetNetEdge = finite(raw.assetNetEdge, -Infinity);
    const samples = previous.samples.map((sample) => ({ ...sample }));
    samples[samples.length - 1] = {
      ...samples.at(-1),
      assetNetEdge: finalAssetNetEdge,
      calibratedNetEdge: finite(raw.calibratedNetEdge, samples.at(-1).calibratedNetEdge),
      finalFillRevalidated: true,
    };
    const distribution = edgeDistribution(samples);
    const correlationIndex = finite(raw.correlationIndex, previous.requirements?.correlationIndex || 0);
    const requirements = deriveRequirements(distribution, correlationIndex, this.config);
    const independentEligible = raw.independentAssetPolicyEligible !== false &&
      finalAssetNetEdge >= this.config.minAssetNetEdge;
    const calibratedEligible = raw.calibratedPolicyEligible !== false;
    const bookConfirmed = raw.bookConfirmed !== false;
    const ready = independentEligible && calibratedEligible && bookConfirmed &&
      previous.distinctSnapshots >= requirements.requiredSnapshots &&
      previous.distinctChainlinkEvents >= requirements.requiredChainlinkEvents &&
      previous.durationMs >= requirements.requiredDurationMs &&
      finalAssetNetEdge >= requirements.requiredCurrentAssetNetEdge &&
      finite(distribution.medianAssetNetEdge, -Infinity) >= requirements.requiredMedianAssetNetEdge &&
      finite(distribution.robustLowerAssetNetEdge, -Infinity) >= requirements.requiredRobustLowerAssetNetEdge;

    let reason = "eligibility_episode_final_fill_ready";
    if (!independentEligible) reason = raw.independentAssetPolicyReason || "eligibility_episode_final_fill_independent_asset_ineligible";
    else if (!calibratedEligible) reason = raw.calibratedPolicyReason || "eligibility_episode_final_fill_calibrated_policy_ineligible";
    else if (!bookConfirmed) reason = "eligibility_episode_final_fill_book_not_confirming";
    else if (previous.distinctSnapshots < requirements.requiredSnapshots) reason = "eligibility_episode_final_fill_more_distinct_books_required";
    else if (previous.distinctChainlinkEvents < requirements.requiredChainlinkEvents) reason = "eligibility_episode_final_fill_more_distinct_chainlink_events_required";
    else if (previous.durationMs < requirements.requiredDurationMs) reason = "eligibility_episode_final_fill_more_duration_required";
    else if (finalAssetNetEdge < requirements.requiredCurrentAssetNetEdge) reason = "eligibility_episode_final_fill_current_asset_edge_not_strong_enough";
    else if (finite(distribution.medianAssetNetEdge, -Infinity) < requirements.requiredMedianAssetNetEdge) reason = "eligibility_episode_final_fill_median_asset_edge_not_strong_enough";
    else if (finite(distribution.robustLowerAssetNetEdge, -Infinity) < requirements.requiredRobustLowerAssetNetEdge) reason = "eligibility_episode_final_fill_asset_lower_bound_not_strong_enough";

    const state = {
      ...previous,
      samples,
      latest: samples.at(-1),
      distribution,
      requirements,
      ready,
      reason,
    };
    this.states.set(normalizedKey, state);
    return {
      ...state,
      samples: undefined,
      transition: ready ? "final_fill_ready" : "final_fill_rejected",
      reset: false,
      finalFillRevalidation: true,
      preliminaryReady: previous.ready === true,
    };
  }

  commit(key, correlationIndex = 0) {
    const normalizedKey = String(key || "");
    if (normalizedKey) this.states.delete(normalizedKey);
    if (finite(correlationIndex, 0) > 0) this.stats.committedCorrelated += 1;
    else this.stats.committedBase += 1;
  }

  delete(key) {
    return this.states.delete(String(key || ""));
  }

  clear() {
    this.states.clear();
  }

  get size() {
    return this.states.size;
  }
}

export {
  DEFAULT_ELIGIBILITY_EPISODE_CONFIG,
  EligibilityEpisodeStore,
  advanceEligibilityEpisode,
  buildBookEconomicGeneration,
  buildEligibilityEpisodeKey,
  deriveRequirements,
  edgeDistribution,
  normalizeSide,
};
