import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { shouldTrainFromSettlement } from "../settlement/settlementPolicy.js";
import { buildAntiDowngradeEvidence } from "./antiDowngradeEvidence.js";

const OBSERVER_POLICY_SCHEMA = "v3747.observer-policy.1";

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round(value, digits = 8) {
  if (!Number.isFinite(Number(value))) return null;
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function priceBucket(value) {
  const price = finite(value, Number.NaN);
  if (!Number.isFinite(price)) return "unknown";
  if (price < 0.50) return "below-0.50";
  if (price < 0.60) return "0.50-0.59";
  if (price < 0.70) return "0.60-0.69";
  if (price < 0.80) return "0.70-0.79";
  return "0.80-plus";
}

function normalizeDirection(value) {
  const direction = String(value || "").trim().toUpperCase();
  return direction === "UP" || direction === "DOWN" ? direction : "UNKNOWN";
}

function recordKey(row = {}) {
  return String(row.id || row.slug || "").trim();
}

function cohortKey(row = {}) {
  return [
    String(row.symbol || "UNKNOWN").trim().toUpperCase(),
    normalizeDirection(row.direction || row.side || row.predictedOutcome),
    priceBucket(row.averageFillPrice ?? row.buyPrice ?? row.selectedBuyPrice ?? row.entryPrice),
  ].join("|");
}

function hashPayload(payload = {}) {
  const copy = { ...payload };
  delete copy.hash;
  return crypto.createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = fs.openSync(temporaryPath, "w", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporaryPath, filePath);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonlDirectory(directory) {
  if (!directory || !fs.existsSync(directory)) return { rows: [], files: [], truncatedLinesIgnored: 0 };
  const files = fs.readdirSync(directory)
    .filter((name) => name.endsWith(".jsonl"))
    .sort((left, right) => left.localeCompare(right));
  const rows = [];
  let truncatedLinesIgnored = 0;
  const fileCursor = [];
  for (const name of files) {
    const filePath = path.join(directory, name);
    const stat = fs.statSync(filePath);
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    const lastNonEmptyIndex = lines.reduce((last, line, index) => line.trim() ? index : last, -1);
    let validLines = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try {
        rows.push(JSON.parse(line));
        validLines += 1;
      } catch {
        // A live archive can end with one incomplete JSONL line. It is retried on
        // the next pass and never counted in the exactly-once cursor.
        if (index !== lastNonEmptyIndex) throw new Error(`observer_jsonl_corruption:${filePath}:${index + 1}`);
        truncatedLinesIgnored += 1;
      }
    }
    fileCursor.push({ name, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs), validLines });
  }
  return { rows, files: fileCursor, truncatedLinesIgnored };
}

function uniqueOfficialFilled(rows = []) {
  const unique = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!shouldTrainFromSettlement(row)) continue;
    if (row.botRole !== "main_test") continue;
    if (String(row.sourceType || "").toLowerCase() !== "real_market") continue;
    if (row.realParityEligible !== true) continue;
    const version = String(row.strategyVersion || row.releaseVersion || "");
    if (!version.includes("374.5") && !version.includes("374.6")) continue;
    const key = recordKey(row);
    if (!key) continue;
    const previous = unique.get(key);
    const previousTime = Date.parse(previous?.settledAt || previous?.time || "") || 0;
    const nextTime = Date.parse(row.settledAt || row.time || "") || 0;
    if (!previous || nextTime >= previousTime) unique.set(key, row);
  }
  return [...unique.values()].sort((left, right) =>
    (Date.parse(left.settledAt || left.time || "") || 0) - (Date.parse(right.settledAt || right.time || "") || 0)
  );
}

function wilsonLower(wins, total, z = 1.959963984540054) {
  if (!total) return null;
  const p = wins / total;
  const denominator = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) / total) + (z * z) / (4 * total * total));
  return Math.max(0, (center - margin) / denominator);
}

function summarize(rows = []) {
  const samples = rows.length;
  const wins = rows.filter((row) => row.status === "paper_win").length;
  const losses = samples - wins;
  const pnlUsd = rows.reduce((sum, row) => sum + finite(row.paperPnlUsd, 0), 0);
  const stakeUsd = rows.reduce((sum, row) => sum + finite(row.filledStakeUsd ?? row.paperStakeUsd, 0), 0);
  return {
    samples,
    wins,
    losses,
    winRate: samples ? round((wins / samples) * 100, 6) : 0,
    pnlUsd: round(pnlUsd, 8),
    stakeUsd: round(stakeUsd, 8),
    roiPct: stakeUsd > 0 ? round((pnlUsd / stakeUsd) * 100, 6) : 0,
    posteriorProbability: samples ? round((wins + 1) / (samples + 2), 8) : null,
    wilson95Lower: samples ? round(wilsonLower(wins, samples), 8) : null,
  };
}

