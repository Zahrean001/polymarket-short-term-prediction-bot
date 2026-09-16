import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";

const RELEASE = "v374.7-direction-only-shadow-fastgrow-full-paper";
const STRATEGY = "v374.5-regime-core-fastgrow-paper";
const require = createRequire(import.meta.url);
const ecosystem = require(path.resolve("ecosystem.config.cjs"));
const app = ecosystem.apps.find((item) => item.name === "polymarket-direction-observer-v3747");
if (!app) throw new Error("v3747_direction_observer_process_missing");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function officialSettlement(row, overrides = {}) {
  return {
    ...row,
    status: "paper_win",
    officialSettlementUsed: true,
    settlementSource: "official_poly",
    settlementFinality: "official_poly",
    officialOutcome: row.direction,
    paperPnlUsd: 1.18,
    settledAt: new Date().toISOString(),
    ...overrides,
  };
}

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v3747-observer-smoke-"));
const mainDataDir = path.join(runtimeRoot, "main");
const observerDataDir = path.join(runtimeRoot, "observer");
const signalDir = path.join(mainDataDir, "signals");
const settlementDir = path.join(mainDataDir, "settlements");
const checkpointDir = path.join(observerDataDir, "research", "canonical-checkpoints");
const policyPath = path.join(observerDataDir, "policy", "observer-policy-v3747.json");
const settlementStatePath = path.join(observerDataDir, "observer", "settlement-cursor-v3747.json");
const evidencePath = path.join(observerDataDir, "reports", "anti-downgrade-evidence-latest.json");
const directionDecisionDir = path.join(observerDataDir, "research", "direction-only-decisions");
const directionStatePath = path.join(observerDataDir, "observer", "direction-only-cursor-v3747.json");
const directionReportPath = path.join(observerDataDir, "reports", "direction-only-shadow-latest.json");
const observerPaperStatePath = path.join(observerDataDir, "btc-paper-state.json");
fs.mkdirSync(signalDir, { recursive: true });
fs.mkdirSync(settlementDir, { recursive: true });

const startedAt = Date.now();
const signalEntryMs = startedAt - 500;
const signalWindowEndMs = startedAt + 8_000;
const directionSignal = {
  id: "v3747-direction-smoke-signal-1",
  slug: `btc-updown-5m-${Math.floor(startedAt / 300_000) * 300}`,
  botRole: "main_test",
  botInstanceId: "main-direction-shadow-fastgrow-v3747",
  strategyVersion: STRATEGY,
  releaseVersion: RELEASE,
  sourceType: "real_market",
  status: "paper_open",
  executionStatus: "filled",
  realParityEligible: true,
  learningEligible: true,
  time: new Date(signalEntryMs).toISOString(),
  windowStart: new Date(signalEntryMs - 100_000).toISOString(),
  windowEnd: new Date(signalWindowEndMs).toISOString(),
  symbol: "BTC",
  timeframe: "5M",
  direction: "Up",
  confidence: 97,
  averageFillPrice: 0.76,
  buyPrice: 0.76,
  bestAskAtDecision: 0.76,
  yesNoAskCost: 1.02,
  pAssetUp: 0.87,
  pMarketUp: 0.75,
  probabilityUp: 0.87,
  probabilityDown: 0.13,
  priceDelta: 16,
  distanceBps: 2.5,
  volatilityAdjustedDistance: 1.1,
  volatility60Bps: 2.2,
  momentum15Bps: 0.07,
  momentum30Bps: -0.01,
  momentum60Bps: 0.25,
  bookConfirmed: true,
  bookConfirmationScore: 0.53,
  secondsIntoWindow: 100,
  entryLane: "A",
  filledStakeUsd: 4,
  paperStakeUsd: 4,
  accountEquity: 40,
  takerFeeRate: 0.07,
  bookSource: "ws_delta+ws_delta",
  bookAgeMs: 11,
  regimeCorePolicy: { eligible: true },
  independentAssetEdgePolicy: { eligible: true },
  eligibilityEpisode: { correlation: { correlationIndex: 0 } },
  directionShadowEntrySnapshot: {
    schemaVersion: "v3747.direction-shadow-entry-snapshot.1",
    capturedAt: new Date(signalEntryMs).toISOString(),
    observerOnlyConsumer: true,
    entrySnapshotOnly: true,
    liveMarketData: true,
    syntheticDataUsed: false,
    bookSource: "ws_delta+ws_delta",
    bookAgeMs: 11,
    upBestAsk: 0.76,
    downBestAsk: 0.26,
    upBestAskDepthShares: 20,
    downBestAskDepthShares: 30,
    selectedDirection: "Up",
    selectedAverageFillPrice: 0.76,
    selectedFilledStakeUsd: 4,
  },
};
const signalPath = path.join(signalDir, "runtime.jsonl");
fs.writeFileSync(signalPath, `${JSON.stringify(directionSignal)}\n`, "utf8");

