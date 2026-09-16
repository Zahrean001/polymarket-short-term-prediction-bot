import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";

const require = createRequire(import.meta.url);
const ecosystem = require(path.resolve("ecosystem.config.cjs"));
const app = ecosystem.apps.find((item) => item.name === "polymarket-main-v3746");
if (!app) throw new Error("v3746_main_process_missing");

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

const port = await freePort();
const externalFeedPort = await freePort();
const feedIntervals = new Set();
let externalFeedConnections = 0;
const externalFeedServer = await new Promise((resolve, reject) => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: externalFeedPort });
  server.once("listening", () => resolve(server));
  server.once("error", reject);
});
externalFeedServer.on("connection", (socket) => {
  externalFeedConnections += 1;
  const connectionNumber = externalFeedConnections;
  let sequence = 0;
  const emitPrices = () => {
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
  emitPrices();
  const interval = setInterval(emitPrices, 100);
  feedIntervals.add(interval);
  const stopFirstConnectionUpdates = connectionNumber === 1
    ? setTimeout(() => {
        clearInterval(interval);
        feedIntervals.delete(interval);
      }, 500)
    : null;
  socket.once("close", () => {
    clearInterval(interval);
    if (stopFirstConnectionUpdates) clearTimeout(stopFirstConnectionUpdates);
    feedIntervals.delete(interval);
  });
});
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "v3746-fastgrow-smoke-"));
const dataDir = path.join(runtimeRoot, "main");
const observerDataDir = path.join(runtimeRoot, "observer");
const child = spawn(process.execPath, ["server/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...app.env,
    BOT_HOST: "127.0.0.1",
    BOT_PORT: String(port),
    DATA_DIR: dataDir,
    BTC_PAPER_STATE_PATH: path.join(dataDir, "btc-paper-state.json"),
    PAPER_SESSION_STATE_PATH: path.join(dataDir, "paper-session-state.json"),
    REFERENCE_STATE_PATH: path.join(dataDir, "reference-wallet-state.json"),
    AGENT_RECOMMENDATIONS_PATH: path.join(dataDir, "agents", "recommendations.json"),
    MAIN_SETTLEMENT_DIR: path.join(dataDir, "settlements"),
    OBSERVER_CHECKPOINT_DIR: path.join(observerDataDir, "research", "canonical-checkpoints"),
    OBSERVER_POLICY_PATH: path.join(observerDataDir, "policy", "observer-policy-v3746.json"),
    OBSERVER_STATE_PATH: path.join(observerDataDir, "observer", "settlement-cursor-v3746.json"),
    ANTI_DOWNGRADE_REPORT_PATH: path.join(observerDataDir, "reports", "anti-downgrade-evidence-latest.json"),
    BTC_PREDICTION_ENABLED: "0",
    MULTI_ASSET_PREDICTION_ENABLED: "0",
    EXTERNAL_PRICE_WS_URL: `ws://127.0.0.1:${externalFeedPort}`,
    BINANCE_CONTEXT_FEATURE_ENABLED: "0",
    EXTERNAL_PRICE_WATCHDOG_INTERVAL_MS: "250",
    EXTERNAL_PRICE_WATCHDOG_STALE_AFTER_MS: "2200",
    EXTERNAL_PRICE_WATCHDOG_STARTUP_GRACE_MS: "2500",
    EXTERNAL_PRICE_WATCHDOG_RECONNECT_DELAY_MS: "50",
    EXTERNAL_PRICE_WATCHDOG_TRANSPORT_STALE_AFTER_MS: "4500",
    EXTERNAL_PRICE_WATCHDOG_PUBLISHER_STALE_AFTER_MS: "5000",
    EXTERNAL_PRICE_WATCHDOG_MAX_BACKOFF_MS: "1000",
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
    if (child.exitCode !== null) throw new Error(`v3746_exited_early:${child.exitCode}\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) { health = await response.json(); break; }
    } catch {}
  }
  if (!health?.ok) throw new Error(`v3746_health_not_ready\n${output}`);
  if (health.botRole !== "main_test") throw new Error(`v3746_role_wrong:${health.botRole}`);
  if (health.botInstanceId !== "main-anti-downgrade-fastgrow-v3746") throw new Error("v3746_instance_wrong");
  if (health.releaseVersion !== "v374.6-anti-downgrade-evidence-full-paper") throw new Error(`v3746_release_wrong:${health.releaseVersion}`);
  if (!/^[a-f0-9]{64}$/.test(health.configHash || "")) throw new Error("v3746_config_hash_missing");
  if (health.paperState?.persistenceEnabled !== true) throw new Error("v3746_main_state_persistence_inactive");
  if (path.resolve(health.paperState?.path || "") !== path.resolve(dataDir, "btc-paper-state.json")) {
    throw new Error("v3746_main_state_path_not_isolated");
  }

  let recoveredFeed = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const candidate = await response.json();
    if (
      externalFeedConnections >= 2 &&
      candidate.externalPriceFeed?.watchdogReconnects >= 1 &&
      candidate.externalPriceFeed?.healthy === true
    ) {
      recoveredFeed = candidate.externalPriceFeed;
      break;
    }
  }
  if (!recoveredFeed) {
    throw new Error(`v3746_silent_external_feed_not_recovered:connections=${externalFeedConnections}\n${output}`);
  }

  const configResponse = await fetch(`http://127.0.0.1:${port}/api/v3/effective-config`);
  const config = await configResponse.json();
  const critical = config.criticalConfig || {};
  if (critical.mainBehaviorPolicyId !== "v3745-frozen-control") throw new Error("v3746_main_behavior_not_frozen");
  if (critical.antiDowngradeShadowExecutionEnabled !== false || critical.antiDowngradeAutomaticPromotion !== false) {
    throw new Error("v3746_unproven_shadow_policy_can_affect_main");
  }
  if (critical.mainAccuracyLaneEnabled !== true) throw new Error("accuracy_lane_inactive");
  if (critical.mainAccuracyMinConfidence !== 95) throw new Error("regime_core_confidence_floor_wrong");
  if (critical.mainAccuracyMinEntryPrice !== 0.50) throw new Error("regime_core_price_floor_wrong");
  if (critical.mainAccuracyMaxEntryPrice !== 0.85) throw new Error("profitability_price_ceiling_wrong");
  if (critical.mainAccuracyMinSecondsIntoWindow !== 75 || critical.mainAccuracyMaxSecondsIntoWindowExclusive !== 180) {
    throw new Error("accuracy_window_wrong");
  }
  if (critical.mainAccuracyRequireDirectionLock !== true || critical.mainAccuracyRequireModelReady !== true) {
    throw new Error("accuracy_model_invariants_inactive");
  }
  if (critical.mainAccuracyMaxChainlinkAgeMs !== 2000 || critical.mainAccuracyMaxBookAgeMs !== 1500) {
    throw new Error("accuracy_freshness_contract_inactive");
  }
  if (
    critical.externalPriceWatchdogEnabled !== true ||
    critical.externalPriceWatchdogIntervalMs !== 250 ||
    critical.externalPriceWatchdogStaleAfterMs !== 2200 ||
    critical.externalPriceWatchdogStartupGraceMs !== 2500 ||
    critical.externalPriceWatchdogReconnectDelayMs !== 50 ||
    critical.externalPriceWatchdogTransportStaleAfterMs !== 4500 ||
    critical.externalPriceWatchdogPublisherStaleAfterMs !== 5000 ||
    critical.externalPriceWatchdogMaxBackoffMs !== 1000
  ) throw new Error("external_price_watchdog_contract_inactive");
  if (critical.officialChainlinkRequired !== true || critical.paperOrderType !== "FAK") throw new Error("real_parity_invariants_inactive");
  if (critical.paperStartBalanceUsd !== 40 || critical.paperMaxTradeUsd !== 8) throw new Error("paper_capital_contract_wrong");
  if (critical.dynamicEquityScalingEnabled !== true || critical.maxTradeEquityFraction !== 0.15 || critical.maxTradeUsdHardCap !== 0) {
    throw new Error("anti_plateau_dynamic_cap_inactive");
  }
  if (critical.maxUnresolvedReserveFraction !== 0.30) throw new Error("unresolved_reserve_cap_inactive");
  if (critical.regimeCorePolicyEnabled !== true || critical.legacyCalibrationExecutionGateEnabled !== false) {
    throw new Error("regime_core_or_legacy_telemetry_contract_inactive");
  }
  if (critical.cohortRegimeGuardEnabled !== true) throw new Error("cohort_regime_guard_inactive");
  if (
    critical.fastGrowEvPolicyEnabled !== true ||
    critical.fastGrowEvMinNetEdge !== 0.05 ||
    critical.fastGrowEvLaneSMinNetEdge !== 0.10 ||
    critical.fastGrowEvLaneAMinFraction !== 0.08 ||
    critical.fastGrowEvLaneAMaxFraction !== 0.10 ||
    critical.fastGrowEvLaneSMinFraction !== 0.12 ||
    critical.fastGrowEvLaneSMaxFraction !== 0.15
  ) throw new Error("fastgrow_ev_contract_inactive");
  if (critical.antiPlateauSizingBasis !== "current_realized_equity_not_peak_equity" || critical.antiPlateauMartingale !== false) {
    throw new Error("anti_plateau_sizing_basis_wrong");
  }
  if (critical.paperOnePositionPerSlug !== true || critical.paperHardCashLedgerEnabled !== true || critical.paperReserveEntryFees !== true) {
    throw new Error("paper_hard_cash_invariants_inactive");
  }
  if (critical.strategyCurrentPredictionEnabled !== false || critical.strategyDualSideEnabled !== true) throw new Error("dual_candidate_strategy_inactive");
  if (JSON.stringify(critical.strategyExecutableStrategies) !== JSON.stringify(["dual_side_ev"])) throw new Error("wrong_executable_strategy");
  if (critical.oppositeSideExposureGuardEnabled !== true) throw new Error("opposite_side_guard_inactive");
  if (
    critical.independentAssetEdgeEnabled !== true ||
    critical.independentAssetMinNetEdge !== 0.05 ||
    critical.independentAssetStressSlippagePerShare !== 0.005 ||
    critical.eligibilityEpisodeEnabled !== true ||
    critical.eligibilityEpisodeStrongAssetNetEdge !== 0.075 ||
    critical.eligibilityEpisodeNearSnapshots !== 3 ||
    critical.eligibilityEpisodeStrongSnapshots !== 2 ||
    critical.eligibilityEpisodeMinChainlinkEvents !== 2 ||
    critical.eligibilityEpisodeNearDurationMs !== 400 ||
    critical.eligibilityEpisodeStrongDurationMs !== 150 ||
    critical.orderBookRole !== "confirmation_and_ranking_only"
  ) throw new Error("eligibility_episode_contract_inactive");

  const accountResponse = await fetch(`http://127.0.0.1:${port}/api/v3/account`);
  const account = await accountResponse.json();
  if (account.antiPlateau?.martingale !== false) throw new Error("anti_plateau_runtime_martingale_flag_wrong");
  if (account.antiPlateau?.sizingBasis !== "current_realized_equity_not_peak_equity") throw new Error("anti_plateau_runtime_basis_wrong");
  if (account.antiPlateau?.currentEquityUsd !== 40 || account.antiPlateau?.currentDynamicCapUsd !== 8) {
    throw new Error("anti_plateau_runtime_initial_state_wrong");
  }
  if (account.antiPlateau?.staticUsdHardCapEnabled !== false) throw new Error("fixed_usd_cap_still_enabled");
  if (account.antiPlateau?.capitalDeadlockBug !== false || account.antiPlateau?.artificialFixedMinimumStakeUsd !== 0) {
    throw new Error("capital_deadlock_invariant_wrong");
  }

  console.log(`V374.6 anti-downgrade fast-grow runtime smoke PASSED on port ${port}`);
} finally {
  await stop();
  for (const interval of feedIntervals) clearInterval(interval);
  await new Promise((resolve) => externalFeedServer.close(resolve));
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
}