function groupSummaries(rows, keyBuilder) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyBuilder(row);
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, values]) => [key, summarize(values)]));
}

function officialWinningDirection(settlement = {}) {
  const official = normalizeDirection(settlement.officialOutcome);
  if (official !== "UNKNOWN") return official;
  const entered = normalizeDirection(settlement.direction || settlement.side);
  if (entered === "UNKNOWN") return "UNKNOWN";
  if (settlement.status === "paper_win") return entered;
  if (settlement.status === "paper_loss") return entered === "UP" ? "DOWN" : "UP";
  return "UNKNOWN";
}

function checkpointPrice(row = {}) {
  const side = normalizeDirection(row.predictedOutcome || row.direction || row.side);
  if (side === "UP") return finite(row.upBuyPrice ?? row.selectedBuyPrice, Number.NaN);
  if (side === "DOWN") return finite(row.downBuyPrice ?? row.selectedBuyPrice, Number.NaN);
  return Number.NaN;
}

function summarizeCheckpointChallenger(checkpointRows = [], settlements = []) {
  const settlementBySlug = new Map(settlements.map((row) => [String(row.slug || ""), row]));
  const bySlugSecond = new Map();
  for (const row of checkpointRows) {
    const slug = String(row.slug || "");
    const second = Number(row.checkpointSeconds);
    if (!slug || !Number.isFinite(second)) continue;
    bySlugSecond.set(`${slug}:${second}`, row);
  }
  const eligible = [];
  for (const [slug, settlement] of settlementBySlug) {
    const at90 = bySlugSecond.get(`${slug}:90`);
    const at120 = bySlugSecond.get(`${slug}:120`);
    if (!at90 || !at120) continue;
    const side90 = normalizeDirection(at90.predictedOutcome || at90.direction);
    const side120 = normalizeDirection(at120.predictedOutcome || at120.direction);
    const price = checkpointPrice(at120);
    if (side90 === "UNKNOWN" || side90 !== side120 || !Number.isFinite(price) || price < 0.50 || price > 0.85) continue;
    const won = side120 === officialWinningDirection(settlement);
    const feeRatio = 0.07 * (1 - price);
    const unitPnl = won ? ((1 - price) / price) - feeRatio : -1 - feeRatio;
    eligible.push({ won, unitPnl, price });
  }
  const samples = eligible.length;
  const wins = eligible.filter((row) => row.won).length;
  const unitRoiPct = samples
    ? (eligible.reduce((sum, row) => sum + row.unitPnl, 0) / samples) * 100
    : 0;
  const winRate = samples ? (wins / samples) * 100 : 0;
  const evidenceGatePassed = samples >= 100 && winRate >= 70 && unitRoiPct > 0;
  return {
    observerOnly: true,
    executionEligible: false,
    hypothesis: "direction_stable_90_to_120_and_selected_price_gte_0_50",
    samples,
    wins,
    losses: samples - wins,
    winRate: round(winRate, 6),
    unitStakeRoiPct: round(unitRoiPct, 6),
    promotionThreshold: { samples: 100, winRate: 70, unitStakeRoiPctAbove: 0 },
    evidenceGatePassed,
    eligibleForManualReview: evidenceGatePassed,
    promotionEligible: false,
    automaticMainExecutionPromotion: false,
  };
}

