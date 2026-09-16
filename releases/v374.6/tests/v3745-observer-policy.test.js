import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createObserverPolicyReader,
  createSettlementObserverLearner,
  hashPayload,
  readJsonlDirectory,
  validateObserverPolicy,
} from "../server/research/observerPolicy.js";

function settlement(index, status = "paper_win", overrides = {}) {
  return {
    id: `signal-${index}`,
    slug: `btc-updown-5m-${index}`,
    botRole: "main_test",
    strategyVersion: "v374.5-regime-core-fastgrow-paper",
    sourceType: "real_market",
    status,
    officialSettlementUsed: true,
    settlementSource: "official_poly",
    executionStatus: "filled",
    realParityEligible: true,
    learningEligible: true,
    filledStakeUsd: 1,
    paperStakeUsd: 1,
    paperPnlUsd: status === "paper_win" ? 0.60 : -1,
    symbol: "BTC",
    direction: "Up",
    confidence: 97,
    averageFillPrice: 0.60,
    regimeCorePolicy: { eligible: true },
    independentAssetEdgePolicy: { eligible: true },
    officialOutcome: status === "paper_win" ? "Up" : "Down",
    settledAt: new Date(1_780_000_000_000 + index * 1_000).toISOString(),
    ...overrides,
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v3745-observer-"));
  const settlements = path.join(root, "main", "settlements");
  const checkpoints = path.join(root, "observer", "checkpoints");
  const policy = path.join(root, "observer", "policy.json");
  const state = path.join(root, "observer", "state.json");
  fs.mkdirSync(settlements, { recursive: true });
  fs.mkdirSync(checkpoints, { recursive: true });
  return { root, settlements, checkpoints, policy, state };
}

function writeRows(filePath, rows, tail = "") {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n${tail}`, "utf8");
}

test("observer ingests official filled settlements exactly once across repeated runs", () => {
  const dir = fixture();
  writeRows(path.join(dir.settlements, "2026-07-19.jsonl"), [settlement(1), settlement(2)]);
  const learner = createSettlementObserverLearner({
    settlementDirectory: dir.settlements,
    checkpointDirectory: dir.checkpoints,
    policyPath: dir.policy,
    statePath: dir.state,
  });
  const first = learner.runOnce();
  const second = learner.runOnce();
  assert.equal(first.status.newOfficialSettlements, 2);
  assert.equal(second.status.newOfficialSettlements, 0);
  assert.equal(second.status.officialUniqueCount, 2);
  assert.equal(second.policy.observerOnly, true);
  assert.equal(second.policy.executionEligible, false);
});

test("observer excludes non-main, non-real, non-parity, unfilled, and non-core rows", () => {
  const dir = fixture();
  const rows = [
    settlement(1),
    settlement(2, "paper_win", { botRole: "checkpoint_observer" }),
    settlement(3, "paper_win", { sourceType: "fallback" }),
    settlement(4, "paper_win", { realParityEligible: false }),
    settlement(5, "paper_win", { executionStatus: "unfilled", filledStakeUsd: 0 }),
    settlement(6, "paper_win", { regimeCorePolicy: { eligible: false } }),
    settlement(7, "paper_win", { strategyVersion: "v374.4" }),
  ];
  writeRows(path.join(dir.settlements, "2026-07-19.jsonl"), rows);
  const learner = createSettlementObserverLearner({ settlementDirectory: dir.settlements, checkpointDirectory: dir.checkpoints, policyPath: dir.policy, statePath: dir.state });
  const result = learner.runOnce();
  assert.equal(result.status.officialUniqueCount, 2);
  assert.equal(result.status.coreOfficialUniqueCount, 1);
  assert.equal(result.policy.global.samples, 1);
});

test("one truncated live JSONL tail is retried, while interior corruption fails loudly", () => {
  const dir = fixture();
  const file = path.join(dir.settlements, "2026-07-19.jsonl");
  writeRows(file, [settlement(1)], "{\"id\":\"partial");
  const read = readJsonlDirectory(dir.settlements);
  assert.equal(read.rows.length, 1);
  assert.equal(read.truncatedLinesIgnored, 1);
  fs.writeFileSync(file, `${JSON.stringify(settlement(1))}\nnot-json\n${JSON.stringify(settlement(2))}\n`, "utf8");
  assert.throws(() => readJsonlDirectory(dir.settlements), /observer_jsonl_corruption/);
});

test("unreliable policy cannot affect main and automatically falls back to Static Core", () => {
  const dir = fixture();
  writeRows(path.join(dir.settlements, "2026-07-19.jsonl"), [settlement(1)]);
  const learner = createSettlementObserverLearner({ settlementDirectory: dir.settlements, checkpointDirectory: dir.checkpoints, policyPath: dir.policy, statePath: dir.state });
  const result = learner.runOnce();
  assert.equal(validateObserverPolicy(result.policy).valid, false);
  const reader = createObserverPolicyReader({ policyPath: dir.policy });
  const probability = reader.effectiveProbability({ assetProbability: 0.80, symbol: "BTC", direction: "UP", selectedBuyPrice: 0.60 });
  assert.equal(probability.applied, false);
  assert.equal(probability.effectiveProbability, 0.80);
  assert.match(probability.reason, /static_core_fallback/);
});

test("only a fresh 100-sample positive official policy may conservatively cap probability", () => {
  const dir = fixture();
  const rows = Array.from({ length: 100 }, (_, index) => settlement(index + 1, index < 80 ? "paper_win" : "paper_loss"));
  writeRows(path.join(dir.settlements, "2026-07-19.jsonl"), rows);
  const learner = createSettlementObserverLearner({ settlementDirectory: dir.settlements, checkpointDirectory: dir.checkpoints, policyPath: dir.policy, statePath: dir.state });
  const result = learner.runOnce();
  assert.equal(result.policy.reliability.reliable, true);
  assert.equal(validateObserverPolicy(result.policy).valid, true);
  const reader = createObserverPolicyReader({ policyPath: dir.policy, minimumCohortSamples: 30 });
  const probability = reader.effectiveProbability({ assetProbability: 0.90, symbol: "BTC", direction: "UP", selectedBuyPrice: 0.60 });
  assert.equal(probability.applied, true);
  assert.ok(probability.effectiveProbability < 0.90);
  assert.equal(probability.effectiveProbability, probability.forwardProbability);
});

test("hash corruption or stale policy is rejected without disabling Static Core", () => {
  const dir = fixture();
  writeRows(path.join(dir.settlements, "2026-07-19.jsonl"), Array.from({ length: 100 }, (_, index) => settlement(index + 1, index < 80 ? "paper_win" : "paper_loss")));
  const learner = createSettlementObserverLearner({ settlementDirectory: dir.settlements, checkpointDirectory: dir.checkpoints, policyPath: dir.policy, statePath: dir.state });
  const result = learner.runOnce();
  assert.equal(validateObserverPolicy({ ...result.policy, hash: "bad" }).reason, "observer_policy_hash_mismatch");
  const stale = { ...result.policy, generatedAt: "2020-01-01T00:00:00.000Z" };
  stale.hash = hashPayload(stale);
  assert.equal(validateObserverPolicy(stale).reason, "observer_policy_stale");
});
