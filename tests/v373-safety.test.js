import test from "node:test";
import assert from "node:assert/strict";
import { consumeEntryBudget, createEntryBudget } from "../server/execution/entryBudget.js";
import { provisionalProxyStatus, shouldTrainFromSettlement } from "../server/settlement/settlementPolicy.js";
import { validateV3744RuntimeConfig as validateV373RuntimeConfig } from "../server/config/runtimeConfig.js";

function validMain(overrides = {}) {
  return {
    BOT_ROLE: "main_test",
    DATA_DIR: "server/data-main-v3747",
    MAIN_SIGNAL_DIR: "server/data-main-v3747/signals",
    MAIN_SETTLEMENT_DIR: "server/data-main-v3747/settlements",
    OBSERVER_CHECKPOINT_DIR: "server/data-observer-v3747/research/canonical-checkpoints",
    OBSERVER_POLICY_PATH: "server/data-observer-v3747/policy/observer-policy-v3747.json",
    OBSERVER_STATE_PATH: "server/data-observer-v3747/observer/settlement-cursor-v3747.json",
    ANTI_DOWNGRADE_REPORT_PATH: "server/data-observer-v3747/reports/anti-downgrade-evidence-latest.json",
    DIRECTION_SHADOW_DECISION_DIR: "server/data-observer-v3747/research/direction-only-decisions",
    DIRECTION_SHADOW_STATE_PATH: "server/data-observer-v3747/observer/direction-only-cursor-v3747.json",
    DIRECTION_SHADOW_REPORT_PATH: "server/data-observer-v3747/reports/direction-only-shadow-latest.json",
    DIRECTION_SHADOW_ENABLED: "0",
    DIRECTION_SHADOW_EXECUTION_ENABLED: "0",
    DIRECTION_SHADOW_AUTOMATIC_PROMOTION: "0",
    DIRECTION_SHADOW_MAX_OBSERVATION_DELAY_MS: "10000",
    ANTI_DOWNGRADE_SHADOW_EXECUTION_ENABLED: "0",
    ANTI_DOWNGRADE_AUTOMATIC_PROMOTION: "0",
    MAIN_BEHAVIOR_POLICY_ID: "v3745-frozen-control",
    REAL_EXECUTION_MODE: "paper_shadow",
    REAL_MARKET_DATA_ONLY: "1",
    POLYMARKET_OFFICIAL_SETTLEMENT_ENABLED: "1",
    POLYMARKET_OFFICIAL_SETTLEMENT_REQUIRE: "1",
    OFFICIAL_CHAINLINK_REQUIRED: "1",
    EXTERNAL_PRICE_ANCHOR_ENABLED: "1",
    EXTERNAL_PRICE_WS_ENABLED: "1",
    EXTERNAL_PRICE_PRIMARY: "polymarket_chainlink_rtds",
    EXTERNAL_PRICE_SYMBOLS: "BTC,SOL",
    ORDERBOOK_WS_ENABLED: "1",
    ORDERBOOK_WS_FIRST: "1",
    ALLOW_SYNTHETIC_BOOK: "0",
    ALLOW_SYNTHETIC_PRICE: "0",
    FALLBACK_CAN_OPEN_POSITION: "0",
    BTC_LEARNING_FALLBACK_MODE: "0",
    SIMULATED_LATENCY_MS: "0",
    PAPER_ORDER_TYPE: "FAK",
    REAL_SHADOW_MAX_BOOK_AGE_MS: "1500",
    PAPER_MIN_RECORDED_FILL_USD: "1",
    PAPER_START_BALANCE: "40",
    PAPER_MAX_TRADE_USD: "8",
    DYNAMIC_EQUITY_SCALING_ENABLED: "1",
    DYNAMIC_EQUITY_SCALING_START_EQUITY: "40",
    MAX_TRADE_EQUITY_FRACTION: "0.15",
    MAX_TRADE_USD_HARD_CAP: "0",
    MAX_UNRESOLVED_RESERVE_FRACTION: "0.30",
    EQUITY_LANE_SCALING_ENABLED: "1",
    EQUITY_LANE_SCALING_BASE_EQUITY: "40",
    EQUITY_LANE_SCALING_START_EQUITY: "40",
    EQUITY_LANE_SCALING_CURVE: "0.50",
    EQUITY_LANE_SCALING_MAX_MULTIPLIER: "4",
    EQUITY_LANE_SCALING_REQUIRE_NORMAL_PROFIT_LOCK: "0",
    EQUITY_LANE_SCALING_REQUIRE_WS_BOOK: "1",
    PAPER_ONE_POSITION_PER_SLUG: "1",
    PAPER_HARD_CASH_LEDGER_ENABLED: "1",
    PAPER_RESERVE_ENTRY_FEES: "1",
    NO_STAKE_REDUCTION_MODE: "1",
    NO_ENTRY_REDUCTION_MODE: "1",
    NO_SCAN_SLOWDOWN_MODE: "1",
    NO_BLOCK_QUALITY_CANDIDATES: "1",
    CANDIDATE_QUALITY_ENABLED: "0",
    QUALITY_SAMPLE_GUARD_ENABLED: "0",
    V351_SIDE_COMPETITION_ENABLED: "0",
    FAST_GROWTH_MODE: "1",
    AGGRESSIVE_LEARNING_MODE: "1",
    VERY_AGGRESSIVE_SAMPLE_MODE: "0",
    RESEARCH_ANALYSIS_ENABLED: "0",
    BTC_PREDICTION_TARGET_WIN_RATE: "70",
    MULTI_ASSET_PREDICTION_SYMBOLS: "BTC,SOL",
    MULTI_ASSET_PREDICTION_TIMEFRAMES: "5M",
    MAIN_ACCURACY_LANE_ENABLED: "1",
    MAIN_ACCURACY_MIN_CONFIDENCE: "95",
    MAIN_ACCURACY_MIN_ENTRY_PRICE: "0.50",
    MAIN_ACCURACY_MAX_ENTRY_PRICE: "0.85",
    MAIN_ACCURACY_MIN_SECONDS_INTO_WINDOW: "75",
    MAIN_ACCURACY_MAX_SECONDS_INTO_WINDOW_EXCLUSIVE: "180",
    MAIN_ACCURACY_REQUIRE_MODEL_READY: "1",
    MAIN_ACCURACY_REQUIRE_DIRECTION_LOCK: "1",
    MAIN_ACCURACY_REQUIRE_CHAINLINK: "1",
    MAIN_ACCURACY_REQUIRE_OFFICIAL_TARGET: "1",
    MAIN_ACCURACY_REQUIRE_WS_BOOK: "1",
    MAIN_ACCURACY_MAX_CHAINLINK_AGE_MS: "2000",
    MAIN_ACCURACY_MAX_BOOK_AGE_MS: "1500",
    EXTERNAL_PRICE_MAX_AGE_MS: "2000",
    EXTERNAL_PRICE_WATCHDOG_ENABLED: "1",
    EXTERNAL_PRICE_WATCHDOG_INTERVAL_MS: "500",
    EXTERNAL_PRICE_WATCHDOG_STALE_AFTER_MS: "4500",
    EXTERNAL_PRICE_WATCHDOG_STARTUP_GRACE_MS: "6000",
    EXTERNAL_PRICE_WATCHDOG_RECONNECT_DELAY_MS: "250",
    EXTERNAL_PRICE_WATCHDOG_FUTURE_TOLERANCE_MS: "2000",
    EXTERNAL_PRICE_WATCHDOG_TRANSPORT_STALE_AFTER_MS: "12000",
    EXTERNAL_PRICE_WATCHDOG_PUBLISHER_STALE_AFTER_MS: "15000",
    EXTERNAL_PRICE_WATCHDOG_MAX_BACKOFF_MS: "10000",
    ENTRY_MAX_BOOK_AGE_MS: "1500",
    AGGRESSIVE_MIN_SECONDS_INTO_WINDOW: "60",
    AGGRESSIVE_MAX_SECONDS_INTO_WINDOW: "289",
    AGGRESSIVE_MIN_SECONDS_LEFT: "5",
    AGGRESSIVE_MAX_ENTRY_PRICE: "0.80",
    OPPOSITE_SIDE_EXPOSURE_GUARD_ENABLED: "1",
    STRATEGY_CURRENT_PREDICTION_ENABLED: "0",
    STRATEGY_DUAL_SIDE_ENABLED: "1",
    STRATEGY_PRICE_FIELD_ENABLED: "0",
    STRATEGY_ORDERBOOK_PRESSURE_ENABLED: "0",
    STRATEGY_STICKY_LAG_ENABLED: "0",
    STRATEGY_NEW_MEMBER_BAND_ENABLED: "0",
    STRATEGY_ENDCYCLE_SNIPER_ENABLED: "0",
    STRATEGY_EXECUTABLE_STRATEGIES: "dual_side_ev",
    STRATEGY_FORCE_ALLOW: "dual_side_ev",
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
    FAST_GROW_DEPTH_UTILIZATION: "1",
    FAST_GROW_SKIP_BELOW_MARKET_MIN: "1",
    INDEPENDENT_ASSET_EDGE_ENABLED: "1",
    INDEPENDENT_ASSET_MIN_NET_EDGE: "0.05",
    INDEPENDENT_ASSET_STRESS_SLIPPAGE_PER_SHARE: "0.005",
    ELIGIBILITY_EPISODE_ENABLED: "1",
    ELIGIBILITY_EPISODE_STRONG_ASSET_NET_EDGE: "0.075",
    ELIGIBILITY_EPISODE_NEAR_SNAPSHOTS: "3",
    ELIGIBILITY_EPISODE_STRONG_SNAPSHOTS: "2",
    ELIGIBILITY_EPISODE_MIN_CHAINLINK_EVENTS: "2",
    ELIGIBILITY_EPISODE_NEAR_DURATION_MS: "400",
    ELIGIBILITY_EPISODE_STRONG_DURATION_MS: "150",
    ELIGIBILITY_EPISODE_MAX_GAP_MS: "2000",
    COHORT_REGIME_GUARD_ENABLED: "1",
    COHORT_REGIME_GUARD_LOOKBACK: "3",
    COHORT_REGIME_GUARD_LOSS_TRIGGER: "2",
    COHORT_REGIME_GUARD_TTL_SETTLEMENTS: "3",
    SETTLEMENT_OBSERVER_ENABLED: "0",
    SETTLEMENT_OBSERVER_INTERVAL_MS: "5000",
    OBSERVER_POLICY_MAX_AGE_MS: "180000",
    OBSERVER_POLICY_MIN_COHORT_SAMPLES: "30",
    OBSERVER_POLICY_MIN_FORWARD_SAMPLES: "100",
    STAKE_RESET_ON_WIN_SAFE_ENABLED: "0",
    ADAPTIVE_LEARNING_ENABLED: "0",
    REPLAY_OPTIMIZER_ENABLED: "0",
    UQIE_ACTIVE_SIZING_ENABLED: "0",
    ACCURACY_RERANKER_ENABLED: "0",
    V361_APPLY_TO_LIVE_SELECTION: "0",
    EDGE_ENGINE_ENABLED: "0",
    EXECUTION_QUALITY_ENABLED: "0",
    SCAN_INTERVAL_MS: "500",
    HOT_MARKET_FAST_LANE_ENABLED: "1",
    HOT_MARKET_SCAN_INTERVAL_MS: "200",
    ULTRA_HOT_MARKET_SCAN_INTERVAL_MS: "100",
    PAPER_MAX_ENTRIES_PER_TICK: "8",
    MAX_ACTIVE_POSITIONS: "144",
    POST_RESET_STABILIZER_ENABLED: "0",
    REGIME_RERANKER_ENABLED: "0",
    BTC_PREDICTION_LEARNED_FILTER_ENABLED: "0",
    V361_SHADOW_ONLY: "0",
    LEARNING_BRAIN_ENABLED: "0",
    STRATEGY_AUTO_DISABLE_ENABLED: "0",
    STRATEGY_RUNTIME_AUTO_DISABLE_ENABLED: "0",
    RECOVERY_MODE_ENABLED: "0",
    STARTUP_PROTECTION_ENABLED: "0",
    PROFIT_LOCK_ENABLED: "0",
    CLUSTER_GUARD_ENABLED: "0",
    RECENT_LOSS_BRAKE_ENABLED: "0",
    V333_DRAWDOWN_GUARD_ENABLED: "0",
    PROGRESSIVE_STAKE_ENABLED: "0",
    EXPOSURE_GOVERNOR_ENABLED: "0",
    ...overrides,
  };
}