function createSettlementObserverLearner(options = {}) {
  const settlementDirectory = path.resolve(options.settlementDirectory || "server/data-main-v3747/settlements");
  const checkpointDirectory = path.resolve(options.checkpointDirectory || "server/data-observer-v3747/research/canonical-checkpoints");
  const policyPath = path.resolve(options.policyPath || "server/data-observer-v3747/policy/observer-policy-v3747.json");
  const statePath = path.resolve(options.statePath || "server/data-observer-v3747/observer/settlement-cursor-v3747.json");
  const antiDowngradeReportPath = path.resolve(
    options.antiDowngradeReportPath || path.join(path.dirname(policyPath), "anti-downgrade-evidence-latest.json"),
  );
  const minimumSamples = Math.max(100, Math.trunc(finite(options.minimumSamples, 100)));
  const minimumWinRate = Math.max(70, finite(options.minimumWinRate, 70));
  let lastStatus = { status: "not_run", policyPath, settlementDirectory };

  function runOnce(now = Date.now()) {
    const settlementRead = readJsonlDirectory(settlementDirectory);
    const official = uniqueOfficialFilled(settlementRead.rows);
    const core = official.filter((row) =>
      row.regimeCorePolicy?.eligible === true &&
      row.independentAssetEdgePolicy?.eligible === true &&
      finite(row.averageFillPrice ?? row.buyPrice, 0) >= 0.50 &&
      finite(row.averageFillPrice ?? row.buyPrice, 0) <= 0.85 &&
      finite(row.confidence, 0) >= 95
    );
    const previousState = readJson(statePath, { processedIds: [] }) || { processedIds: [] };
    const previouslyProcessed = new Set(Array.isArray(previousState.processedIds) ? previousState.processedIds.map(String) : []);
    const processedIds = official.map(recordKey).filter(Boolean);
    const newOfficialSettlements = processedIds.filter((id) => !previouslyProcessed.has(id)).length;
    const global = summarize(core);
    const reliable = global.samples >= minimumSamples && global.winRate >= minimumWinRate && global.roiPct > 0;
    const checkpointRead = readJsonlDirectory(checkpointDirectory);
    const generatedAt = new Date(now).toISOString();
    const antiDowngradeEvidence = buildAntiDowngradeEvidence(official, {
      startEquityUsd: finite(options.startEquityUsd, 40),
    });
    const payload = {
      schemaVersion: OBSERVER_POLICY_SCHEMA,
      generatedAt,
      observerOnly: true,
      executionEligible: false,
      automaticPromotion: false,
      source: {
        runtimeData: "official_real_filled_unique_only",
        settlementDirectory,
        checkpointDirectory,
        syntheticDataUsed: false,
        proxySettlementUsed: false,
      },
      cursor: {
        officialUniqueCount: official.length,
        coreOfficialUniqueCount: core.length,
        newOfficialSettlements,
        processedIdsHash: crypto.createHash("sha256").update(processedIds.join("\n")).digest("hex"),
        settlementFiles: settlementRead.files,
        truncatedLinesIgnored: settlementRead.truncatedLinesIgnored,
      },
      thresholds: {
        minimumSamples,
        minimumWinRate,
        roiMustBePositive: true,
        minimumCohortSamples: 30,
      },
      reliability: {
        reliable,
        reason: reliable ? "fresh_forward_core_thresholds_met" : "fresh_forward_core_thresholds_not_met",
        evidenceGatePassed: reliable,
        eligibleForManualReview: reliable,
        promotionEligible: false,
        executionEligible: false,
      },
      allOfficial: summarize(official),
      core,
      global,
      symbols: groupSummaries(core, (row) => String(row.symbol || "UNKNOWN").toUpperCase()),
      cohorts: groupSummaries(core, cohortKey),
      checkpointChallenger: summarizeCheckpointChallenger(checkpointRead.rows, official),
      antiDowngradeEvidence,
    };
    // Do not persist full settlement rows inside the executable policy.
    delete payload.core;
    payload.hash = hashPayload(payload);
    atomicWriteJson(policyPath, payload);
    atomicWriteJson(antiDowngradeReportPath, {
      generatedAt,
      observerOnly: true,
      executionEligible: false,
      automaticPromotion: false,
      policyHash: payload.hash,
      ...antiDowngradeEvidence,
    });
    atomicWriteJson(statePath, {
      schemaVersion: "v3747.settlement-cursor.1",
      updatedAt: generatedAt,
      processedIds,
      processedIdsHash: payload.cursor.processedIdsHash,
      officialUniqueCount: official.length,
      newOfficialSettlements,
      policyHash: payload.hash,
    });
    lastStatus = {
      status: "ready",
      generatedAt,
      officialUniqueCount: official.length,
      coreOfficialUniqueCount: core.length,
      newOfficialSettlements,
      reliable,
      policyPath,
      statePath,
      antiDowngradeReportPath,
      antiDowngradePromotionEligible: antiDowngradeEvidence.promotionEligible,
      truncatedLinesIgnored: settlementRead.truncatedLinesIgnored,
    };
    return { policy: payload, status: lastStatus };
  }

  return {
    runOnce,
    status() { return { ...lastStatus }; },
    policyPath,
    statePath,
    antiDowngradeReportPath,
    settlementDirectory,
  };
}

