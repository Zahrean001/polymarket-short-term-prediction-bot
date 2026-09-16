import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAuditLogger } from "../server/execution/auditLogger.js";
import { isMainPaperSignal } from "../server/execution/paperCommitPolicy.js";
import { isPrimaryPaperSignal } from "../server/metrics/primaryPaperSignal.js";
import {
  canonicalPredictionPayload,
  createPredictionPersistenceGate,
  predictionPayloadFingerprint,
} from "../server/storage/predictionPersistence.js";

test("prediction state writes on ledger change and otherwise only on heartbeat", () => {
  let nowMs = 1_000_000;
  const gate = createPredictionPersistenceGate({ heartbeatMs: 60_000, now: () => nowMs });
  const empty = canonicalPredictionPayload({ signals: [], history: [] });
  gate.markLoaded(empty, nowMs);
  assert.equal(gate.shouldWrite(empty).write, false);
  nowMs += 59_999;
  assert.equal(gate.shouldWrite(empty).write, false);
  nowMs += 1;
  const heartbeat = gate.shouldWrite(empty);
  assert.equal(heartbeat.write, true);
  assert.equal(heartbeat.reason, "heartbeat_due");
  gate.markWritten(heartbeat.fingerprint, heartbeat.currentTimeMs);
  const changed = canonicalPredictionPayload({ signals: [{ id: "filled-1", status: "paper_open" }], history: [] });
  assert.equal(gate.shouldWrite(changed).reason, "state_changed");
  assert.notEqual(predictionPayloadFingerprint(empty), predictionPayloadFingerprint(changed));
});

test("V374.7 release remains on the frozen V374.5 execution policy", () => {
  const signal = {
    releaseVersion: "v374.7-direction-only-shadow-fastgrow-full-paper",
    strategyVersion: "v374.5-regime-core-fastgrow-paper",
    botRole: "main_test",
    mainAccuracyLane: { eligible: true },
    regimeCorePolicy: { eligible: true },
    independentAssetEdgePolicy: { eligible: true },
    calibratedNetEv: { eligible: false },
    sourceType: "real_market",
    realParityEligible: true,
    executionStatus: "filled",
    filledStakeUsd: 4,
  };
  assert.equal(isMainPaperSignal(signal), true);
  assert.equal(isPrimaryPaperSignal(signal), true);
  assert.equal(isMainPaperSignal({ ...signal, regimeCorePolicy: { eligible: false } }), false);
  assert.equal(isPrimaryPaperSignal({ ...signal, independentAssetEdgePolicy: { eligible: false } }), false);
});

test("audit dedupe suppresses identical scan spam but never signal or settlement rows", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v3747-audit-"));
  let nowMs = 1_000;
  const logger = createAuditLogger(root, {
    decisionDedupeMs: 1_000,
    now: () => nowMs,
  });
  const decision = {
    time: "2026-07-19T00:00:00.000Z",
    market: "btc-updown-5m-1",
    symbol: "BTC",
    timeframe: "5M",
    selectedOutcome: "UP",
    tradeable: false,
    reason: "waiting_for_economic_revision",
    confidence: 95,
    feeAdjustedEdge: 0.05,
  };
  logger.decision(decision);
  logger.decision(decision);
  nowMs += 1_001;
  logger.decision(decision);
  logger.signal({ id: "signal-1" });
  logger.signal({ id: "signal-1" });
  logger.settlement({ id: "signal-1", status: "paper_win" });
  logger.settlement({ id: "signal-1", status: "paper_win" });

  const day = new Date().toISOString().slice(0, 10);
  const decisions = fs.readFileSync(path.join(root, "decisions", `${day}.jsonl`), "utf8").trim().split("\n").map(JSON.parse);
  const signals = fs.readFileSync(path.join(root, "signals", `${day}.jsonl`), "utf8").trim().split("\n");
  const settlements = fs.readFileSync(path.join(root, "settlements", `${day}.jsonl`), "utf8").trim().split("\n");
  assert.equal(decisions.length, 2);
  assert.equal(decisions[1].suppressedRepeats, 1);
  assert.equal(signals.length, 2);
  assert.equal(settlements.length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});