const priorSignal = {
  ...directionSignal,
  id: "v3747-prior-official-settlement-1",
  slug: "btc-updown-5m-prior-smoke",
  time: new Date(startedAt - 600_000).toISOString(),
  windowStart: new Date(startedAt - 700_000).toISOString(),
  windowEnd: new Date(startedAt - 400_000).toISOString(),
};
const settlementPath = path.join(settlementDir, "runtime.jsonl");
fs.writeFileSync(settlementPath, `${JSON.stringify(officialSettlement(priorSignal, {
  settledAt: new Date(startedAt - 390_000).toISOString(),
}))}\n`, "utf8");
const signalHashBefore = sha256(signalPath);

const port = await freePort();
const feedPort = await freePort();
const feedIntervals = new Set();
const feedServer = await new Promise((resolve, reject) => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: feedPort });
  server.once("listening", () => resolve(server));
  server.once("error", reject);
});
feedServer.on("connection", (socket) => {
  let sequence = 0;
  const emit = () => {
    if (socket.readyState !== 1) return;
    sequence += 1;
    socket.send(JSON.stringify({
      topic: "crypto_prices_chainlink",
      payload: {
        timestamp: Date.now(),
        data: [
          { symbol: "BTC/USD", value: 60_000 + sequence },
          { symbol: "SOL/USD", value: 150 + sequence / 100 },
        ],
      },
    }));
  };
  emit();
  const interval = setInterval(emit, 100);
  feedIntervals.add(interval);
  socket.once("close", () => {
    clearInterval(interval);
    feedIntervals.delete(interval);
  });
});