test("entry budget is global and cannot be over-consumed", () => {
  const budget = createEntryBudget(8);
  for (let index = 0; index < 8; index += 1) assert.equal(consumeEntryBudget(budget), true);
  assert.equal(budget.remaining, 0);
  assert.equal(consumeEntryBudget(budget), false);
});

test("proxy and no-fill results are excluded from learning", () => {
  assert.equal(provisionalProxyStatus(true), "paper_proxy_win");
  assert.equal(shouldTrainFromSettlement({ status: "paper_proxy_win", settlementSource: "proxy_binance_pending_official", paperStakeUsd: 3 }), false);
  assert.equal(shouldTrainFromSettlement({ status: "paper_win", settlementSource: "official_poly", officialSettlementUsed: true, executionStatus: "filled", filledStakeUsd: 3, paperStakeUsd: 3 }), true);
  assert.equal(shouldTrainFromSettlement({ status: "paper_win", settlementSource: "official_poly", officialSettlementUsed: true, executionStatus: "unfilled", filledStakeUsd: 0 }), false);
});

test("runtime config enforces paper-only real-data fastgrow", () => {
  assert.throws(() => validateV373RuntimeConfig(validMain({ REAL_EXECUTION_MODE: "real_order" })), /paper_only/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ NO_ENTRY_REDUCTION_MODE: "0" })), /fastgrow_no_reduction/);
  assert.equal(validateV373RuntimeConfig(validMain({ SCAN_INTERVAL_MS: "500" })), true);
});

