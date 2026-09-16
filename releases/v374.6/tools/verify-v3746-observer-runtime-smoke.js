import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";

const require = createRequire(import.meta.url);
const ecosystem = require(path.resolve("ecosystem.config.cjs"));
const app = ecosystem.apps.find((item) => item.name === "polymarket-settlement-observer-v3746");
if (!app) throw new Error("v3746_observer_process_missing");

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

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v3746-observer-smoke-"));
const mainDataDir = path.join(runtimeRoot, "main");
const observerDataDir = path.join(runtimeRoot, "observer");
const settlementDir = path.join(mainDataDir, "settlements");
const checkpointDir = path.join(observerDataDir, "research", "canonical-checkpoints");
const policyPath = path.join(observerDataDir, "policy", "observer-policy-v3746.json");
const statePath = path.join(observerDataDir, "observer", "settlement-cursor-v3746.json");
const evidencePath = path.join(observerDataDir, "reports", "anti-downgrade-evidence-latest.json");
const observerPaperStatePath = path.join(observerDataDir, "btc-paper-state.json");
fs.mkdirSync(settlementDir, { recursive: true });
const settlementPath = path.join(settlementDir, "2026-07-19.jsonl");
fs.writeFileSync(settlementPath, `${JSON.stringify({
  id: "observer-smoke-signal-1",
  slug: "btc-updown-5m-observer-smoke-1",
  botRole: "main_test",
  strategyVersion: "v374.5-regime-core-fastgrow-paper",
  releaseVersion: "v374.6-anti-downgrade-evidence-full-paper",
  sourceType: "real_market",
  status: "paper_win",
  officialSettlementUsed: true,
  settlementSource: "official_poly",
  executionStatus: "filled",
  realParityEligible: true,
  learningEligible: true,
  filledStakeUsd: 4,
  paperStakeUsd: 4,
  paperPnlUsd: 2,
  symbol: "BTC",
  direction: "Up",
  confidence: 97,
  averageFillPrice: 0.60,
  regimeCorePolicy: { eligible: true },
  independentAssetEdgePolicy: { eligible: true },
  officialOutcome: "Up",
  settledAt: "2026-07-19T00:00:00.000Z",
})}\n`, "utf8");
const settlementHashBefore = sha256(settlementPath);

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
    MAIN_SETTLEMENT_DIR: settlementDir,
    OBSERVER_CHECKPOINT_DIR: checkpointDir,
    OBSERVER_POLICY_PATH: policyPath,
    OBSERVER_STATE_PATH: statePath,
    ANTI_DOWNGRADE_REPORT_PATH: evidencePath,
    SETTLEMENT_OBSERVER_INTERVAL_MS: "1000",
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
    if (child.exitCode !== null) throw new Error(`v3746_observer_exited_early:${child.exitCode}\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        const candidate = await response.json();
        if (candidate.settlementObserver?.status === "ready") { health = candidate; break; }
      }
    } catch {}
  }
  if (!health?.ok) throw new Error(`v3746_observer_health_not_ready\n${output}`);
  if (health.botRole !== "checkpoint_observer") throw new Error(`v3746_observer_role_wrong:${health.botRole}`);
  if (health.botInstanceId !== "settlement-observer-v3746") throw new Error("v3746_observer_instance_wrong");
  if (health.releaseVersion !== "v374.6-anti-downgrade-evidence-full-paper") throw new Error("v3746_observer_release_wrong");
  if (health.settlementObserver.officialUniqueCount !== 1 || health.settlementObserver.coreOfficialUniqueCount !== 1) {
    throw new Error("v3746_observer_did_not_ingest_exact_official_core_row");
  }
  if (health.settlementObserver.reliable !== false) throw new Error("v3746_observer_promoted_before_100_samples");
  if (health.paperState?.persistenceEnabled !== false || health.paperState?.observerTradingStatePersistenceForbidden !== true) {
    throw new Error("v3746_observer_trading_state_contract_wrong");
  }

  if (!fs.existsSync(policyPath) || !fs.existsSync(statePath) || !fs.existsSync(evidencePath)) {
    throw new Error("v3746_observer_policy_cursor_or_evidence_missing");
  }
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (policy.observerOnly !== true || policy.executionEligible !== false || policy.automaticPromotion !== false) {
    throw new Error("v3746_observer_role_contract_wrong");
  }
  if (policy.source?.syntheticDataUsed !== false || policy.source?.proxySettlementUsed !== false) {
    throw new Error("v3746_observer_data_contract_wrong");
  }
  if (policy.global?.samples !== 1 || policy.reliability?.reliable !== false) throw new Error("v3746_observer_policy_sample_contract_wrong");
  if (state.processedIds?.length !== 1 || state.officialUniqueCount !== 1) throw new Error("v3746_observer_cursor_contract_wrong");
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  if (evidence.observerOnly !== true || evidence.executionEligible !== false || evidence.automaticPromotion !== false) {
    throw new Error("v3746_anti_downgrade_evidence_execution_contract_wrong");
  }
  if (evidence.source?.syntheticDataUsed !== false || evidence.source?.proxySettlementUsed !== false) {
    throw new Error("v3746_anti_downgrade_evidence_data_contract_wrong");
  }

  await new Promise((resolve) => setTimeout(resolve, 1_150));
  const secondHealth = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  if (secondHealth.settlementObserver?.newOfficialSettlements !== 0) throw new Error("v3746_observer_exactly_once_reread_failed");
  const positions = await (await fetch(`http://127.0.0.1:${port}/api/v3/positions`)).json();
  if (!Array.isArray(positions) || positions.length !== 0) throw new Error("v3746_observer_execution_detected");
  if (sha256(settlementPath) !== settlementHashBefore) throw new Error("v3746_observer_mutated_main_settlement_source");

  const observerSignalDir = path.join(observerDataDir, "signals");
  if (fs.existsSync(observerSignalDir) && fs.readdirSync(observerSignalDir).some((name) => name.endsWith(".jsonl"))) {
    throw new Error("v3746_observer_wrote_execution_signals");
  }
  if (fs.existsSync(observerPaperStatePath)) throw new Error("v3746_observer_wrote_main_trading_state");
  console.log(`V374.6 settlement-observer runtime smoke PASSED on port ${port}`);
} finally {
  await stop();
  for (const interval of feedIntervals) clearInterval(interval);
  await new Promise((resolve) => feedServer.close(resolve));
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
}