const child = spawn(process.execPath, ["server/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...app.env,
    BOT_HOST: "127.0.0.1",
    BOT_PORT: String(port),
    DATA_DIR: observerDataDir,
    BTC_PAPER_STATE_PATH: observerPaperStatePath,
    PAPER_SESSION_STATE_PATH: path.join(observerDataDir, "paper-session-state.json"),
    REFERENCE_STATE_PATH: path.join(observerDataDir, "reference-wallet-state.json"),
    AGENT_RECOMMENDATIONS_PATH: path.join(observerDataDir, "agents", "recommendations.json"),
    MAIN_SIGNAL_DIR: signalDir,
    MAIN_SETTLEMENT_DIR: settlementDir,
    OBSERVER_CHECKPOINT_DIR: checkpointDir,
    OBSERVER_POLICY_PATH: policyPath,
    OBSERVER_STATE_PATH: settlementStatePath,
    ANTI_DOWNGRADE_REPORT_PATH: evidencePath,
    DIRECTION_SHADOW_DECISION_DIR: directionDecisionDir,
    DIRECTION_SHADOW_STATE_PATH: directionStatePath,
    DIRECTION_SHADOW_REPORT_PATH: directionReportPath,
    SETTLEMENT_OBSERVER_INTERVAL_MS: "1000",
    DIRECTION_SHADOW_MAX_OBSERVATION_DELAY_MS: "10000",
    BTC_PREDICTION_ENABLED: "0",
    MULTI_ASSET_PREDICTION_ENABLED: "0",
    EXTERNAL_PRICE_WS_URL: `ws://127.0.0.1:${feedPort}`,
    BINANCE_CONTEXT_FEATURE_ENABLED: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

async function stop() {
  if (child.exitCode === null) child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (child.exitCode === null) child.kill("SIGKILL");
}

try {
  let health = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (child.exitCode !== null) throw new Error(`v3747_observer_exited_early:${child.exitCode}\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        const candidate = await response.json();
        if (
          candidate.settlementObserver?.status === "ready" &&
          candidate.directionShadowObserver?.status === "ready" &&
          candidate.directionShadowObserver?.immutableDecisionCount === 1
        ) {
          health = candidate;
          break;
        }
      }
    } catch {}
  }
  if (!health?.ok) throw new Error(`v3747_observer_health_not_ready\n${output}`);
  if (health.botRole !== "checkpoint_observer") throw new Error(`v3747_observer_role_wrong:${health.botRole}`);
  if (health.botInstanceId !== "direction-settlement-observer-v3747") throw new Error("v3747_observer_instance_wrong");
  if (health.releaseVersion !== RELEASE) throw new Error("v3747_observer_release_wrong");
  if (health.settlementObserver.officialUniqueCount !== 1 || health.settlementObserver.coreOfficialUniqueCount !== 1) {
    throw new Error("v3747_observer_did_not_ingest_exact_official_core_row");
  }
  if (health.settlementObserver.reliable !== false) throw new Error("v3747_observer_promoted_before_evidence_gate");
  if (health.directionShadowObserver.forwardCausalDecisionCount !== 1 || health.directionShadowObserver.forwardOfficialMatches !== 0) {
    throw new Error("v3747_forward_decision_initial_contract_wrong");
  }
  if (health.directionShadowObserver.executionEligible !== false || health.directionShadowObserver.automaticPromotion !== false) {
    throw new Error("v3747_direction_observer_execution_contract_wrong");
  }
  if (health.paperState?.persistenceEnabled !== false || health.paperState?.observerTradingStatePersistenceForbidden !== true) {
    throw new Error("v3747_observer_trading_state_contract_wrong");
  }

  for (const requiredPath of [policyPath, settlementStatePath, evidencePath, directionStatePath, directionReportPath]) {
    if (!fs.existsSync(requiredPath)) throw new Error(`v3747_observer_artifact_missing:${requiredPath}`);
  }
  const decisionFiles = fs.readdirSync(directionDecisionDir).filter((name) => name.endsWith(".json"));
  if (decisionFiles.length !== 1) throw new Error(`v3747_immutable_decision_count_wrong:${decisionFiles.length}`);
  const decisionPath = path.join(directionDecisionDir, decisionFiles[0]);
  const decisionBytesBefore = fs.readFileSync(decisionPath, "utf8");
  const decision = JSON.parse(decisionBytesBefore);
  if (
    decision.sourceSignalId !== directionSignal.id ||
    decision.observerOnly !== true ||
    decision.executionEligible !== false ||
    decision.causalEligible !== true ||
    decision.sourceContract?.currentOrFutureOutcomeReadAtDecision !== false
  ) throw new Error("v3747_immutable_forward_decision_contract_wrong");

  const waitForWindowEndMs = Math.max(0, signalWindowEndMs - Date.now() + 25);
  await new Promise((resolve) => setTimeout(resolve, waitForWindowEndMs));
  fs.appendFileSync(settlementPath, `${JSON.stringify(officialSettlement(directionSignal))}\n`, "utf8");
  const settlementHashAfterAppend = sha256(settlementPath);

  let reconciledHealth = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const candidate = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    if (candidate.directionShadowObserver?.forwardOfficialMatches === 1) {
      reconciledHealth = candidate;
      break;
    }
  }
  if (!reconciledHealth) throw new Error(`v3747_official_reconciliation_not_observed\n${output}`);
  if (fs.readFileSync(decisionPath, "utf8") !== decisionBytesBefore) throw new Error("v3747_forward_decision_mutated_after_outcome");

  const report = JSON.parse(fs.readFileSync(directionReportPath, "utf8"));
  if (
    report.counts?.forwardCausalDecisions !== 1 ||
    report.counts?.forwardOfficialMatches !== 1 ||
    report.control?.samples !== 1 ||
    report.challenger?.samples !== 1
  ) throw new Error("v3747_direction_report_pairing_contract_wrong");
  if (
    report.observerOnly !== true ||
    report.executionEligible !== false ||
    report.automaticPromotion !== false ||
    report.promotion?.promotionEligible !== false ||
    report.promotion?.automaticPromotion !== false
  ) throw new Error("v3747_direction_report_promotion_contract_wrong");
  if (
    report.source?.syntheticDataUsed !== false ||
    report.source?.proxySettlementUsed !== false ||
    report.source?.futureOutcomeUsedAtDecision !== false ||
    report.source?.retrospectiveDecisionsCountedAsForward !== false
  ) throw new Error("v3747_direction_report_data_contract_wrong");
  if (
    report.isolation?.mainDirectionMutations !== 0 ||
    report.isolation?.mainStakeMutations !== 0 ||
    report.isolation?.mainEntryBlocks !== 0 ||
    report.isolation?.mainEntryCountChanges !== 0 ||
    report.isolation?.mainScanSlowdowns !== 0
  ) throw new Error("v3747_direction_report_main_isolation_wrong");

  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  if (policy.observerOnly !== true || policy.executionEligible !== false || policy.automaticPromotion !== false) {
    throw new Error("v3747_settlement_observer_role_contract_wrong");
  }
  if (policy.reliability?.promotionEligible !== false || policy.reliability?.executionEligible !== false) {
    throw new Error("v3747_settlement_policy_promotion_contract_wrong");
  }
  if (policy.source?.syntheticDataUsed !== false || policy.source?.proxySettlementUsed !== false) {
    throw new Error("v3747_settlement_observer_data_contract_wrong");
  }

  await new Promise((resolve) => setTimeout(resolve, 1_150));
  const secondHealth = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  if (secondHealth.settlementObserver?.newOfficialSettlements !== 0) throw new Error("v3747_observer_exactly_once_reread_failed");
  const positions = await (await fetch(`http://127.0.0.1:${port}/api/v3/positions`)).json();
  if (!Array.isArray(positions) || positions.length !== 0) throw new Error("v3747_observer_execution_detected");
  if (sha256(signalPath) !== signalHashBefore) throw new Error("v3747_observer_mutated_main_signal_source");
  if (sha256(settlementPath) !== settlementHashAfterAppend) throw new Error("v3747_observer_mutated_main_settlement_source");

  const observerSignalDir = path.join(observerDataDir, "signals");
  if (fs.existsSync(observerSignalDir) && fs.readdirSync(observerSignalDir).some((name) => name.endsWith(".jsonl"))) {
    throw new Error("v3747_observer_wrote_execution_signals");
  }
  if (fs.existsSync(observerPaperStatePath)) throw new Error("v3747_observer_wrote_main_trading_state");
  console.log(`V374.7 settlement + direction observer runtime smoke PASSED on port ${port}`);
} finally {
  await stop();
  for (const interval of feedIntervals) clearInterval(interval);
  await new Promise((resolve) => feedServer.close(resolve));
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
}
