import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { validateV3746RuntimeConfig } from "../server/config/runtimeConfig.js";

const require = createRequire(import.meta.url);
const ecosystem = require(path.resolve("ecosystem.config.cjs"));
const apps = Array.isArray(ecosystem.apps) ? ecosystem.apps : [];
if (apps.length !== 2) throw new Error(`v3746_requires_exactly_two_apps:${apps.length}`);
const [main, observer] = apps;
const env = main.env || {};

function equal(actual, expected, label) {
  if (String(actual) !== String(expected)) throw new Error(`${label}:expected=${expected}:actual=${actual}`);
}

equal(main.name, "polymarket-main-v3746", "main_name");
equal(observer.name, "polymarket-settlement-observer-v3746", "observer_name");
equal(env.BOT_ROLE, "main_test", "main_role");
equal(env.BOT_INSTANCE_ID, "main-anti-downgrade-fastgrow-v3746", "main_instance");
equal(env.BOT_PORT, "8799", "main_port");
equal(env.DATA_DIR, "server/data-main-v3746", "main_data_dir");
equal(observer.env?.BOT_ROLE, "checkpoint_observer", "observer_role");
equal(observer.env?.BOT_INSTANCE_ID, "settlement-observer-v3746", "observer_instance");
equal(observer.env?.BOT_PORT, "8800", "observer_port");
equal(observer.env?.DATA_DIR, "server/data-observer-v3746", "observer_data_dir");
equal(env.BTC_PAPER_STATE_PATH, "server/data-main-v3746/btc-paper-state.json", "main_paper_state_path");
equal(observer.env?.BTC_PAPER_STATE_PATH, "server/data-observer-v3746/btc-paper-state.json", "observer_paper_state_path");
equal(env.PAPER_STATE_PERSISTENCE_ENABLED, "1", "main_state_persistence_enabled");
equal(observer.env?.PAPER_STATE_PERSISTENCE_ENABLED, "0", "observer_state_persistence_disabled");
equal(env.MAIN_BEHAVIOR_POLICY_ID, "v3745-frozen-control", "frozen_main_behavior");
equal(env.ANTI_DOWNGRADE_SHADOW_ENABLED, "1", "shadow_evidence_enabled");
equal(env.ANTI_DOWNGRADE_SHADOW_EXECUTION_ENABLED, "0", "shadow_execution_disabled");
equal(env.ANTI_DOWNGRADE_AUTOMATIC_PROMOTION, "0", "automatic_promotion_disabled");
equal(observer.env?.MAIN_ACCURACY_LANE_ENABLED, "0", "observer_execution_lane_disabled");
equal(observer.env?.SETTLEMENT_OBSERVER_ENABLED, "1", "observer_settlement_learner_enabled");
equal(env.SETTLEMENT_OBSERVER_ENABLED, "0", "main_observer_writer_disabled");

for (const [key, expected] of Object.entries({
  REAL_EXECUTION_MODE: "paper_shadow",
  REAL_MARKET_DATA_ONLY: "1",
  ALLOW_SYNTHETIC_BOOK: "0",
  ALLOW_SYNTHETIC_PRICE: "0",
  FALLBACK_CAN_OPEN_POSITION: "0",
  BTC_LEARNING_FALLBACK_MODE: "0",
  SIMULATED_LATENCY_MS: "0",
  PAPER_ORDER_TYPE: "FAK",
  PAPER_START_BALANCE: "40",
  PAPER_MAX_TRADE_USD: "8",
  PAPER_MIN_RECORDED_FILL_USD: "1",
  PAPER_ONE_POSITION_PER_SLUG: "1",
  PAPER_HARD_CASH_LEDGER_ENABLED: "1",
  PAPER_RESERVE_ENTRY_FEES: "1",
  REAL_SHADOW_MAX_BOOK_AGE_MS: "1500",
  MAX_TRADE_EQUITY_FRACTION: "0.15",
  MAX_TRADE_USD_HARD_CAP: "0",
  MAX_UNRESOLVED_RESERVE_FRACTION: "0.30",
  MAIN_ACCURACY_LANE_ENABLED: "1",
  MAIN_ACCURACY_MIN_CONFIDENCE: "95",
  MAIN_ACCURACY_MIN_ENTRY_PRICE: "0.50",
  MAIN_ACCURACY_MAX_ENTRY_PRICE: "0.85",
  MAIN_ACCURACY_MIN_SECONDS_INTO_WINDOW: "75",
  MAIN_ACCURACY_MAX_SECONDS_INTO_WINDOW_EXCLUSIVE: "180",
  MAIN_ACCURACY_REQUIRE_DIRECTION_LOCK: "1",
  CALIBRATED_ENTRY_MODEL_ENABLED: "1",
  LEGACY_CALIBRATION_EXECUTION_GATE_ENABLED: "0",
  REGIME_CORE_POLICY_ENABLED: "1",
  FAST_GROW_EV_POLICY_ENABLED: "1",
  FAST_GROW_EV_MIN_NET_EDGE: "0.05",
  FAST_GROW_EV_LANE_S_MIN_NET_EDGE: "0.10",
  FAST_GROW_EV_LANE_A_MIN_FRACTION: "0.08",
  FAST_GROW_EV_LANE_A_MAX_FRACTION: "0.10",
  FAST_GROW_EV_LANE_S_MIN_FRACTION: "0.12",
  FAST_GROW_EV_LANE_S_MAX_FRACTION: "0.15",
  FAST_GROW_EV_LANE_S_MAX_EDGE: "0.20",
  INDEPENDENT_ASSET_EDGE_ENABLED: "1",
  INDEPENDENT_ASSET_MIN_NET_EDGE: "0.05",
  COHORT_REGIME_GUARD_ENABLED: "1",
  COHORT_REGIME_GUARD_LOOKBACK: "3",
  COHORT_REGIME_GUARD_LOSS_TRIGGER: "2",
  COHORT_REGIME_GUARD_TTL_SETTLEMENTS: "3",
  PROFIT_LOCK_ENABLED: "0",
  RECENT_LOSS_BRAKE_ENABLED: "0",
  PROGRESSIVE_STAKE_ENABLED: "0",
  EXPOSURE_GOVERNOR_ENABLED: "0",
  BTC_PREDICTION_STRATEGY_VERSION: "v374.5-regime-core-fastgrow-paper",
  PAPER_STATE_HEARTBEAT_MS: "60000",
  AUDIT_SNAPSHOT_DEDUPE_MS: "1000",
  AUDIT_DECISION_DEDUPE_MS: "1000",
  AUDIT_STRATEGY_DEDUPE_MS: "1000",
  AUDIT_GATE_DEDUPE_MS: "1000",
  AUDIT_IDLE_OBSERVER_EVENT_DEDUPE_MS: "60000",
})) equal(env[key], expected, `v3746_contract_${key}`);