test("runtime config locks the evidence-derived challenger invariants", () => {
  assert.throws(() => validateV373RuntimeConfig(validMain({ MAIN_ACCURACY_MIN_CONFIDENCE: "94" })), /confidence_floor/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ MAIN_ACCURACY_REQUIRE_DIRECTION_LOCK: "0" })), /direction_lock/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ ELIGIBILITY_EPISODE_NEAR_SNAPSHOTS: "4" })), /eligibility_episode_contract/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ INDEPENDENT_ASSET_MIN_NET_EDGE: "0.04" })), /independent_asset_edge_contract/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ MAIN_ACCURACY_MIN_SECONDS_INTO_WINDOW: "74" })), /entry_window/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ MULTI_ASSET_PREDICTION_SYMBOLS: "BTC,ETH,SOL" })), /evidence_symbols/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ MULTI_ASSET_PREDICTION_TIMEFRAMES: "5M,15M" })), /timeframe_must_be_5m/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ MAIN_ACCURACY_MAX_CHAINLINK_AGE_MS: "1999" })), /freshness_contract/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ MAIN_ACCURACY_MAX_BOOK_AGE_MS: "1499" })), /freshness_contract/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ NO_BLOCK_QUALITY_CANDIDATES: "0" })), /quality_candidates/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ V351_SIDE_COMPETITION_ENABLED: "1" })), /legacy_book_reranker/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ PAPER_MIN_RECORDED_FILL_USD: "0.99" })), /invalid_runtime_config|minimum_recorded_fill/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ MAIN_ACCURACY_MAX_ENTRY_PRICE: "0.84" })), /entry_price_ceiling/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ PAPER_HARD_CASH_LEDGER_ENABLED: "0" })), /hard_execution_invariant/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ PAPER_ONE_POSITION_PER_SLUG: "0" })), /hard_execution_invariant/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ OPPOSITE_SIDE_EXPOSURE_GUARD_ENABLED: "0" })), /hard_execution_invariant/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ STRATEGY_DUAL_SIDE_ENABLED: "0" })), /dual_side_candidate/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ STRATEGY_PRICE_FIELD_ENABLED: "1" })), /non_primary_strategy/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ POST_RESET_STABILIZER_ENABLED: "1" })), /hidden_entry_modifier/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ SCAN_INTERVAL_MS: "1000" })), /fast_scan_contract/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ FAST_GROW_EV_MIN_NET_EDGE: "0.04" })), /fastgrow_ev_policy_contract/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ FAST_GROW_EV_LANE_S_MAX_FRACTION: "0.16" })), /fastgrow_ev_policy_contract/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ DYNAMIC_EQUITY_SCALING_ENABLED: "0" })), /fastgrow_ev_invariant/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ PAPER_MAX_TRADE_USD: "6.5" })), /anti_plateau_compounding_contract/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ MAX_TRADE_USD_HARD_CAP: "1" })), /anti_plateau_compounding_contract/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ EQUITY_LANE_SCALING_CURVE: "0.6" })), /anti_plateau_compounding_contract/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ STAKE_RESET_ON_WIN_SAFE_ENABLED: "1" })), /ath_or_win_chasing/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ EXTERNAL_PRICE_WATCHDOG_ENABLED: "0" })), /watchdog_required/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ EXTERNAL_PRICE_WATCHDOG_STALE_AFTER_MS: "2000" })), /watchdog_contract/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ EXTERNAL_PRICE_WATCHDOG_STARTUP_GRACE_MS: "4000" })), /watchdog_contract/);
});

