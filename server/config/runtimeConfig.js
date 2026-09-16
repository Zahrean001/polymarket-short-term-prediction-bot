import path from "node:path";

const FORBIDDEN_DEPRECATED_KEYS = [
  "OPPOSITE_SIDE_EXPOSURE_ENABLED",
];

const VALID_BOT_ROLES = new Set(["main_test", "checkpoint_observer"]);

function assertNumberInRange(env, key, min, max) {
  if (env[key] === undefined) return;
  const value = Number(env[key]);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`invalid_runtime_config:${key}:${env[key]}`);
  }
}

function pathIsWithin(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function validateV3747RuntimeConfig(env = process.env) {
  const botRole = env.BOT_ROLE || "main_test";
  if (!VALID_BOT_ROLES.has(botRole)) throw new Error(`invalid_bot_role:${botRole}`);
  for (const key of FORBIDDEN_DEPRECATED_KEYS) {
    if (env[key] !== undefined && env[key] !== "") {
      throw new Error(`deprecated_runtime_config_key:${key}`);
    }
  }
  assertNumberInRange(env, "SCAN_INTERVAL_MS", 50, 60_000);
  assertNumberInRange(env, "PAPER_MAX_ENTRIES_PER_TICK", 1, 64);
  assertNumberInRange(env, "MAX_ACTIVE_POSITIONS", 1, 10_000);
  assertNumberInRange(env, "EXTERNAL_PRICE_MAX_AGE_MS", 50, 30_000);
  assertNumberInRange(env, "EXTERNAL_PRICE_WATCHDOG_INTERVAL_MS", 250, 10_000);
  assertNumberInRange(env, "EXTERNAL_PRICE_WATCHDOG_STALE_AFTER_MS", 500, 30_000);
  assertNumberInRange(env, "EXTERNAL_PRICE_WATCHDOG_STARTUP_GRACE_MS", 500, 60_000);
  assertNumberInRange(env, "EXTERNAL_PRICE_WATCHDOG_RECONNECT_DELAY_MS", 0, 10_000);
  assertNumberInRange(env, "EXTERNAL_PRICE_WATCHDOG_FUTURE_TOLERANCE_MS", 0, 30_000);
  assertNumberInRange(env, "EXTERNAL_PRICE_WATCHDOG_TRANSPORT_STALE_AFTER_MS", 1_000, 120_000);
  assertNumberInRange(env, "EXTERNAL_PRICE_WATCHDOG_PUBLISHER_STALE_AFTER_MS", 1_000, 120_000);
  assertNumberInRange(env, "EXTERNAL_PRICE_WATCHDOG_MAX_BACKOFF_MS", 250, 120_000);
  assertNumberInRange(env, "V372_EXTERNAL_MIN_RETURN_SAMPLES", 2, 600);
  assertNumberInRange(env, "V372_MAX_ANCHOR_CAPTURE_DELAY_MS", 0, 30_000);
  assertNumberInRange(env, "RESEARCH_SAMPLE_BUCKET_SECONDS", 5, 300);
  assertNumberInRange(env, "PAPER_MAX_SLIPPAGE_CENTS", 0, 10);
  assertNumberInRange(env, "PAPER_CRYPTO_TAKER_FEE_RATE", 0, 0.25);
  assertNumberInRange(env, "PAPER_MIN_RECORDED_FILL_USD", 1, 1_000_000);
  assertNumberInRange(env, "PAPER_START_BALANCE", 3, 1_000_000_000);
  assertNumberInRange(env, "PAPER_MAX_TRADE_USD", 1, 1_000_000_000);
  // Zero is the explicit V374.5 sentinel for "no fixed USD ceiling". Current
  // realized equity, lane fraction, cash+fee reserve, and observed depth remain
  // hard bounds.
  assertNumberInRange(env, "MAX_TRADE_USD_HARD_CAP", 0, 1_000_000_000);
  assertNumberInRange(env, "MAX_TRADE_EQUITY_FRACTION", 0.01, 1);
  assertNumberInRange(env, "MAX_UNRESOLVED_RESERVE_FRACTION", 0.01, 1);
  assertNumberInRange(env, "FAST_GROW_EV_MIN_NET_EDGE", 0.01, 0.50);
  assertNumberInRange(env, "FAST_GROW_EV_LANE_S_MIN_NET_EDGE", 0.01, 0.50);
  assertNumberInRange(env, "FAST_GROW_EV_LANE_A_MIN_FRACTION", 0.01, 1);
  assertNumberInRange(env, "FAST_GROW_EV_LANE_A_MAX_FRACTION", 0.01, 1);
  assertNumberInRange(env, "FAST_GROW_EV_LANE_S_MIN_FRACTION", 0.01, 1);
  assertNumberInRange(env, "FAST_GROW_EV_LANE_S_MAX_FRACTION", 0.01, 1);
  assertNumberInRange(env, "FAST_GROW_EV_LANE_S_MAX_EDGE", 0.01, 0.75);
  assertNumberInRange(env, "FAST_GROW_DEPTH_UTILIZATION", 0.10, 1);
  assertNumberInRange(env, "INDEPENDENT_ASSET_MIN_NET_EDGE", 0.01, 0.50);
  assertNumberInRange(env, "INDEPENDENT_ASSET_STRESS_SLIPPAGE_PER_SHARE", 0, 0.10);
  assertNumberInRange(env, "ELIGIBILITY_EPISODE_STRONG_ASSET_NET_EDGE", 0.05, 0.50);
  assertNumberInRange(env, "ELIGIBILITY_EPISODE_NEAR_SNAPSHOTS", 2, 8);
  assertNumberInRange(env, "ELIGIBILITY_EPISODE_STRONG_SNAPSHOTS", 2, 8);
  assertNumberInRange(env, "ELIGIBILITY_EPISODE_MIN_CHAINLINK_EVENTS", 2, 8);
  assertNumberInRange(env, "ELIGIBILITY_EPISODE_NEAR_DURATION_MS", 0, 10_000);
  assertNumberInRange(env, "ELIGIBILITY_EPISODE_STRONG_DURATION_MS", 0, 10_000);
  assertNumberInRange(env, "ELIGIBILITY_EPISODE_MAX_GAP_MS", 250, 30_000);
  assertNumberInRange(env, "MAIN_ACCURACY_MAX_ENTRY_PRICE", 0.50, 0.99);
  assertNumberInRange(env, "MAIN_ACCURACY_MIN_ENTRY_PRICE", 0.01, 0.98);
  assertNumberInRange(env, "MAIN_ACCURACY_MIN_CONFIDENCE", 50, 99);
  assertNumberInRange(env, "MAIN_ACCURACY_MIN_SECONDS_INTO_WINDOW", 0, 288);
  assertNumberInRange(env, "MAIN_ACCURACY_MAX_SECONDS_INTO_WINDOW_EXCLUSIVE", 121, 300);
  assertNumberInRange(env, "MAIN_ACCURACY_MAX_CHAINLINK_AGE_MS", 50, 2_000);
  assertNumberInRange(env, "MAIN_ACCURACY_MAX_BOOK_AGE_MS", 50, 2_000);
  assertNumberInRange(env, "REAL_SHADOW_MAX_BOOK_AGE_MS", 50, 2_000);
  assertNumberInRange(env, "SETTLEMENT_OBSERVER_INTERVAL_MS", 1_000, 60_000);
  assertNumberInRange(env, "DIRECTION_SHADOW_MAX_OBSERVATION_DELAY_MS", 1_000, 30_000);
  assertNumberInRange(env, "OBSERVER_POLICY_MAX_AGE_MS", 10_000, 3_600_000);
  assertNumberInRange(env, "OBSERVER_POLICY_MIN_COHORT_SAMPLES", 1, 10_000);
  assertNumberInRange(env, "OBSERVER_POLICY_MIN_FORWARD_SAMPLES", 100, 100_000);
  assertNumberInRange(env, "COHORT_REGIME_GUARD_LOOKBACK", 3, 100);
  assertNumberInRange(env, "COHORT_REGIME_GUARD_LOSS_TRIGGER", 1, 100);
  assertNumberInRange(env, "COHORT_REGIME_GUARD_TTL_SETTLEMENTS", 1, 100);
  assertNumberInRange(env, "PAPER_STATE_HEARTBEAT_MS", 5_000, 600_000);
  assertNumberInRange(env, "AUDIT_SNAPSHOT_DEDUPE_MS", 0, 60_000);
  assertNumberInRange(env, "AUDIT_DECISION_DEDUPE_MS", 0, 60_000);
  assertNumberInRange(env, "AUDIT_STRATEGY_DEDUPE_MS", 0, 60_000);
  assertNumberInRange(env, "AUDIT_GATE_DEDUPE_MS", 0, 60_000);
  assertNumberInRange(env, "AUDIT_IDLE_OBSERVER_EVENT_DEDUPE_MS", 0, 600_000);
  if ((env.REAL_EXECUTION_MODE || "paper_shadow") !== "paper_shadow") {
    throw new Error("v373_package_is_paper_only:REAL_EXECUTION_MODE");
  }
  if (env.REAL_MARKET_DATA_ONLY === "0") throw new Error("v373_real_market_data_only_required");
  if (env.POLYMARKET_OFFICIAL_SETTLEMENT_ENABLED !== "1" || env.POLYMARKET_OFFICIAL_SETTLEMENT_REQUIRE !== "1") {
    throw new Error("v373_official_settlement_required");
  }
  if (env.OFFICIAL_CHAINLINK_REQUIRED === "0") throw new Error("v373_official_chainlink_required");
  if (env.EXTERNAL_PRICE_ANCHOR_ENABLED === "0" || env.EXTERNAL_PRICE_WS_ENABLED === "0") {
    throw new Error("v373_official_price_feed_must_be_enabled");
  }
  if (env.ORDERBOOK_WS_ENABLED !== "1" || env.ORDERBOOK_WS_FIRST !== "1") throw new Error("v373_orderbook_ws_required");
  if (env.EXTERNAL_PRICE_PRIMARY && env.EXTERNAL_PRICE_PRIMARY !== "polymarket_chainlink_rtds") {
    throw new Error("v373_primary_price_source_must_be_polymarket_chainlink_rtds");
  }
  const unsupportedSymbols = String(env.EXTERNAL_PRICE_SYMBOLS || "BTC,ETH,SOL,XRP")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
    .filter((value) => !["BTC", "ETH", "SOL", "XRP"].includes(value));
  if (unsupportedSymbols.length) throw new Error(`v373_chainlink_symbol_unsupported:${unsupportedSymbols.join(",")}`);
  for (const key of ["ALLOW_SYNTHETIC_BOOK", "ALLOW_SYNTHETIC_PRICE", "FALLBACK_CAN_OPEN_POSITION", "BTC_LEARNING_FALLBACK_MODE"]) {
    if (env[key] === "1") throw new Error(`v373_synthetic_or_fallback_forbidden:${key}`);
  }
  if (Number(env.SIMULATED_LATENCY_MS || 0) !== 0) throw new Error("v373_simulated_latency_forbidden");
  if (Number(env.MIN_EXECUTABLE_STAKE_USD || 0) !== 0) throw new Error("v3745_artificial_fixed_minimum_stake_forbidden");
  if (String(env.PAPER_ORDER_TYPE || "").toUpperCase() !== "FAK") {
    throw new Error(`v373_invalid_paper_order_type:${env.PAPER_ORDER_TYPE}`);
  }
  const dataDir = env.DATA_DIR;
  const mainSignalDir = env.MAIN_SIGNAL_DIR;
  const mainSettlementDir = env.MAIN_SETTLEMENT_DIR;
  const observerCheckpointDir = env.OBSERVER_CHECKPOINT_DIR;
  const observerPolicyPath = env.OBSERVER_POLICY_PATH;
  const observerStatePath = env.OBSERVER_STATE_PATH;
  const paperStatePath = env.BTC_PAPER_STATE_PATH || (dataDir ? path.join(dataDir, "btc-paper-state.json") : "");
  const paperSessionStatePath = env.PAPER_SESSION_STATE_PATH || (dataDir ? path.join(dataDir, "paper-session-state.json") : "");
  const referenceStatePath = env.REFERENCE_STATE_PATH || (dataDir ? path.join(dataDir, "reference-wallet-state.json") : "");
  const agentRecommendationsPath = env.AGENT_RECOMMENDATIONS_PATH || (dataDir ? path.join(dataDir, "agents", "recommendations.json") : "");
  const antiDowngradeReportPath = env.ANTI_DOWNGRADE_REPORT_PATH || (
    observerPolicyPath ? path.join(path.dirname(path.dirname(observerPolicyPath)), "reports", "anti-downgrade-evidence-latest.json") : ""
  );
  const directionShadowDecisionDir = env.DIRECTION_SHADOW_DECISION_DIR;
  const directionShadowStatePath = env.DIRECTION_SHADOW_STATE_PATH;
  const directionShadowReportPath = env.DIRECTION_SHADOW_REPORT_PATH;
  if (
    !dataDir || !mainSignalDir || !mainSettlementDir || !observerCheckpointDir || !observerPolicyPath ||
    !observerStatePath || !directionShadowDecisionDir || !directionShadowStatePath || !directionShadowReportPath
  ) {
    throw new Error("v3747_runtime_data_paths_required");
  }
  for (const roleStatePath of [paperStatePath, paperSessionStatePath, referenceStatePath, agentRecommendationsPath]) {
    if (!roleStatePath || !pathIsWithin(dataDir, roleStatePath)) {
      throw new Error("v3746_role_state_path_must_follow_role_data_dir");
    }
  }
  if (
    env.ANTI_DOWNGRADE_SHADOW_EXECUTION_ENABLED === "1" ||
    env.ANTI_DOWNGRADE_AUTOMATIC_PROMOTION === "1" ||
    env.DIRECTION_SHADOW_EXECUTION_ENABLED === "1" ||
    env.DIRECTION_SHADOW_AUTOMATIC_PROMOTION === "1"
  ) {
    throw new Error("v3747_observer_policy_cannot_execute_or_auto_promote");
  }
  if (env.MAIN_BEHAVIOR_POLICY_ID && env.MAIN_BEHAVIOR_POLICY_ID !== "v3745-frozen-control") {
    throw new Error("v3746_main_behavior_must_remain_v3745_frozen_control");
  }
  if (botRole === "main_test") {
    if (!pathIsWithin(dataDir, mainSignalDir)) throw new Error("v3747_main_signal_path_must_follow_main_data_dir");
    if (!pathIsWithin(dataDir, mainSettlementDir)) throw new Error("v3745_main_settlement_path_must_follow_main_data_dir");
    for (const observerPath of [
      observerCheckpointDir,
      observerPolicyPath,
      observerStatePath,
      antiDowngradeReportPath,
      directionShadowDecisionDir,
      directionShadowStatePath,
      directionShadowReportPath,
    ]) {
      if (pathIsWithin(dataDir, observerPath)) throw new Error("v3745_main_and_observer_data_paths_must_be_separate");
    }
    if (env.DIRECTION_SHADOW_ENABLED !== "0") throw new Error("v3747_main_cannot_run_direction_shadow_writer");
    if ((env.PAPER_STATE_PERSISTENCE_ENABLED || "1") !== "1") throw new Error("v3746_main_state_persistence_required");
  } else {
    if (pathIsWithin(dataDir, mainSignalDir)) throw new Error("v3747_observer_cannot_read_signals_from_its_own_data_dir");
    if (pathIsWithin(dataDir, mainSettlementDir)) throw new Error("v3745_observer_cannot_read_settlements_from_its_own_data_dir");
    if (path.resolve(path.dirname(mainSignalDir)) !== path.resolve(path.dirname(mainSettlementDir))) {
      throw new Error("v3747_main_signal_and_settlement_roots_must_match");
    }
    for (const observerPath of [
      observerCheckpointDir,
      observerPolicyPath,
      observerStatePath,
      antiDowngradeReportPath,
      directionShadowDecisionDir,
      directionShadowStatePath,
      directionShadowReportPath,
    ]) {
      if (!pathIsWithin(dataDir, observerPath)) throw new Error("v3745_observer_artifacts_must_follow_observer_data_dir");
    }
    if (env.DIRECTION_SHADOW_ENABLED !== "1") throw new Error("v3747_observer_direction_shadow_required");
    if ((env.PAPER_STATE_PERSISTENCE_ENABLED || "0") !== "0") throw new Error("v3746_observer_trading_state_persistence_forbidden");
  }
  if (Number(env.DIRECTION_SHADOW_MAX_OBSERVATION_DELAY_MS) < 2 * Number(env.SETTLEMENT_OBSERVER_INTERVAL_MS)) {
    throw new Error("v3747_direction_shadow_delay_must_cover_two_observer_ticks");
  }
  for (const key of [
    "ADAPTIVE_LEARNING_ENABLED",
    "REPLAY_OPTIMIZER_ENABLED",
    "UQIE_ACTIVE_SIZING_ENABLED",
    "ACCURACY_RERANKER_ENABLED",
    "V361_APPLY_TO_LIVE_SELECTION",
    "EDGE_ENGINE_ENABLED",
    "EXECUTION_QUALITY_ENABLED",
  ]) {
    if (env[key] === "1") throw new Error(`v373_unvalidated_engine_forbidden:${key}`);
  }
  if (env.ENTRY_REFRESH_BEFORE_OPEN === "1" || env.ENTRY_REST_FALLBACK_BEFORE_OPEN === "1") {
    throw new Error("v373_blocking_entry_refresh_forbidden");
  }
  if (env.NO_STAKE_REDUCTION_MODE !== "1" || env.NO_ENTRY_REDUCTION_MODE !== "1" || env.NO_SCAN_SLOWDOWN_MODE !== "1" || env.FAST_GROWTH_MODE !== "1") {
    throw new Error("v373_fastgrow_no_reduction_profile_required");
  }
  if (botRole === "main_test") {
    if (env.AGGRESSIVE_LEARNING_MODE !== "1" || env.VERY_AGGRESSIVE_SAMPLE_MODE === "1") {
      throw new Error("v373_main_role_requires_aggressive_fastgrow_not_absolute_sampling");
    }
    if (env.RESEARCH_ANALYSIS_ENABLED === "1") {
      throw new Error("v373_main_role_cannot_write_research_artifacts");
    }
    if (Number(env.BTC_PREDICTION_TARGET_WIN_RATE || env.AGGRESSIVE_TARGET_WIN_RATE || 0) < 70) {
      throw new Error("v373_main_target_win_rate_below_70");
    }
    for (const key of [
      "MAIN_ACCURACY_LANE_ENABLED",
      "MAIN_ACCURACY_REQUIRE_MODEL_READY",
      "MAIN_ACCURACY_REQUIRE_CHAINLINK",
      "MAIN_ACCURACY_REQUIRE_OFFICIAL_TARGET",
      "MAIN_ACCURACY_REQUIRE_WS_BOOK",
    ]) {
      if (env[key] !== "1") throw new Error(`v3731_main_accuracy_invariant_required:${key}`);
    }
    if (env.CALIBRATED_ENTRY_MODEL_ENABLED !== "1" || env.LEGACY_CALIBRATION_EXECUTION_GATE_ENABLED !== "0") {
      throw new Error("v3745_legacy_calibration_must_be_telemetry_only");
    }
    if (env.REGIME_CORE_POLICY_ENABLED !== "1") {
      throw new Error("v3745_regime_core_policy_required");
    }
    if (env.EXTERNAL_PRICE_WATCHDOG_ENABLED !== "1") {
      throw new Error("v3744_external_price_watchdog_required");
    }
    const watchdogIntervalMs = Number(env.EXTERNAL_PRICE_WATCHDOG_INTERVAL_MS);
    const watchdogStaleAfterMs = Number(env.EXTERNAL_PRICE_WATCHDOG_STALE_AFTER_MS);
    const watchdogStartupGraceMs = Number(env.EXTERNAL_PRICE_WATCHDOG_STARTUP_GRACE_MS);
    const watchdogReconnectDelayMs = Number(env.EXTERNAL_PRICE_WATCHDOG_RECONNECT_DELAY_MS);
    const watchdogTransportStaleAfterMs = Number(env.EXTERNAL_PRICE_WATCHDOG_TRANSPORT_STALE_AFTER_MS);
    const watchdogPublisherStaleAfterMs = Number(env.EXTERNAL_PRICE_WATCHDOG_PUBLISHER_STALE_AFTER_MS);
    const watchdogMaxBackoffMs = Number(env.EXTERNAL_PRICE_WATCHDOG_MAX_BACKOFF_MS);
    if (
      watchdogStaleAfterMs <= Number(env.EXTERNAL_PRICE_MAX_AGE_MS) ||
      watchdogIntervalMs > watchdogStaleAfterMs / 2 ||
      watchdogStartupGraceMs < watchdogStaleAfterMs ||
      watchdogReconnectDelayMs > 2_000 ||
      watchdogTransportStaleAfterMs < 2 * watchdogStaleAfterMs ||
      watchdogPublisherStaleAfterMs < watchdogTransportStaleAfterMs ||
      watchdogMaxBackoffMs < watchdogReconnectDelayMs
    ) {
      throw new Error("v3744_external_price_watchdog_contract_mismatch");
    }
    for (const key of ["FAST_GROW_EV_POLICY_ENABLED", "FAST_GROW_SKIP_BELOW_MARKET_MIN", "DYNAMIC_EQUITY_SCALING_ENABLED", "EQUITY_LANE_SCALING_ENABLED"]) {
      if (env[key] !== "1") throw new Error(`v3744_fastgrow_ev_invariant_required:${key}`);
    }
    if (
      Number(env.FAST_GROW_EV_MIN_NET_EDGE) !== 0.05 ||
      Number(env.FAST_GROW_EV_LANE_S_MIN_NET_EDGE) !== 0.10 ||
      Number(env.FAST_GROW_EV_LANE_A_MIN_FRACTION) !== 0.08 ||
      Number(env.FAST_GROW_EV_LANE_A_MAX_FRACTION) !== 0.10 ||
      Number(env.FAST_GROW_EV_LANE_S_MIN_FRACTION) !== 0.12 ||
      Number(env.FAST_GROW_EV_LANE_S_MAX_FRACTION) !== 0.15 ||
      Number(env.FAST_GROW_EV_LANE_S_MAX_EDGE) !== 0.20 ||
      Number(env.FAST_GROW_DEPTH_UTILIZATION) !== 1
    ) {
      throw new Error("v3744_fastgrow_ev_policy_contract_mismatch");
    }
    if (
      Number(env.DYNAMIC_EQUITY_SCALING_START_EQUITY) !== Number(env.PAPER_START_BALANCE) ||
      Number(env.PAPER_MAX_TRADE_USD) !== 8 ||
      Number(env.MAX_TRADE_EQUITY_FRACTION) !== 0.15 ||
      Number(env.MAX_TRADE_USD_HARD_CAP) !== 0 ||
      Number(env.MAX_UNRESOLVED_RESERVE_FRACTION) !== 0.30 ||
      Number(env.EQUITY_LANE_SCALING_BASE_EQUITY) !== Number(env.PAPER_START_BALANCE) ||
      Number(env.EQUITY_LANE_SCALING_START_EQUITY) !== Number(env.PAPER_START_BALANCE) ||
      Number(env.EQUITY_LANE_SCALING_CURVE) !== 0.50 ||
      Number(env.EQUITY_LANE_SCALING_MAX_MULTIPLIER) !== 4 ||
      env.EQUITY_LANE_SCALING_REQUIRE_NORMAL_PROFIT_LOCK !== "0" ||
      env.EQUITY_LANE_SCALING_REQUIRE_WS_BOOK !== "1"
    ) {
      throw new Error("v3744_anti_plateau_compounding_contract_mismatch");
    }
    if (env.STAKE_RESET_ON_WIN_SAFE_ENABLED !== "0") {
      throw new Error("v3744_ath_or_win_chasing_must_be_disabled");
    }
    if (env.MAIN_ACCURACY_REQUIRE_DIRECTION_LOCK !== "1") {
      throw new Error("v3745_independent_direction_lock_required");
    }
    if (Number(env.MAIN_ACCURACY_MIN_CONFIDENCE) !== 95) {
      throw new Error("v3745_regime_core_confidence_floor_must_be_95");
    }
    const minSeconds = Number(env.MAIN_ACCURACY_MIN_SECONDS_INTO_WINDOW);
    const maxSeconds = Number(env.MAIN_ACCURACY_MAX_SECONDS_INTO_WINDOW_EXCLUSIVE);
    if (minSeconds !== 75 || maxSeconds !== 180 || minSeconds >= maxSeconds) {
      throw new Error("v3744_entry_window_must_be_75_to_179");
    }
    const symbols = String(env.MULTI_ASSET_PREDICTION_SYMBOLS || "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
    if (symbols.join(",") !== "BTC,SOL") throw new Error("v3731_main_accuracy_evidence_symbols_must_be_btc_sol");
    const externalSymbols = String(env.EXTERNAL_PRICE_SYMBOLS || "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
    if (externalSymbols.join(",") !== "BTC,SOL") throw new Error("v3731_main_accuracy_external_symbols_must_be_btc_sol");
    const timeframes = String(env.MULTI_ASSET_PREDICTION_TIMEFRAMES || "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
    if (timeframes.join(",") !== "5M") throw new Error("v3731_main_accuracy_timeframe_must_be_5m");
    if (Number(env.MAIN_ACCURACY_MAX_CHAINLINK_AGE_MS) !== 2000 || Number(env.MAIN_ACCURACY_MAX_BOOK_AGE_MS) !== 1500 || Number(env.EXTERNAL_PRICE_MAX_AGE_MS) !== 2000 || Number(env.ENTRY_MAX_BOOK_AGE_MS) !== 1500) {
      throw new Error("v3731_main_accuracy_freshness_contract_mismatch");
    }
    if (Number(env.REAL_SHADOW_MAX_BOOK_AGE_MS) !== 1500) throw new Error("v3745_real_shadow_book_age_must_match_main_lane");
    if (Number(env.MAIN_ACCURACY_MIN_ENTRY_PRICE) !== 0.50 || Number(env.MAIN_ACCURACY_MAX_ENTRY_PRICE) !== 0.85 || Number(env.AGGRESSIVE_MAX_ENTRY_PRICE) !== 0.80) {
      throw new Error("v3744_profitability_entry_price_ceiling_mismatch");
    }
    for (const key of ["PAPER_ONE_POSITION_PER_SLUG", "PAPER_HARD_CASH_LEDGER_ENABLED", "PAPER_RESERVE_ENTRY_FEES", "OPPOSITE_SIDE_EXPOSURE_GUARD_ENABLED"]) {
      if (env[key] !== "1") throw new Error(`v37312_hard_execution_invariant_required:${key}`);
    }
    if (env.STRATEGY_CURRENT_PREDICTION_ENABLED !== "0" || env.STRATEGY_DUAL_SIDE_ENABLED !== "1") {
      throw new Error("v3744_dual_side_candidate_engine_required");
    }
    for (const key of [
      "STRATEGY_PRICE_FIELD_ENABLED",
      "STRATEGY_ORDERBOOK_PRESSURE_ENABLED",
      "STRATEGY_STICKY_LAG_ENABLED",
      "STRATEGY_NEW_MEMBER_BAND_ENABLED",
      "STRATEGY_ENDCYCLE_SNIPER_ENABLED",
    ]) {
      if (env[key] !== "0") throw new Error(`v37312_non_primary_strategy_must_be_disabled:${key}`);
    }
    if (String(env.STRATEGY_EXECUTABLE_STRATEGIES || "").trim() !== "dual_side_ev" || String(env.STRATEGY_FORCE_ALLOW || "").trim() !== "dual_side_ev") {
      throw new Error("v3744_dual_side_must_be_only_candidate_strategy");
    }
    if (env.NO_BLOCK_QUALITY_CANDIDATES !== "1") throw new Error("v37312_quality_candidates_must_rerank_not_block");
    for (const key of ["CANDIDATE_QUALITY_ENABLED", "QUALITY_SAMPLE_GUARD_ENABLED", "V351_SIDE_COMPETITION_ENABLED"]) {
      if (env[key] !== "0") throw new Error(`v3744_legacy_book_reranker_must_be_disabled:${key}`);
    }
    if (Number(env.SCAN_INTERVAL_MS) !== 500 || env.HOT_MARKET_FAST_LANE_ENABLED !== "1" || Number(env.HOT_MARKET_SCAN_INTERVAL_MS) !== 200 || Number(env.ULTRA_HOT_MARKET_SCAN_INTERVAL_MS) !== 100) {
      throw new Error("v37312_fast_scan_contract_mismatch");
    }
    if (Number(env.PAPER_MAX_ENTRIES_PER_TICK) !== 8) throw new Error("v37312_entry_budget_must_be_eight");
    if (Number(env.MAX_ACTIVE_POSITIONS) < 72) throw new Error("v3744_max_active_positions_below_72");
    if (
      env.INDEPENDENT_ASSET_EDGE_ENABLED !== "1" ||
      Number(env.INDEPENDENT_ASSET_MIN_NET_EDGE) !== 0.05 ||
      Number(env.INDEPENDENT_ASSET_STRESS_SLIPPAGE_PER_SHARE) !== 0.005
    ) {
      throw new Error("v3744_independent_asset_edge_contract_mismatch");
    }
    if (
      env.ELIGIBILITY_EPISODE_ENABLED !== "1" ||
      Number(env.ELIGIBILITY_EPISODE_STRONG_ASSET_NET_EDGE) !== 0.075 ||
      Number(env.ELIGIBILITY_EPISODE_NEAR_SNAPSHOTS) !== 3 ||
      Number(env.ELIGIBILITY_EPISODE_STRONG_SNAPSHOTS) !== 2 ||
      Number(env.ELIGIBILITY_EPISODE_MIN_CHAINLINK_EVENTS) !== 2 ||
      Number(env.ELIGIBILITY_EPISODE_NEAR_DURATION_MS) !== 400 ||
      Number(env.ELIGIBILITY_EPISODE_STRONG_DURATION_MS) !== 150 ||
      Number(env.ELIGIBILITY_EPISODE_MAX_GAP_MS) !== 2000
    ) {
      throw new Error("v3744_eligibility_episode_contract_mismatch");
    }
    if (Number(env.AGGRESSIVE_MIN_SECONDS_INTO_WINDOW) !== 60 || Number(env.AGGRESSIVE_MAX_SECONDS_INTO_WINDOW) !== 289 || Number(env.AGGRESSIVE_MIN_SECONDS_LEFT) !== 5) {
      throw new Error("v37312_fastgrow_window_contract_mismatch");
    }
    if (Number(env.PAPER_MIN_RECORDED_FILL_USD) !== 1) throw new Error("v37312_minimum_recorded_fill_must_be_one_usd");
    if (Number(env.PAPER_MAX_TRADE_USD) > Number(env.PAPER_START_BALANCE)) throw new Error("v3744_base_trade_cap_cannot_exceed_starting_balance");
    if (Number(env.MAX_TRADE_USD_HARD_CAP) !== 0) throw new Error("v3744_fixed_usd_trade_cap_must_be_disabled");
    if (
      env.COHORT_REGIME_GUARD_ENABLED !== "1" ||
      Number(env.COHORT_REGIME_GUARD_LOOKBACK) !== 3 ||
      Number(env.COHORT_REGIME_GUARD_LOSS_TRIGGER) !== 2 ||
      Number(env.COHORT_REGIME_GUARD_TTL_SETTLEMENTS) !== 3
    ) {
      throw new Error("v3745_cohort_local_guard_contract_mismatch");
    }
    if (env.SETTLEMENT_OBSERVER_ENABLED !== "0") throw new Error("v3745_main_cannot_run_settlement_observer_writer");
    for (const key of [
      "POST_RESET_STABILIZER_ENABLED",
      "REGIME_RERANKER_ENABLED",
      "BTC_PREDICTION_LEARNED_FILTER_ENABLED",
      "V361_SHADOW_ONLY",
      "LEARNING_BRAIN_ENABLED",
      "STRATEGY_AUTO_DISABLE_ENABLED",
      "STRATEGY_RUNTIME_AUTO_DISABLE_ENABLED",
      "RECOVERY_MODE_ENABLED",
      "STARTUP_PROTECTION_ENABLED",
      "PROFIT_LOCK_ENABLED",
      "CLUSTER_GUARD_ENABLED",
      "RECENT_LOSS_BRAKE_ENABLED",
      "V333_DRAWDOWN_GUARD_ENABLED",
      "PROGRESSIVE_STAKE_ENABLED",
      "EXPOSURE_GOVERNOR_ENABLED",
    ]) {
      if (env[key] !== "0") throw new Error(`v37312_hidden_entry_modifier_must_be_disabled:${key}`);
    }
  } else if (botRole === "checkpoint_observer") {
    if (env.SETTLEMENT_OBSERVER_ENABLED !== "1") throw new Error("v3745_observer_settlement_learner_required");
    if (env.DIRECTION_SHADOW_ENABLED !== "1") throw new Error("v3747_observer_direction_shadow_required");
    if (env.MAIN_ACCURACY_LANE_ENABLED !== "0") throw new Error("v3745_observer_must_never_enable_execution_lane");
  }
  return true;
}

const validateV3746RuntimeConfig = validateV3747RuntimeConfig;
const validateV3745RuntimeConfig = validateV3747RuntimeConfig;
const validateV3744RuntimeConfig = validateV3747RuntimeConfig;

export {
  FORBIDDEN_DEPRECATED_KEYS,
  VALID_BOT_ROLES,
  validateV3744RuntimeConfig,
  validateV3745RuntimeConfig,
  validateV3746RuntimeConfig,
  validateV3747RuntimeConfig,
};