function validateObserverPolicy(policy, options = {}, now = Date.now()) {
  const maximumAgeMs = Math.max(10_000, finite(options.maximumAgeMs, 180_000));
  if (!policy || typeof policy !== "object") return { valid: false, reason: "observer_policy_unavailable" };
  if (policy.schemaVersion !== OBSERVER_POLICY_SCHEMA) return { valid: false, reason: "observer_policy_schema_mismatch" };
  if (policy.observerOnly !== true || policy.executionEligible !== false) return { valid: false, reason: "observer_policy_role_contract_invalid" };
  if (policy.source?.syntheticDataUsed !== false || policy.source?.proxySettlementUsed !== false) {
    return { valid: false, reason: "observer_policy_non_official_data_forbidden" };
  }
  if (policy.hash !== hashPayload(policy)) return { valid: false, reason: "observer_policy_hash_mismatch" };
  const generatedAtMs = Date.parse(policy.generatedAt || "");
  const ageMs = Number.isFinite(generatedAtMs) ? Math.max(0, now - generatedAtMs) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(ageMs) || ageMs > maximumAgeMs) return { valid: false, reason: "observer_policy_stale", ageMs };
  if (policy.reliability?.reliable !== true || policy.reliability?.evidenceGatePassed !== true) {
    return { valid: false, reason: "observer_policy_not_reliable", ageMs };
  }
  return { valid: false, reason: "observer_policy_telemetry_only_execution_forbidden", ageMs };
}

function createObserverPolicyReader(options = {}) {
  const policyPath = path.resolve(options.policyPath || "server/data-observer-v3747/policy/observer-policy-v3747.json");
  const maximumAgeMs = Math.max(10_000, finite(options.maximumAgeMs, 180_000));
  const minimumCohortSamples = Math.max(1, Math.trunc(finite(options.minimumCohortSamples, 30)));
  let cachedMtimeMs = -1;
  let cachedPolicy = null;
  let cachedStatus = { valid: false, reason: "observer_policy_not_loaded", policyPath };

  function load(now = Date.now()) {
    try {
      const stat = fs.statSync(policyPath);
      if (stat.mtimeMs !== cachedMtimeMs) {
        cachedPolicy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
        cachedMtimeMs = stat.mtimeMs;
      }
      cachedStatus = { ...validateObserverPolicy(cachedPolicy, { maximumAgeMs }, now), policyPath };
    } catch {
      cachedPolicy = null;
      cachedMtimeMs = -1;
      cachedStatus = { valid: false, reason: "observer_policy_unavailable", policyPath };
    }
    return { policy: cachedPolicy, status: cachedStatus };
  }

  function effectiveProbability(input = {}, now = Date.now()) {
    const assetProbability = finite(input.assetProbability, Number.NaN);
    const loaded = load(now);
    if (!Number.isFinite(assetProbability) || assetProbability <= 0 || assetProbability >= 1) {
      return { applied: false, reason: "asset_probability_invalid", assetProbability: null, effectiveProbability: null, policyStatus: loaded.status };
    }
    if (!loaded.status.valid) {
      return {
        applied: false,
        reason: `static_core_fallback:${loaded.status.reason}`,
        assetProbability,
        effectiveProbability: assetProbability,
        policyStatus: loaded.status,
      };
    }
    const exactKey = cohortKey(input);
    const symbolKey = String(input.symbol || "UNKNOWN").toUpperCase();
    const exact = loaded.policy.cohorts?.[exactKey];
    const symbol = loaded.policy.symbols?.[symbolKey];
    const evidence = exact?.samples >= minimumCohortSamples
      ? { key: exactKey, level: "cohort", ...exact }
      : symbol?.samples >= minimumCohortSamples
        ? { key: symbolKey, level: "symbol", ...symbol }
        : null;
    if (!evidence || !Number.isFinite(Number(evidence.posteriorProbability))) {
      return {
        applied: false,
        reason: "static_core_fallback:observer_cohort_sample_insufficient",
        assetProbability,
        effectiveProbability: assetProbability,
        policyStatus: loaded.status,
      };
    }
    const forwardProbability = Math.min(0.99, Math.max(0.01, Number(evidence.posteriorProbability)));
    return {
      applied: true,
      reason: "observer_forward_probability_conservative_cap",
      assetProbability,
      forwardProbability,
      effectiveProbability: Math.min(assetProbability, forwardProbability),
      evidence,
      policyHash: loaded.policy.hash,
      policyStatus: loaded.status,
    };
  }

  return {
    load,
    effectiveProbability,
    status(now = Date.now()) { return load(now).status; },
    policyPath,
  };
}

export {
  OBSERVER_POLICY_SCHEMA,
  atomicWriteJson,
  cohortKey,
  createObserverPolicyReader,
  createSettlementObserverLearner,
  hashPayload,
  priceBucket,
  readJsonlDirectory,
  summarize,
  summarizeCheckpointChallenger,
  uniqueOfficialFilled,
  validateObserverPolicy,
};