test("runtime config forbids synthetic, proxy-primary, and simulated latency", () => {
  assert.throws(() => validateV373RuntimeConfig(validMain({ ALLOW_SYNTHETIC_BOOK: "1" })), /synthetic_or_fallback_forbidden/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ EXTERNAL_PRICE_PRIMARY: "binance" })), /primary_price_source/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ EXTERNAL_PRICE_SYMBOLS: "BTC,ETH,SOL" })), /external_symbols/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ SIMULATED_LATENCY_MS: "250" })), /simulated_latency_forbidden/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ POLYMARKET_OFFICIAL_SETTLEMENT_ENABLED: "0" })), /official_settlement_required/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ ORDERBOOK_WS_FIRST: "0" })), /orderbook_ws_required/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ PAPER_ORDER_TYPE: "FOK" })), /invalid_paper_order_type/);
});

test("runtime config keeps main and observer data paths isolated", () => {
  assert.throws(() => validateV373RuntimeConfig(validMain({ MAIN_SETTLEMENT_DIR: "server/other-main/settlements" })), /settlement_path_must_follow/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ OBSERVER_POLICY_PATH: "server/data-main-v3747/policy.json" })), /data_paths_must_be_separate/);
});

test("standalone challenger rejects research-role activation", () => {
  assert.throws(() => validateV373RuntimeConfig(validMain({ VERY_AGGRESSIVE_SAMPLE_MODE: "1" })), /main_role_requires_aggressive_fastgrow/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ RESEARCH_ANALYSIS_ENABLED: "1" })), /main_role_cannot_write/);
  assert.throws(() => validateV373RuntimeConfig({ ...validMain(), BOT_ROLE: "aggressive_research" }), /invalid_bot_role/);
});

test("deprecated and unvalidated engines are rejected", () => {
  assert.throws(() => validateV373RuntimeConfig(validMain({ OPPOSITE_SIDE_EXPOSURE_ENABLED: "0" })), /deprecated_runtime_config_key/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ CALIBRATED_ENTRY_MODEL_ENABLED: "0" })), /legacy_calibration/);
  assert.throws(() => validateV373RuntimeConfig(validMain({ ADAPTIVE_LEARNING_ENABLED: "1" })), /unvalidated_engine_forbidden/);
});