if (env.MIN_EXECUTABLE_STAKE_USD !== undefined && Number(env.MIN_EXECUTABLE_STAKE_USD) !== 0) {
  throw new Error("v3746_artificial_fixed_minimum_present");
}

validateV3746RuntimeConfig(env);
validateV3746RuntimeConfig(observer.env);
for (const invalid of [
  { ...env, ANTI_DOWNGRADE_SHADOW_EXECUTION_ENABLED: "1" },
  { ...env, ANTI_DOWNGRADE_AUTOMATIC_PROMOTION: "1" },
  { ...env, BTC_PAPER_STATE_PATH: observer.env.BTC_PAPER_STATE_PATH },
  { ...env, MAIN_BEHAVIOR_POLICY_ID: "unproven-live-policy" },
]) {
  let rejected = false;
  try { validateV3746RuntimeConfig(invalid); } catch { rejected = true; }
  if (!rejected) throw new Error("v3746_unsafe_runtime_override_not_rejected");
}

const source = fs.readFileSync("server/index.js", "utf8");
for (const required of [
  "evaluateRegimeCorePolicy",
  "buildRegimeCoreEconomics",
  "calculateActualMinimumStake",
  "maximumStakeWithinUnresolvedReserve",
  "evaluateCohortRegimeGuard",
  "createObserverPolicyReader",
  "createSettlementObserverLearner",
  "createPredictionPersistenceGate",
  "observer_role_never_executes",
  "legacyCalibrationGateEnabled: LEGACY_CALIBRATION_EXECUTION_GATE_ENABLED",
  "TRUE_MARKET_MINIMUM_TOO_LARGE_FOR_LANE_BUDGET",
  "capitalDeadlockBug: false",
  "current_realized_equity_not_peak_equity",
  "paper_slug_already_committed",
  "unresolved_reserve_hard_limit_after_fill",
  "excludedFromTradeHistoryAndWinRate: true",
  "paper_entry_committed",
]) if (!source.includes(required)) throw new Error(`required_v3746_wiring_missing:${required}`);

if (/Math\.max\(\s*3\s*,\s*MIN_EXECUTABLE_STAKE_USD/.test(source)) {
  throw new Error("v3746_legacy_three_dollar_floor_still_present");
}
if (/RealExecutor|\.placeOrder\s*\(/.test(source) || fs.existsSync("server/execution/realExecutor.js")) {
  throw new Error("real_order_execution_path_present");
}

for (const file of [
  "server/execution/marketMinimumStake.js",
  "server/prediction/regimeCorePolicy.js",
  "server/risk/cohortRegimeGuard.js",
  "server/research/observerPolicy.js",
  "server/research/antiDowngradeEvidence.js",
  "server/storage/predictionPersistence.js",
  "server/research/checkpointObserver.js",
  "server/execution/paperFill.js",
  "server/execution/paperCommitPolicy.js",
  "server/settlement/settlementPolicy.js",
  "tests/v3745-exact-market-minimum.test.js",
  "tests/v3745-regime-core.test.js",
  "tests/v3745-cohort-regime-guard.test.js",
  "tests/v3745-observer-policy.test.js",
  "tests/v3746-anti-downgrade-evidence.test.js",
  "tests/v3746-persistence-and-audit.test.js",
]) if (!fs.existsSync(file)) throw new Error(`required_module_missing:${file}`);

console.log("V374.6 anti-downgrade evidence paper semantic verification PASSED");
