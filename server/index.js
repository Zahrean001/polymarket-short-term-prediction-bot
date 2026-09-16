import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import WebSocket from "ws";
import crypto from "node:crypto";
import { runAdvisorAgents } from "./agents/advisorAgents.js";
import { evaluateStrategyRouter } from "./strategies/strategyRouter.js";
import { buildStrategyPerformanceReport } from "./learning/strategyPerformanceTracker.js";
import { getProgressiveStage, loadImportedLearningBrain, selectLearningPerformanceReport } from "./learning/learningBrain.js";
import { buildAdaptiveLearningState, createEmptyAdaptiveLearningState, evaluateAdaptiveAvoidance, persistAdaptiveLearningState } from "./learning/adaptiveLossAvoidance.js";
import { buildReplayThresholdOptimizerState, persistReplayThresholdOptimizerState } from "./learning/replayThresholdOptimizer.js";
import { buildWeatherStrategyStatus } from "./weather/weatherStrategy.js";
import { buildExitEngineStatus } from "./exits/exitEngine.js";
import { createAuditLogger } from "./execution/auditLogger.js";
import { buildCalibrationReport, classifyRank, evaluateEv, evaluateMomentumAlignment, extractBtcFeatures, predictProbability } from "./prediction/engineV2.js";
import { accountRiskFromSignals, evaluateRisk, getWindowKey, sizeStake } from "./risk/riskEngine.js";
import { rankOpportunities } from "./scanner/opportunityRanker.js";
import { calculateIndependentDigitalProbability } from "./prediction/independentDigitalModel.js";
import { evaluateMainAccuracyLane } from "./prediction/mainAccuracyLane.js";
import { evaluateCalibratedNetEv } from "./prediction/calibratedNetEvPolicy.js";
import { evaluateIndependentAssetEdge } from "./prediction/independentAssetEdgePolicy.js";
import { classifyFastGrowEv, sizeFastGrowStake } from "./prediction/fastGrowEvPolicy.js";
import { buildRegimeCoreEconomics, evaluateRegimeCorePolicy, normalizeDirection as normalizeCoreDirection } from "./prediction/regimeCorePolicy.js";
import {
  EligibilityEpisodeStore,
  buildEligibilityEpisodeKey,
} from "./prediction/eligibilityEpisode.js";
import { createCheckpointObserver } from "./research/checkpointObserver.js";
import { consumeEntryBudget, createEntryBudget } from "./execution/entryBudget.js";
import { simulateMarketableBuy } from "./execution/paperFill.js";
import { reconcileFastGrowObservedFill } from "./execution/fastGrowFillReconciler.js";
import { calculateActualMinimumStake, maximumStakeWithinUnresolvedReserve, resolveMarketMinimumShares } from "./execution/marketMinimumStake.js";
import { applyOptionalUsdHardCap, computeDynamicEquityTradeCap } from "./execution/equityCompoundingPolicy.js";
import { isCandidateTechnicallyExecutable } from "./execution/candidateValidity.js";
import {
  hasCommittedSlug,
  isExecutableDirectionalCandidate,
  maximumStakeWithinCash,
  summarizePaperCapital,
} from "./execution/paperCommitPolicy.js";
import { isProxyStatus, provisionalProxyStatus, shouldTrainFromSettlement } from "./settlement/settlementPolicy.js";
import { evaluateCohortRegimeGuard } from "./risk/cohortRegimeGuard.js";
import { createObserverPolicyReader, createSettlementObserverLearner } from "./research/observerPolicy.js";
import { createDirectionOnlyShadowObserver } from "./research/directionOnlyShadow.js";
import { resolveObserverExecutionProbability } from "./research/shadowIsolation.js";
import { AsyncResultCache } from "./settlement/asyncResultCache.js";
import { validateV3747RuntimeConfig } from "./config/runtimeConfig.js";
import {
  canonicalPredictionPayload,
  createPredictionPersistenceGate,
} from "./storage/predictionPersistence.js";
import {
  applyBestBidAskHint,
  applyPriceChanges,
  buildBookSnapshot,
  inspectBook,
  isBookUsable,
  updateBookTickSize,
} from "./market/orderBookState.js";
import { parseRtdsCryptoMessage } from "./market/rtdsPriceMessage.js";
import { evaluateExternalPriceFeedLiveness } from "./market/externalPriceFeedLiveness.js";
import { summarizeOfficialFilledUnique } from "./metrics/officialTradeMetrics.js";
import { isPrimaryPaperSignal } from "./metrics/primaryPaperSignal.js";

loadLocalEnv();
validateV3747RuntimeConfig(process.env);

if (process.env.POLYMARKET_INSECURE_TLS === "1") {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const PORT = Number(process.env.BOT_PORT || 8787);
const HOST = process.env.BOT_HOST || "127.0.0.1";
const BOT_ROLE = process.env.BOT_ROLE || "main_test";
const BOT_INSTANCE_ID = process.env.BOT_INSTANCE_ID || `${BOT_ROLE}-${PORT}`;
const GAMMA_API = process.env.GAMMA_API || "https://gamma-api.polymarket.com";
const CLOB_API = process.env.CLOB_API || "https://clob.polymarket.com";
const CLOB_WS_API = process.env.CLOB_WS_API || "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const POLYMARKET_WEB = process.env.POLYMARKET_WEB || "https://polymarket.com";
const DATA_API = process.env.DATA_API || "https://data-api.polymarket.com";
const SCAN_INTERVAL_MS = Number(process.env.SCAN_INTERVAL_MS || 500);
const UI_TICK_INTERVAL_MS = Number(process.env.UI_TICK_INTERVAL_MS || 1_000);
const MARKET_LIMIT = Number(process.env.MARKET_LIMIT || 120);
const ORDERBOOK_LIMIT = Number(process.env.ORDERBOOK_LIMIT || 180);
const ORDERBOOK_SCAN_CONCURRENCY = Number(process.env.ORDERBOOK_SCAN_CONCURRENCY || 104);
const ORDERBOOK_CACHE_TTL_MS = Number(process.env.ORDERBOOK_CACHE_TTL_MS || 2_000);
const ORDERBOOK_WS_FIRST = process.env.ORDERBOOK_WS_FIRST !== "0";
const ORDERBOOK_REST_FALLBACK_ONLY = process.env.ORDERBOOK_REST_FALLBACK_ONLY === "1";
const ENTRY_MAX_BOOK_AGE_MS = Number(process.env.ENTRY_MAX_BOOK_AGE_MS || 1_500);
const ENTRY_REFRESH_BOOK_IF_OLDER_MS = Number(process.env.ENTRY_REFRESH_BOOK_IF_OLDER_MS || 450);
const ENTRY_REFRESH_BEFORE_OPEN = process.env.ENTRY_REFRESH_BEFORE_OPEN === "1"; // v353.3: default OFF; never block execution with REST refresh unless explicitly enabled.
const ENTRY_REST_FALLBACK_BEFORE_OPEN = process.env.ENTRY_REST_FALLBACK_BEFORE_OPEN === "1";
const ENTRY_USE_CACHE_ONLY_BEFORE_OPEN = process.env.ENTRY_USE_CACHE_ONLY_BEFORE_OPEN !== "0";
const ENTRY_FORCE_REFRESH_MAX_WAIT_MS = Number(process.env.ENTRY_FORCE_REFRESH_MAX_WAIT_MS || 0);
const ENTRY_REVALIDATE_ASYNC_AFTER_SIGNAL = process.env.ENTRY_REVALIDATE_ASYNC_AFTER_SIGNAL !== "0";
const ENTRY_ASYNC_REFRESH_MIN_AGE_MS = Number(process.env.ENTRY_ASYNC_REFRESH_MIN_AGE_MS || 900);
const ENTRY_DROP_STALE_RESULT = process.env.ENTRY_DROP_STALE_RESULT !== "0";
const HOT_MARKET_FAST_LANE_ENABLED = process.env.HOT_MARKET_FAST_LANE_ENABLED === "1";
const HOT_MARKET_SCAN_INTERVAL_MS = Number(process.env.HOT_MARKET_SCAN_INTERVAL_MS || 200);
const ULTRA_HOT_MARKET_SCAN_INTERVAL_MS = Number(process.env.ULTRA_HOT_MARKET_SCAN_INTERVAL_MS || 100);
const HOT_MARKET_MIN_EDGE_SCORE = Number(process.env.HOT_MARKET_MIN_EDGE_SCORE || 72);
const HOT_MARKET_MAX_BOOK_AGE_MS = Number(process.env.HOT_MARKET_MAX_BOOK_AGE_MS || 600);
const HOT_MARKET_REFRESH_BEFORE_ENTRY = process.env.HOT_MARKET_REFRESH_BEFORE_ENTRY === "1"; // v353.3: advisory only; disabled by default to protect entry speed.
const HTTP_KEEP_ALIVE_ENABLED = process.env.HTTP_KEEP_ALIVE_ENABLED !== "0";
const HTTP_MAX_SOCKETS = Number(process.env.HTTP_MAX_SOCKETS || 256);
const HTTP_MAX_FREE_SOCKETS = Number(process.env.HTTP_MAX_FREE_SOCKETS || 128);
const HTTP_REQUEST_TIMEOUT_MS = Number(process.env.HTTP_REQUEST_TIMEOUT_MS || process.env.REQUEST_TIMEOUT_MS || 900);
const HTTP_SOCKET_TIMEOUT_MS = Number(process.env.HTTP_SOCKET_TIMEOUT_MS || process.env.REQUEST_TIMEOUT_MS || 900);
const SCAN_NO_OVERLAP = process.env.SCAN_NO_OVERLAP !== "0";
const SCAN_CATCHUP_AFTER_LONG_TICK = process.env.SCAN_CATCHUP_AFTER_LONG_TICK === "1";
const SCAN_SKIPPED_TICK_CATCHUP = process.env.SCAN_SKIPPED_TICK_CATCHUP === "1";
const SCAN_DROP_STALE_RESULT = process.env.SCAN_DROP_STALE_RESULT !== "0";
const SCAN_QUEUE_MAX_AGE_MS = Number(process.env.SCAN_QUEUE_MAX_AGE_MS || 450);
const LATENCY_DIAGNOSTICS_ENABLED = process.env.LATENCY_DIAGNOSTICS_ENABLED === "1";
const LATENCY_LOG_EVERY_MS = Number(process.env.LATENCY_LOG_EVERY_MS || 5_000);
const NO_STAKE_REDUCTION_MODE = process.env.NO_STAKE_REDUCTION_MODE !== "0";
const NO_ENTRY_REDUCTION_MODE = process.env.NO_ENTRY_REDUCTION_MODE !== "0";
const NO_SCAN_SLOWDOWN_MODE = process.env.NO_SCAN_SLOWDOWN_MODE !== "0";
const NO_BLOCK_QUALITY_CANDIDATES = process.env.NO_BLOCK_QUALITY_CANDIDATES !== "0";
const QUALITY_RISK_ACTION = process.env.QUALITY_RISK_ACTION || "rerank_only";
const TOXIC_BUCKET_ACTION = process.env.TOXIC_BUCKET_ACTION || "rerank_only";
const REPLAY_BAD_ACTION = process.env.REPLAY_BAD_ACTION || "rerank_only";
const RUNTIME_BAD_ACTION = process.env.RUNTIME_BAD_ACTION || "rerank_only";
const POST_RESET_STABILIZER_ENABLED = process.env.POST_RESET_STABILIZER_ENABLED !== "0";
const POST_RESET_LOCK_LAST_GOOD_SETTLED = Number(process.env.POST_RESET_LOCK_LAST_GOOD_SETTLED || 50);
const POST_RESET_MIN_SETTLED_BEFORE_NEW_RULE_OVERRIDE = Number(process.env.POST_RESET_MIN_SETTLED_BEFORE_NEW_RULE_OVERRIDE || 50);
const POST_RESET_ACTION = process.env.POST_RESET_ACTION || "rerank_only";
const POST_RESET_NO_STAKE_REDUCTION = process.env.POST_RESET_NO_STAKE_REDUCTION !== "0";
const POST_RESET_NO_POSITION_REDUCTION = process.env.POST_RESET_NO_POSITION_REDUCTION !== "0";
const POST_RESET_NO_SCAN_SLOWDOWN = process.env.POST_RESET_NO_SCAN_SLOWDOWN !== "0";
const REGIME_RERANKER_ENABLED = process.env.REGIME_RERANKER_ENABLED !== "0";
const REGIME_LOOKBACK_SETTLED = Number(process.env.REGIME_LOOKBACK_SETTLED || 50);
const REGIME_BAD_WINRATE_BELOW = Number(process.env.REGIME_BAD_WINRATE_BELOW || 45);
const REGIME_BAD_ROI_BELOW = Number(process.env.REGIME_BAD_ROI_BELOW || -8);
const REGIME_ACTION = process.env.REGIME_ACTION || "rerank_only";
const REGIME_NO_STAKE_REDUCTION = process.env.REGIME_NO_STAKE_REDUCTION !== "0";
const REGIME_NO_ENTRY_REDUCTION = process.env.REGIME_NO_ENTRY_REDUCTION !== "0";
const REGIME_NO_SCAN_SLOWDOWN = process.env.REGIME_NO_SCAN_SLOWDOWN !== "0";
const EXTERNAL_PRICE_ANCHOR_ENABLED = process.env.EXTERNAL_PRICE_ANCHOR_ENABLED !== "0";
const EXTERNAL_PRICE_WS_ENABLED = process.env.EXTERNAL_PRICE_WS_ENABLED !== "0";
const EXTERNAL_PRICE_CACHE_ONLY_ON_ENTRY = process.env.EXTERNAL_PRICE_CACHE_ONLY_ON_ENTRY !== "0";
const EXTERNAL_PRICE_REST_BEFORE_ENTRY = process.env.EXTERNAL_PRICE_REST_BEFORE_ENTRY === "1";
const EXTERNAL_PRICE_MAX_AGE_MS = Number(process.env.EXTERNAL_PRICE_MAX_AGE_MS || 2_000);
const EXTERNAL_PRICE_WATCHDOG_ENABLED = process.env.EXTERNAL_PRICE_WATCHDOG_ENABLED !== "0";
const EXTERNAL_PRICE_WATCHDOG_INTERVAL_MS = Number(process.env.EXTERNAL_PRICE_WATCHDOG_INTERVAL_MS || 500);
const EXTERNAL_PRICE_WATCHDOG_STALE_AFTER_MS = Number(process.env.EXTERNAL_PRICE_WATCHDOG_STALE_AFTER_MS || 4_500);
const EXTERNAL_PRICE_WATCHDOG_STARTUP_GRACE_MS = Number(process.env.EXTERNAL_PRICE_WATCHDOG_STARTUP_GRACE_MS || 6_000);
const EXTERNAL_PRICE_WATCHDOG_RECONNECT_DELAY_MS = Number(process.env.EXTERNAL_PRICE_WATCHDOG_RECONNECT_DELAY_MS || 250);
const EXTERNAL_PRICE_WATCHDOG_FUTURE_TOLERANCE_MS = Number(process.env.EXTERNAL_PRICE_WATCHDOG_FUTURE_TOLERANCE_MS || 2_000);
const EXTERNAL_PRICE_WATCHDOG_TRANSPORT_STALE_AFTER_MS = Number(process.env.EXTERNAL_PRICE_WATCHDOG_TRANSPORT_STALE_AFTER_MS || 12_000);
const EXTERNAL_PRICE_WATCHDOG_PUBLISHER_STALE_AFTER_MS = Number(process.env.EXTERNAL_PRICE_WATCHDOG_PUBLISHER_STALE_AFTER_MS || 15_000);
const EXTERNAL_PRICE_WATCHDOG_MAX_BACKOFF_MS = Number(process.env.EXTERNAL_PRICE_WATCHDOG_MAX_BACKOFF_MS || 10_000);
const V372_REQUIRE_EXTERNAL_ANCHOR = process.env.V372_REQUIRE_EXTERNAL_ANCHOR !== "0";
const V372_EXTERNAL_MIN_RETURN_SAMPLES = Number(process.env.V372_EXTERNAL_MIN_RETURN_SAMPLES || 12);
const V372_MAX_ANCHOR_CAPTURE_DELAY_MS = Number(process.env.V372_MAX_ANCHOR_CAPTURE_DELAY_MS || 5_000);
const EXTERNAL_PRICE_SYMBOLS = String(process.env.EXTERNAL_PRICE_SYMBOLS || "BTC,ETH,SOL,XRP").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
const EXTERNAL_PRICE_PRIMARY = process.env.EXTERNAL_PRICE_PRIMARY || "polymarket_chainlink_rtds";
const EXTERNAL_PRICE_SECONDARY = process.env.EXTERNAL_PRICE_SECONDARY || "polymarket_binance_rtds_context";
const EXTERNAL_PRICE_WS_URL = process.env.EXTERNAL_PRICE_WS_URL || "wss://ws-live-data.polymarket.com";
const OFFICIAL_CHAINLINK_REQUIRED = process.env.OFFICIAL_CHAINLINK_REQUIRED !== "0";
const BINANCE_CONTEXT_FEATURE_ENABLED = process.env.BINANCE_CONTEXT_FEATURE_ENABLED !== "0";
const CHAINLINK_SUPPORTED_SYMBOLS = new Set(["BTC", "ETH", "SOL", "XRP"]);
const ORDERBOOK_WS_ENABLED = process.env.ORDERBOOK_WS_ENABLED !== "0";
const ORDERBOOK_WS_MAX_TOKENS = Number(process.env.ORDERBOOK_WS_MAX_TOKENS || 220);
const V337_PRIORITY_ALLOCATOR_ENABLED = process.env.V337_PRIORITY_ALLOCATOR_ENABLED === "1";
const V337_WS_FREEZE_RECONNECT_MS = Number(process.env.V337_WS_FREEZE_RECONNECT_MS || 30_000);
const V337_WS_STALE_TOKEN_REFRESH_MS = Number(process.env.V337_WS_STALE_TOKEN_REFRESH_MS || 15_000);
const V337_WS_ROTATE_ON_MARKET_EVENTS = process.env.V337_WS_ROTATE_ON_MARKET_EVENTS !== "0";
const V337_MAX_STAKE_MULTIPLIER = Number(process.env.V337_MAX_STAKE_MULTIPLIER || 1.65);
const V337_MIN_STAKE_MULTIPLIER = Number(process.env.V337_MIN_STAKE_MULTIPLIER || 0.65);
const MIN_EDGE_CENTS = Number(process.env.MIN_EDGE_CENTS || 0.0025);
const MIN_DEPTH_SHARES = Number(process.env.MIN_DEPTH_SHARES || 5);
const MIN_PAPER_PROFIT_USD = Number(process.env.MIN_PAPER_PROFIT_USD || 0.01);
const PAPER_START_BALANCE = Number(process.env.PAPER_START_BALANCE || 40);
const PAPER_MAX_TRADE_USD = Number(process.env.PAPER_MAX_TRADE_USD || 8);
const DYNAMIC_EQUITY_SCALING_ENABLED = process.env.DYNAMIC_EQUITY_SCALING_ENABLED === "1";
const DYNAMIC_EQUITY_SCALING_START_EQUITY = Number(process.env.DYNAMIC_EQUITY_SCALING_START_EQUITY || PAPER_START_BALANCE);
const MAX_TRADE_EQUITY_FRACTION = Number(process.env.MAX_TRADE_EQUITY_FRACTION || 0.15);
const MAX_TRADE_USD_HARD_CAP = Number(process.env.MAX_TRADE_USD_HARD_CAP ?? 0);
const MAX_UNRESOLVED_RESERVE_FRACTION = Number(process.env.MAX_UNRESOLVED_RESERVE_FRACTION || 0.30);
const PROBE_MAX_TRADE_EQUITY_FRACTION = Number(process.env.PROBE_MAX_TRADE_EQUITY_FRACTION || 0.0025);
const LANE_B_MAX_TRADE_USD = Number(process.env.LANE_B_MAX_TRADE_USD || 1.25);
const EQUITY_LANE_SCALING_ENABLED = process.env.EQUITY_LANE_SCALING_ENABLED !== "0";
const EQUITY_LANE_SCALING_BASE_EQUITY = Number(process.env.EQUITY_LANE_SCALING_BASE_EQUITY || PAPER_START_BALANCE);
const EQUITY_LANE_SCALING_START_EQUITY = Number(process.env.EQUITY_LANE_SCALING_START_EQUITY || DYNAMIC_EQUITY_SCALING_START_EQUITY);
const EQUITY_LANE_SCALING_CURVE = Number(process.env.EQUITY_LANE_SCALING_CURVE || 0.50);
const EQUITY_LANE_SCALING_MAX_MULTIPLIER = Number(process.env.EQUITY_LANE_SCALING_MAX_MULTIPLIER || 1.60);
const EQUITY_LANE_SCALING_REQUIRE_NORMAL_PROFIT_LOCK = process.env.EQUITY_LANE_SCALING_REQUIRE_NORMAL_PROFIT_LOCK !== "0";
const EQUITY_LANE_SCALING_REQUIRE_WS_BOOK = process.env.EQUITY_LANE_SCALING_REQUIRE_WS_BOOK !== "0";
const V333_DRAWDOWN_GUARD_ENABLED = process.env.V333_DRAWDOWN_GUARD_ENABLED !== "0";
const V333_MIN_SIZING_EQUITY_USD = Number(process.env.V333_MIN_SIZING_EQUITY_USD || 1);
const V333_COLD_START_SETTLED_REQUIRED = Number(process.env.V333_COLD_START_SETTLED_REQUIRED || 100);
const V333_COLD_START_LANE_A_CAP_USD = Number(process.env.V333_COLD_START_LANE_A_CAP_USD || 1.00);
const V333_DRAWDOWN_PROBE_CAP_USD = Number(process.env.V333_DRAWDOWN_PROBE_CAP_USD || 1.00);
const V333_BLOCK_UP_IN_DRAWDOWN = process.env.V333_BLOCK_UP_IN_DRAWDOWN !== "0";
const V334_STRICT_ENTRY_GUARD_ENABLED = process.env.V334_STRICT_ENTRY_GUARD_ENABLED === "1";
const V334_ALLOWED_SYMBOLS = new Set(String(process.env.V334_ALLOWED_SYMBOLS || "BTC").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean));
const V334_ALLOWED_TIMEFRAMES = new Set(String(process.env.V334_ALLOWED_TIMEFRAMES || "5M").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean));
const V334_ALLOWED_SIDES = new Set(String(process.env.V334_ALLOWED_SIDES || "DOWN").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean));
const V334_MAX_ENTRY_PRICE = Number(process.env.V334_MAX_ENTRY_PRICE || 0.59);
const V334_MAX_OPEN_POSITIONS = Number(process.env.V334_MAX_OPEN_POSITIONS || 1);
const V334_BLOCK_RUNTIME_TOXIC = process.env.V334_BLOCK_RUNTIME_TOXIC !== "0";
const V334_BLOCK_REPLAY_BAD = process.env.V334_BLOCK_REPLAY_BAD !== "0";
const V334_BLOCK_REST_BOOK = process.env.V334_BLOCK_REST_BOOK !== "0";
const V334_BLOCK_AFTER_LOSS_STREAK = Number(process.env.V334_BLOCK_AFTER_LOSS_STREAK || 2);
// Retained for the legacy complete-set dashboard only. V373 production profiles
// force this to zero; prediction entries record measured decision latency.
const SIMULATED_LATENCY_MS = Number(process.env.SIMULATED_LATENCY_MS || 0);
const TRADE_COOLDOWN_MS = Number(process.env.TRADE_COOLDOWN_MS || 45_000);
const BTC_PREDICTION_ENABLED = process.env.BTC_PREDICTION_ENABLED !== "0";
const BTC_PREDICTION_STRATEGY_VERSION = process.env.BTC_PREDICTION_STRATEGY_VERSION || "btc-v353.6-no-downgrade-accuracy-engine";
const BTC_PREDICTION_TARGET_WIN_RATE = Number(process.env.BTC_PREDICTION_TARGET_WIN_RATE || 70);
const MAIN_ACCURACY_LANE_ENABLED = process.env.MAIN_ACCURACY_LANE_ENABLED === "1";
const MAIN_ACCURACY_MIN_CONFIDENCE = Number(process.env.MAIN_ACCURACY_MIN_CONFIDENCE || 85);
const MAIN_ACCURACY_MIN_SECONDS_INTO_WINDOW = Number(process.env.MAIN_ACCURACY_MIN_SECONDS_INTO_WINDOW || 60);
const MAIN_ACCURACY_MAX_SECONDS_INTO_WINDOW_EXCLUSIVE = Number(process.env.MAIN_ACCURACY_MAX_SECONDS_INTO_WINDOW_EXCLUSIVE || 290);
const MAIN_ACCURACY_REQUIRE_MODEL_READY = process.env.MAIN_ACCURACY_REQUIRE_MODEL_READY !== "0";
const MAIN_ACCURACY_REQUIRE_DIRECTION_LOCK = process.env.MAIN_ACCURACY_REQUIRE_DIRECTION_LOCK === "1";
const MAIN_ACCURACY_REQUIRE_CHAINLINK = process.env.MAIN_ACCURACY_REQUIRE_CHAINLINK !== "0";
const MAIN_ACCURACY_REQUIRE_OFFICIAL_TARGET = process.env.MAIN_ACCURACY_REQUIRE_OFFICIAL_TARGET !== "0";
const MAIN_ACCURACY_REQUIRE_WS_BOOK = process.env.MAIN_ACCURACY_REQUIRE_WS_BOOK !== "0";
const MAIN_ACCURACY_MAX_CHAINLINK_AGE_MS = Number(process.env.MAIN_ACCURACY_MAX_CHAINLINK_AGE_MS || 2_000);
const MAIN_ACCURACY_MAX_BOOK_AGE_MS = Number(process.env.MAIN_ACCURACY_MAX_BOOK_AGE_MS || 1_500);
const MAIN_ACCURACY_MIN_ENTRY_PRICE = Number(process.env.MAIN_ACCURACY_MIN_ENTRY_PRICE || 0.50);
const MAIN_ACCURACY_MAX_ENTRY_PRICE = Number(process.env.MAIN_ACCURACY_MAX_ENTRY_PRICE || 0.80);
const PAPER_ONE_POSITION_PER_SLUG = process.env.PAPER_ONE_POSITION_PER_SLUG === "1";
const PAPER_HARD_CASH_LEDGER_ENABLED = process.env.PAPER_HARD_CASH_LEDGER_ENABLED === "1";
const PAPER_RESERVE_ENTRY_FEES = process.env.PAPER_RESERVE_ENTRY_FEES === "1";
const BTC_PREDICTION_MIN_CONFIDENCE = Number(process.env.BTC_PREDICTION_MIN_CONFIDENCE || 72);
const BTC_PREDICTION_MIN_EDGE_PERCENT = Number(process.env.BTC_PREDICTION_MIN_EDGE_PERCENT || 4);
const BTC_PREDICTION_MIN_DISTANCE_BPS = Number(process.env.BTC_PREDICTION_MIN_DISTANCE_BPS || 2);
const BTC_PREDICTION_MAX_BOOK_AGE_MS = Number(process.env.BTC_PREDICTION_MAX_BOOK_AGE_MS || 2_500);
const BTC_PREDICTION_MIN_SECONDS_INTO_WINDOW = Number(process.env.BTC_PREDICTION_MIN_SECONDS_INTO_WINDOW || 25);
const BTC_PREDICTION_MAX_SECONDS_INTO_WINDOW = Number(process.env.BTC_PREDICTION_MAX_SECONDS_INTO_WINDOW || 285);
const BTC_PREDICTION_MAX_ENTRY_PRICE = Number(process.env.BTC_PREDICTION_MAX_ENTRY_PRICE || 0.95);
const BTC_PREDICTION_MAX_SPREAD_CENTS = Number(process.env.BTC_PREDICTION_MAX_SPREAD_CENTS || 8);
const BTC_PREDICTION_LOSS_CIRCUIT_COUNT = Number(process.env.BTC_PREDICTION_LOSS_CIRCUIT_COUNT || 3);
const BTC_PREDICTION_LOSS_CIRCUIT_WINDOW_MS = Number(process.env.BTC_PREDICTION_LOSS_CIRCUIT_WINDOW_MS || 60 * 60_000);
const BTC_PREDICTION_LEARNED_FILTER_ENABLED = process.env.BTC_PREDICTION_LEARNED_FILTER_ENABLED !== "0";
const BTC_PREDICTION_MIN_BUCKET_SAMPLES = Number(process.env.BTC_PREDICTION_MIN_BUCKET_SAMPLES || 12);
const BTC_PREDICTION_MIN_BUCKET_ROI = Number(process.env.BTC_PREDICTION_MIN_BUCKET_ROI || 0);
const BTC_PREDICTION_MIN_SECONDS_LEFT = Number(process.env.BTC_PREDICTION_MIN_SECONDS_LEFT || 12);
const BTC_PAPER_SIGNAL_COOLDOWN_MS = Number(process.env.BTC_PAPER_SIGNAL_COOLDOWN_MS || 30_000);
const REFERENCE_WALLET_ENABLED = process.env.REFERENCE_WALLET_ENABLED !== "0";
const REFERENCE_WALLET_NAME = process.env.REFERENCE_WALLET_NAME || "PBot-6";
const REFERENCE_WALLET_ADDRESS = String(
  process.env.REFERENCE_WALLET_ADDRESS || "0x21d0a97aac03917e752857a551bbe5103a00e8d7",
).toLowerCase();
const REFERENCE_TRADE_LIMIT = Math.max(20, Math.min(500, Number(process.env.REFERENCE_TRADE_LIMIT || 120)));
const REFERENCE_ACTIVE_WINDOW_MS = Number(process.env.REFERENCE_ACTIVE_WINDOW_MS || 30 * 60_000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12_000);
const USE_DOH = process.env.USE_DOH !== "0";
const DOH_HOST = process.env.DOH_HOST || "cloudflare-dns.com";
const DOH_IP = process.env.DOH_IP || "1.1.1.1";
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), "server", "data-main-v3747");
const MAIN_SIGNAL_DIR = path.resolve(process.env.MAIN_SIGNAL_DIR || path.join(process.cwd(), "server", "data-main-v3747", "signals"));
const MAIN_SETTLEMENT_DIR = path.resolve(process.env.MAIN_SETTLEMENT_DIR || path.join(process.cwd(), "server", "data-main-v3747", "settlements"));
const OBSERVER_CHECKPOINT_DIR = path.resolve(process.env.OBSERVER_CHECKPOINT_DIR || path.join(process.cwd(), "server", "data-observer-v3747", "research", "canonical-checkpoints"));
const OBSERVER_POLICY_PATH = path.resolve(process.env.OBSERVER_POLICY_PATH || path.join(process.cwd(), "server", "data-observer-v3747", "policy", "observer-policy-v3747.json"));
const OBSERVER_STATE_PATH = path.resolve(process.env.OBSERVER_STATE_PATH || path.join(process.cwd(), "server", "data-observer-v3747", "observer", "settlement-cursor-v3747.json"));
const ANTI_DOWNGRADE_REPORT_PATH = path.resolve(process.env.ANTI_DOWNGRADE_REPORT_PATH || path.join(process.cwd(), "server", "data-observer-v3747", "reports", "anti-downgrade-evidence-latest.json"));
const DIRECTION_SHADOW_DECISION_DIR = path.resolve(process.env.DIRECTION_SHADOW_DECISION_DIR || path.join(process.cwd(), "server", "data-observer-v3747", "research", "direction-only-decisions"));
const DIRECTION_SHADOW_STATE_PATH = path.resolve(process.env.DIRECTION_SHADOW_STATE_PATH || path.join(process.cwd(), "server", "data-observer-v3747", "observer", "direction-only-cursor-v3747.json"));
const DIRECTION_SHADOW_REPORT_PATH = path.resolve(process.env.DIRECTION_SHADOW_REPORT_PATH || path.join(process.cwd(), "server", "data-observer-v3747", "reports", "direction-only-shadow-latest.json"));
const MAIN_BEHAVIOR_POLICY_ID = process.env.MAIN_BEHAVIOR_POLICY_ID || "v3745-frozen-control";
const ANTI_DOWNGRADE_SHADOW_ENABLED = process.env.ANTI_DOWNGRADE_SHADOW_ENABLED !== "0";
const ANTI_DOWNGRADE_SHADOW_EXECUTION_ENABLED = process.env.ANTI_DOWNGRADE_SHADOW_EXECUTION_ENABLED === "1";
const ANTI_DOWNGRADE_AUTOMATIC_PROMOTION = process.env.ANTI_DOWNGRADE_AUTOMATIC_PROMOTION === "1";
const SETTLEMENT_OBSERVER_ENABLED = process.env.SETTLEMENT_OBSERVER_ENABLED === "1";
const SETTLEMENT_OBSERVER_INTERVAL_MS = Math.max(1_000, Number(process.env.SETTLEMENT_OBSERVER_INTERVAL_MS || 5_000));
const DIRECTION_SHADOW_ENABLED = process.env.DIRECTION_SHADOW_ENABLED === "1";
const DIRECTION_SHADOW_EXECUTION_ENABLED = process.env.DIRECTION_SHADOW_EXECUTION_ENABLED === "1";
const DIRECTION_SHADOW_AUTOMATIC_PROMOTION = process.env.DIRECTION_SHADOW_AUTOMATIC_PROMOTION === "1";
const DIRECTION_SHADOW_MAX_OBSERVATION_DELAY_MS = Math.max(1_000, Number(process.env.DIRECTION_SHADOW_MAX_OBSERVATION_DELAY_MS || 10_000));
const OBSERVER_POLICY_MAX_AGE_MS = Math.max(10_000, Number(process.env.OBSERVER_POLICY_MAX_AGE_MS || 180_000));
const OBSERVER_POLICY_MIN_COHORT_SAMPLES = Math.max(1, Number(process.env.OBSERVER_POLICY_MIN_COHORT_SAMPLES || 30));
const OBSERVER_POLICY_MIN_FORWARD_SAMPLES = Math.max(100, Number(process.env.OBSERVER_POLICY_MIN_FORWARD_SAMPLES || 100));
const V356_RELEASE_VERSION = "v374.7-direction-only-shadow-fastgrow-full-paper";
const V361_RELEASE_VERSION = "v361.0-v356-shadow-proof-gated";
const V361_SHADOW_ONLY = process.env.V361_SHADOW_ONLY !== "0";
const V361_APPLY_TO_LIVE_SELECTION = process.env.V361_APPLY_TO_LIVE_SELECTION === "1";
const V361_SCORE_ONLY_RERANK = process.env.V361_SCORE_ONLY_RERANK !== "0";
const SHADOW_OBSERVER_ENABLED = process.env.SHADOW_OBSERVER_ENABLED === "1";
const V361_SHADOW_SIGNALS_PATH = path.join(DATA_DIR, "shadow", "v361-shadow-signals.json");
const V361_SHADOW_SETTLED_PATH = path.join(DATA_DIR, "shadow", "v361-shadow-settled.jsonl");
const V356_BASELINE_CORE = "v3745_regime_core_asset_ev_exact_market_minimum_single_slug_hard_cash";
const V356_PREDICTION_LOGIC_BASE = "v3745-chainlink-regime-core-price050-confidence95-window75-179";
const V356_SAFE_RECOVERY_MODE = process.env.V356_SAFE_RECOVERY_MODE !== "0";
const PROFIT_BUCKET_REPLACEMENT_ENABLED = process.env.PROFIT_BUCKET_REPLACEMENT_ENABLED === "1";
const PROFIT_BUCKET_REPLACEMENT_MODE = process.env.PROFIT_BUCKET_REPLACEMENT_MODE || "shadow_only";
const RESET_PRESERVE_LEARNING_MEMORY = process.env.RESET_PRESERVE_LEARNING_MEMORY !== "0";
const RESET_PRESERVE_RUNTIME_CACHE = process.env.RESET_PRESERVE_RUNTIME_CACHE !== "0";
const RESET_PRESERVE_STRATEGY_REPORTS = process.env.RESET_PRESERVE_STRATEGY_REPORTS !== "0";
const RESET_BOOTSTRAP_FROM_LAST_GOOD_CACHE = process.env.RESET_BOOTSTRAP_FROM_LAST_GOOD_CACHE === "1";
const RESET_RUNTIME_MIN_SETTLED_BEFORE_OVERRIDE = Number(process.env.RESET_RUNTIME_MIN_SETTLED_BEFORE_OVERRIDE || 50);
const LAST_GOOD_MODEL_ENABLED = process.env.LAST_GOOD_MODEL_ENABLED === "1";
const LAST_GOOD_RESTORE_ON_RESET = process.env.LAST_GOOD_RESTORE_ON_RESET === "1";
const LAST_GOOD_SAVE_MIN_SETTLED = Number(process.env.LAST_GOOD_SAVE_MIN_SETTLED || 30);
const LAST_GOOD_SAVE_MIN_WINRATE = Number(process.env.LAST_GOOD_SAVE_MIN_WINRATE || 58);
const LAST_GOOD_SAVE_MIN_ROI = Number(process.env.LAST_GOOD_SAVE_MIN_ROI || 0);
const LAST_GOOD_LOCK_AFTER_RESET_SETTLED = Number(process.env.LAST_GOOD_LOCK_AFTER_RESET_SETTLED || 50);
const LAST_GOOD_DIR = path.join(DATA_DIR, "learning", "last-good");
const DIST_DIR = process.env.UI_DIST_DIR || path.resolve(process.cwd(), "dist");
const STATIC_CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};
const BTC_PAPER_STATE_PATH = process.env.BTC_PAPER_STATE_PATH || path.join(DATA_DIR, "btc-paper-state.json");
const PAPER_STATE_PERSISTENCE_ENABLED = BOT_ROLE === "main_test" && process.env.PAPER_STATE_PERSISTENCE_ENABLED !== "0";
const PAPER_STATE_HEARTBEAT_MS = Math.max(5_000, Number(process.env.PAPER_STATE_HEARTBEAT_MS || 60_000));
const PAPER_SESSION_STATE_PATH = process.env.PAPER_SESSION_STATE_PATH || path.join(DATA_DIR, "paper-session-state.json");
const REFERENCE_STATE_PATH = process.env.REFERENCE_STATE_PATH || path.join(DATA_DIR, "reference-wallet-state.json");
const AGENT_ADVICE_PATH = process.env.AGENT_RECOMMENDATIONS_PATH || path.join(DATA_DIR, "agents", "recommendations.json");
const AGENT_ADVICE_CACHE_TTL_MS = Number(process.env.AGENT_ADVICE_CACHE_TTL_MS || 5_000);
const AUDIT_SNAPSHOT_DEDUPE_MS = Math.max(0, Number(process.env.AUDIT_SNAPSHOT_DEDUPE_MS || 0));
const AUDIT_DECISION_DEDUPE_MS = Math.max(0, Number(process.env.AUDIT_DECISION_DEDUPE_MS || 0));
const AUDIT_STRATEGY_DEDUPE_MS = Math.max(0, Number(process.env.AUDIT_STRATEGY_DEDUPE_MS || 0));
const AUDIT_GATE_DEDUPE_MS = Math.max(0, Number(process.env.AUDIT_GATE_DEDUPE_MS || 0));
const AUDIT_IDLE_OBSERVER_EVENT_DEDUPE_MS = Math.max(0, Number(process.env.AUDIT_IDLE_OBSERVER_EVENT_DEDUPE_MS || 0));
const BTC_SAMPLE_TARGET = Number(process.env.BTC_SAMPLE_TARGET || 300);
const AI_AGENT_ENABLED = process.env.AI_AGENT_ENABLED !== "0";
const AI_AGENT_MODE = process.env.AI_AGENT_MODE || "advisor";
const AI_AGENT_CAN_EXECUTE = process.env.AI_AGENT_CAN_EXECUTE === "1";
const AI_AGENT_POOL_SIZE = Number(process.env.AI_AGENT_POOL_SIZE || 6);
const AI_AGENT_ACTIVE_MAX = Number(process.env.AI_AGENT_ACTIVE_MAX || 4);
const CRYPTO_SCANNER_ENABLED = process.env.CRYPTO_SCANNER_ENABLED !== "0";
const CRYPTO_SCANNER_MODE = process.env.CRYPTO_SCANNER_MODE || "paper";
const CRYPTO_SCANNER_MAX_TRADE_CANDIDATES = Number(process.env.CRYPTO_SCANNER_MAX_TRADE_CANDIDATES || 140);
const CRYPTO_SCANNER_MAX_WATCHED_MARKETS = Number(process.env.CRYPTO_SCANNER_MAX_WATCHED_MARKETS || ORDERBOOK_LIMIT);
const CRYPTO_SCANNER_TARGETED_MARKETS_ENABLED = process.env.CRYPTO_SCANNER_TARGETED_MARKETS_ENABLED !== "0";
const CRYPTO_SCANNER_SEARCH_LIMIT_PER_TERM = Number(process.env.CRYPTO_SCANNER_SEARCH_LIMIT_PER_TERM || 30);
const CRYPTO_SCANNER_SYMBOLS = String(process.env.CRYPTO_SCANNER_SYMBOLS || "bitcoin,ethereum,solana,xrp,dogecoin,bnb,microstrategy")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const CRYPTO_SCANNER_FAST_TIMEFRAMES = String(process.env.CRYPTO_SCANNER_FAST_TIMEFRAMES || "5M,15M")
  .split(",")
  .map((item) => item.trim().toUpperCase())
  .filter(Boolean);
const CRYPTO_SCANNER_CONTEXT_TIMEFRAMES = String(process.env.CRYPTO_SCANNER_CONTEXT_TIMEFRAMES || "1H,4H,1D,1W,1MO,1Y,PREMARKET,ETF")
  .split(",")
  .map((item) => item.trim().toUpperCase())
  .filter(Boolean);
const CRYPTO_SCANNER_INCLUDE_UPDOWN_SLUGS = process.env.CRYPTO_SCANNER_INCLUDE_UPDOWN_SLUGS !== "0";
const MULTI_ASSET_PREDICTION_ENABLED = process.env.MULTI_ASSET_PREDICTION_ENABLED === "1";
const MULTI_ASSET_PREDICTION_SYMBOLS = String(process.env.MULTI_ASSET_PREDICTION_SYMBOLS || "BTC,ETH,SOL,XRP,DOGE,BNB")
  .split(",")
  .map((item) => item.trim().toUpperCase())
  .filter(Boolean);
const MULTI_ASSET_PREDICTION_TIMEFRAMES = String(process.env.MULTI_ASSET_PREDICTION_TIMEFRAMES || "5M,15M")
  .split(",")
  .map((item) => item.trim().toUpperCase())
  .filter(Boolean);
const MULTI_ASSET_MIN_SCANNER_SCORE = Number(process.env.MULTI_ASSET_MIN_SCANNER_SCORE || 35);
const MULTI_ASSET_MIN_EDGE_PERCENT = Number(process.env.MULTI_ASSET_MIN_EDGE_PERCENT || -2);
const MULTI_ASSET_ROUTE_OPPORTUNITY_FIRST = process.env.MULTI_ASSET_ROUTE_OPPORTUNITY_FIRST !== "0";
const MULTI_ASSET_MIN_SECONDS_INTO_WINDOW = Number(process.env.MULTI_ASSET_MIN_SECONDS_INTO_WINDOW || BTC_PREDICTION_MIN_SECONDS_INTO_WINDOW);
const MULTI_ASSET_MAX_SECONDS_INTO_WINDOW = Number(process.env.MULTI_ASSET_MAX_SECONDS_INTO_WINDOW || 75);
const MULTI_ASSET_REQUIRE_SCANNER_OPPORTUNITY = process.env.MULTI_ASSET_REQUIRE_SCANNER_OPPORTUNITY !== "0";
const MULTI_ASSET_SELECTION_POOL_SIZE = Math.max(1, Number(process.env.MULTI_ASSET_SELECTION_POOL_SIZE || 140));
const MULTI_ASSET_COMMIT_MARKETS_PER_TICK = Math.max(1, Number(process.env.MULTI_ASSET_COMMIT_MARKETS_PER_TICK || 8));
const MARKET_DISCOVERY_CACHE_TTL_MS = Number(process.env.MARKET_DISCOVERY_CACHE_TTL_MS || 5_000);
const CRYPTO_SCANNER_MARKET_CACHE_TTL_MS = Number(
  process.env.CRYPTO_SCANNER_MARKET_CACHE_TTL_MS || process.env.CRYPTO_SCANNER_REFRESH_MS || 30_000,
);
const FAST_GROWTH_MODE = process.env.FAST_GROWTH_MODE !== "0";
const BTC_PREDICTION_MIN_SELECTED_PROBABILITY = Number(process.env.BTC_PREDICTION_MIN_SELECTED_PROBABILITY || 0.72);
const BTC_PREDICTION_MIN_FEE_ADJUSTED_EDGE = Number(process.env.BTC_PREDICTION_MIN_FEE_ADJUSTED_EDGE || 0.10);
const BTC_PREDICTION_MIN_VOL_ADJ_DISTANCE = Number(process.env.BTC_PREDICTION_MIN_VOL_ADJ_DISTANCE || 1.2);
const BTC_PREDICTION_MAX_YES_NO_ASK_COST = Number(process.env.BTC_PREDICTION_MAX_YES_NO_ASK_COST || 1.04);
const BTC_PREDICTION_SIGNAL_STABLE_TICKS = Number(process.env.BTC_PREDICTION_SIGNAL_STABLE_TICKS || 2);
const MAX_ACTIVE_POSITIONS = Number(process.env.MAX_ACTIVE_POSITIONS || 72);
const MAX_CONSECUTIVE_LOSSES = Number(process.env.MAX_CONSECUTIVE_LOSSES || 2);
const MAX_DAILY_LOSS_FRACTION = Number(process.env.MAX_DAILY_LOSS_FRACTION || 0.25);
const MAX_STAKE_FRACTION_A_PLUS = Number(process.env.MAX_STAKE_FRACTION_A_PLUS || 0.15);
const MAX_STAKE_FRACTION_A = Number(process.env.MAX_STAKE_FRACTION_A || 0.08);
const MAX_STAKE_FRACTION_B = Number(process.env.MAX_STAKE_FRACTION_B || 0.05);
const MAX_STAKE_FRACTION_C = Number(process.env.MAX_STAKE_FRACTION_C || 0.03);

const AGGRESSIVE_LEARNING_MODE = process.env.AGGRESSIVE_LEARNING_MODE === "1";
const BTC_LEARNING_FALLBACK_MODE = process.env.BTC_LEARNING_FALLBACK_MODE === "1";
const RISK_PROFILE = AGGRESSIVE_LEARNING_MODE ? "aggressive_learning" : FAST_GROWTH_MODE ? "fast_growth" : "balanced";
const ACTIVE_BTC_PREDICTION_MIN_CONFIDENCE = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MIN_CONFIDENCE || 68)
  : BTC_PREDICTION_MIN_CONFIDENCE;
const ACTIVE_BTC_PREDICTION_TARGET_WIN_RATE = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_TARGET_WIN_RATE || 62)
  : BTC_PREDICTION_TARGET_WIN_RATE;
const ACTIVE_BTC_PREDICTION_MIN_EDGE_PERCENT = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MIN_EDGE_PERCENT || 2)
  : BTC_PREDICTION_MIN_EDGE_PERCENT;
const ACTIVE_BTC_PREDICTION_MIN_DISTANCE_BPS = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MIN_DISTANCE_BPS || 0.8)
  : BTC_PREDICTION_MIN_DISTANCE_BPS;
const ACTIVE_BTC_PREDICTION_MAX_BOOK_AGE_MS = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MAX_BOOK_AGE_MS || 5000)
  : BTC_PREDICTION_MAX_BOOK_AGE_MS;
const ACTIVE_BTC_PREDICTION_MAX_ENTRY_PRICE = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MAX_ENTRY_PRICE || 0.92)
  : BTC_PREDICTION_MAX_ENTRY_PRICE;
const ACTIVE_BTC_PREDICTION_MAX_SPREAD_CENTS = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MAX_SPREAD_CENTS || 8)
  : BTC_PREDICTION_MAX_SPREAD_CENTS;
const ACTIVE_BTC_PREDICTION_MIN_SELECTED_PROBABILITY = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MIN_SELECTED_PROBABILITY || 0.62)
  : BTC_PREDICTION_MIN_SELECTED_PROBABILITY;
const ACTIVE_BTC_PREDICTION_MIN_FEE_ADJUSTED_EDGE = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MIN_FEE_ADJUSTED_EDGE || 0.025)
  : BTC_PREDICTION_MIN_FEE_ADJUSTED_EDGE;
const ACTIVE_BTC_PREDICTION_MIN_VOL_ADJ_DISTANCE = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MIN_VOL_ADJ_DISTANCE || 0.45)
  : BTC_PREDICTION_MIN_VOL_ADJ_DISTANCE;
const ACTIVE_BTC_PREDICTION_MAX_YES_NO_ASK_COST = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MAX_YES_NO_ASK_COST || 1.08)
  : BTC_PREDICTION_MAX_YES_NO_ASK_COST;
const ACTIVE_BTC_PREDICTION_SIGNAL_STABLE_TICKS = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_SIGNAL_STABLE_TICKS || 1)
  : BTC_PREDICTION_SIGNAL_STABLE_TICKS;
const ACTIVE_BTC_PREDICTION_MIN_SECONDS_INTO_WINDOW = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MIN_SECONDS_INTO_WINDOW || BTC_PREDICTION_MIN_SECONDS_INTO_WINDOW)
  : BTC_PREDICTION_MIN_SECONDS_INTO_WINDOW;
const ACTIVE_BTC_PREDICTION_MAX_SECONDS_INTO_WINDOW = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MAX_SECONDS_INTO_WINDOW || BTC_PREDICTION_MAX_SECONDS_INTO_WINDOW)
  : BTC_PREDICTION_MAX_SECONDS_INTO_WINDOW;
const ACTIVE_BTC_PREDICTION_MIN_SECONDS_LEFT = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MIN_SECONDS_LEFT || BTC_PREDICTION_MIN_SECONDS_LEFT)
  : BTC_PREDICTION_MIN_SECONDS_LEFT;
const ACTIVE_MAX_CONSECUTIVE_LOSSES = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MAX_CONSECUTIVE_LOSSES || 5)
  : MAX_CONSECUTIVE_LOSSES;
const ACTIVE_MAX_DAILY_LOSS_FRACTION = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MAX_DAILY_LOSS_FRACTION || 0.45)
  : MAX_DAILY_LOSS_FRACTION;
const ACTIVE_BTC_PAPER_SIGNAL_COOLDOWN_MS = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_SIGNAL_COOLDOWN_MS || 10_000)
  : BTC_PAPER_SIGNAL_COOLDOWN_MS;
const ACTIVE_MAX_STAKE_FRACTION_A_PLUS = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MAX_STAKE_FRACTION_A_PLUS || 0.10)
  : MAX_STAKE_FRACTION_A_PLUS;
const ACTIVE_MAX_STAKE_FRACTION_A = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MAX_STAKE_FRACTION_A || 0.07)
  : MAX_STAKE_FRACTION_A;
const ACTIVE_MAX_STAKE_FRACTION_B = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MAX_STAKE_FRACTION_B || 0.05)
  : MAX_STAKE_FRACTION_B;
const ACTIVE_MAX_STAKE_FRACTION_C = AGGRESSIVE_LEARNING_MODE
  ? Number(process.env.AGGRESSIVE_MAX_STAKE_FRACTION_C || 0.03)
  : MAX_STAKE_FRACTION_C;

const VERY_AGGRESSIVE_SAMPLE_MODE = process.env.VERY_AGGRESSIVE_SAMPLE_MODE === "1";
const RESEARCH_SAMPLE_BUCKET_SECONDS = Math.max(5, Number(process.env.RESEARCH_SAMPLE_BUCKET_SECONDS || 30));
const STRATEGY_ROUTER_ENABLED = process.env.STRATEGY_ROUTER_ENABLED !== "0";
const GATE_PROTOCOL_ENABLED = process.env.GATE_PROTOCOL_ENABLED !== "0";
const CONSENSUS_ENGINE_ENABLED = process.env.CONSENSUS_ENGINE_ENABLED !== "0";
const STRATEGY_MODE = process.env.STRATEGY_MODE || "paper";
const STRATEGY_MAX_CANDIDATES_PER_TICK = Number(process.env.STRATEGY_MAX_CANDIDATES_PER_TICK || 12);
const PAPER_MAX_ENTRIES_PER_TICK = Math.max(1, Number(process.env.PAPER_MAX_ENTRIES_PER_TICK || Math.min(8, MAX_ACTIVE_POSITIONS)));
const ACCURACY_RERANKER_ENABLED = process.env.ACCURACY_RERANKER_ENABLED === "1";
const ACCURACY_RERANKER_MODE = process.env.ACCURACY_RERANKER_MODE || "score_only";
const ACCURACY_RERANKER_FILL_SLOTS = process.env.ACCURACY_RERANKER_FILL_SLOTS !== "0";
const ACCURACY_RERANKER_NEVER_REDUCE_ENTRY_COUNT = process.env.ACCURACY_RERANKER_NEVER_REDUCE_ENTRY_COUNT !== "0";
const ACCURACY_RERANKER_MAX_ADJUSTMENT = Number(process.env.ACCURACY_RERANKER_MAX_ADJUSTMENT || 55);
const OPPOSITE_SIDE_EXPOSURE_GUARD_ENABLED = process.env.OPPOSITE_SIDE_EXPOSURE_GUARD_ENABLED !== "0";
const OPPOSITE_SIDE_FULL_STAKE_MAX_COMBINED_PRICE = Number(process.env.OPPOSITE_SIDE_FULL_STAKE_MAX_COMBINED_PRICE || 0.96);
const OPPOSITE_SIDE_HALF_STAKE_MAX_COMBINED_PRICE = Number(process.env.OPPOSITE_SIDE_HALF_STAKE_MAX_COMBINED_PRICE || 0.98);
const OPPOSITE_SIDE_TINY_STAKE_MAX_COMBINED_PRICE = Number(process.env.OPPOSITE_SIDE_TINY_STAKE_MAX_COMBINED_PRICE || 1.00);
const OPPOSITE_SIDE_HALF_STAKE_MULTIPLIER = Number(process.env.OPPOSITE_SIDE_HALF_STAKE_MULTIPLIER || 0.50);
const OPPOSITE_SIDE_TINY_STAKE_MULTIPLIER = Number(process.env.OPPOSITE_SIDE_TINY_STAKE_MULTIPLIER || 0.15);
const EXPOSURE_GOVERNOR_ENABLED = process.env.EXPOSURE_GOVERNOR_ENABLED !== "0";
const MAX_GROSS_OPEN_EXPOSURE_FRACTION = Number(process.env.MAX_GROSS_OPEN_EXPOSURE_FRACTION || 1.00);
const MAX_OPEN_POSITIONS_SOFT = Number(process.env.MAX_OPEN_POSITIONS_SOFT || 12);
const MAX_OPEN_PER_SYMBOL = Number(process.env.MAX_OPEN_PER_SYMBOL || 3);
const MAX_OPEN_PER_SIDE_BUCKET = Number(process.env.MAX_OPEN_PER_SIDE_BUCKET || 6);
const EXPOSURE_GOVERNOR_TINY_STAKE_MULTIPLIER = Number(process.env.EXPOSURE_GOVERNOR_TINY_STAKE_MULTIPLIER || 0.10);
const EXPOSURE_GOVERNOR_REDUCED_STAKE_MULTIPLIER = Number(process.env.EXPOSURE_GOVERNOR_REDUCED_STAKE_MULTIPLIER || 0.25);
const MAX_POSITIONS_PER_WINDOW = Number(process.env.MAX_POSITIONS_PER_WINDOW || (VERY_AGGRESSIVE_SAMPLE_MODE ? 25 : 5));
const MAX_SAME_SIDE_PER_WINDOW = Number(process.env.MAX_SAME_SIDE_PER_WINDOW || (VERY_AGGRESSIVE_SAMPLE_MODE ? 12 : 3));
const MAX_STRATEGY_POSITIONS_PER_WINDOW = Number(process.env.MAX_STRATEGY_POSITIONS_PER_WINDOW || Math.min(2, MAX_POSITIONS_PER_WINDOW));
const BOOSTED_PYRAMID_ENABLED = process.env.BOOSTED_PYRAMID_ENABLED === "1";
const BOOSTED_PYRAMID_MAX_SAME_SIDE_PER_WINDOW = Number(process.env.BOOSTED_PYRAMID_MAX_SAME_SIDE_PER_WINDOW || Math.max(2, MAX_SAME_SIDE_PER_WINDOW));
const BOOSTED_PYRAMID_MIN_REPLAY_BOOSTS = Number(process.env.BOOSTED_PYRAMID_MIN_REPLAY_BOOSTS || 2);
const BOOSTED_PYRAMID_MIN_EDGE = Number(process.env.BOOSTED_PYRAMID_MIN_EDGE || 0.06);
const BOOSTED_PYRAMID_MAX_ENTRY_PRICE = Number(process.env.BOOSTED_PYRAMID_MAX_ENTRY_PRICE || 0.70);
const BOOSTED_PYRAMID_STRATEGIES = String(process.env.BOOSTED_PYRAMID_STRATEGIES || "dual_side_ev,price_field")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const MIN_VALID_ENTRY_PRICE = Number(process.env.MIN_VALID_ENTRY_PRICE || 0.01);
const MIN_YES_NO_ASK_COST = Number(process.env.MIN_YES_NO_ASK_COST || 0.80);
const GATE_MIN_ZSCORE = Number(process.env.GATE_MIN_ZSCORE || (VERY_AGGRESSIVE_SAMPLE_MODE ? 0 : 0.35));
const GATE_MIN_PSI = Number(process.env.GATE_MIN_PSI || (VERY_AGGRESSIVE_SAMPLE_MODE ? 0 : 0.20));
const GATE_MIN_ODDS_VELOCITY = Number(process.env.GATE_MIN_ODDS_VELOCITY || (VERY_AGGRESSIVE_SAMPLE_MODE ? -999 : 0.001));
const GATE_MIN_DISLOCATION_SCORE = Number(process.env.GATE_MIN_DISLOCATION_SCORE || (VERY_AGGRESSIVE_SAMPLE_MODE ? -999 : 0.15));
const CONSENSUS_MIN_AGENTS_FOR_ENTRY = Number(process.env.CONSENSUS_MIN_AGENTS_FOR_ENTRY || (VERY_AGGRESSIVE_SAMPLE_MODE ? 1 : 2));
const CONSENSUS_ALLOW_SINGLE_AGENT_TINY_ENTRY = process.env.CONSENSUS_ALLOW_SINGLE_AGENT_TINY_ENTRY !== "0";
const CONSENSUS_SINGLE_AGENT_STAKE_MULTIPLIER = Number(process.env.CONSENSUS_SINGLE_AGENT_STAKE_MULTIPLIER || 0.35);
const KELLY_SIZING_ENABLED = process.env.KELLY_SIZING_ENABLED === "1";
const KELLY_FRACTION = Number(process.env.KELLY_FRACTION || 0.25);
const KELLY_MAX_FRACTION = Number(process.env.KELLY_MAX_FRACTION || 0.15);
const KELLY_MIN_FRACTION = Number(process.env.KELLY_MIN_FRACTION || 0.005);
const STRATEGY_CURRENT_PREDICTION_ENABLED = process.env.STRATEGY_CURRENT_PREDICTION_ENABLED !== "0";
const STRATEGY_PRICE_FIELD_ENABLED = process.env.STRATEGY_PRICE_FIELD_ENABLED === "1";
const STRATEGY_STICKY_LAG_ENABLED = process.env.STRATEGY_STICKY_LAG_ENABLED === "1";
const STRATEGY_DUAL_SIDE_ENABLED = process.env.STRATEGY_DUAL_SIDE_ENABLED === "1";
const STRATEGY_ORDERBOOK_PRESSURE_ENABLED = process.env.STRATEGY_ORDERBOOK_PRESSURE_ENABLED === "1";
const STRATEGY_NEW_MEMBER_BAND_ENABLED = process.env.STRATEGY_NEW_MEMBER_BAND_ENABLED === "1";
const STRATEGY_ENDCYCLE_SNIPER_ENABLED = process.env.STRATEGY_ENDCYCLE_SNIPER_ENABLED === "1";
const STRATEGY_COMPLETE_SET_ARB_ENABLED = process.env.STRATEGY_COMPLETE_SET_ARB_ENABLED === "1";
const STRATEGY_DUAL_LIMIT_HEDGE_ENABLED = process.env.STRATEGY_DUAL_LIMIT_HEDGE_ENABLED === "1";
const STRATEGY_CROSS_TIMEFRAME_ENABLED = process.env.STRATEGY_CROSS_TIMEFRAME_ENABLED === "1";
const STRATEGY_WEATHER_ENABLED = process.env.STRATEGY_WEATHER_ENABLED === "1" || process.env.WEATHER_STRATEGY_ENABLED === "1";
const PROFIT_FOCUS_MODE = process.env.PROFIT_FOCUS_MODE === "1";
const STRATEGY_AUTO_DISABLE_ENABLED = process.env.STRATEGY_AUTO_DISABLE_ENABLED !== "0";
const STRATEGY_AUTO_DISABLE_MIN_SAMPLES = Number(process.env.STRATEGY_AUTO_DISABLE_MIN_SAMPLES || 50);
const STRATEGY_AUTO_DISABLE_MIN_ROI = Number(process.env.STRATEGY_AUTO_DISABLE_MIN_ROI || 0);
const STRATEGY_AUTO_DISABLE_MIN_WIN_RATE = Number(process.env.STRATEGY_AUTO_DISABLE_MIN_WIN_RATE || 50);
const STRATEGY_FORCE_ALLOW = String(process.env.STRATEGY_FORCE_ALLOW || "").split(",").map((item) => item.trim()).filter(Boolean);
const STRATEGY_FORCE_BLOCK = String(process.env.STRATEGY_FORCE_BLOCK || "").split(",").map((item) => item.trim()).filter(Boolean);
const STRATEGY_EXECUTABLE_STRATEGIES = String(process.env.STRATEGY_EXECUTABLE_STRATEGIES || "current_prediction")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const CANDIDATE_QUALITY_ENABLED = process.env.CANDIDATE_QUALITY_ENABLED !== "0";
const QUALITY_MAX_SPREAD_CENTS = Number(process.env.QUALITY_MAX_SPREAD_CENTS || ACTIVE_BTC_PREDICTION_MAX_SPREAD_CENTS);
const QUALITY_ENTRY_PRICE_MIN = Number(process.env.QUALITY_ENTRY_PRICE_MIN || 0.50);
const QUALITY_ENTRY_PRICE_MAX = Number(process.env.QUALITY_ENTRY_PRICE_MAX || 0.82);
const QUALITY_HIGH_ENTRY_PRICE = Number(process.env.QUALITY_HIGH_ENTRY_PRICE || 0.72);
const QUALITY_HIGH_PRICE_MIN_EDGE = Number(process.env.QUALITY_HIGH_PRICE_MIN_EDGE || 0.08);
const QUALITY_EXCEPTIONAL_EDGE = Number(process.env.QUALITY_EXCEPTIONAL_EDGE || 0.13);
const QUALITY_PRICE_FIELD_MIN_EDGE = Number(process.env.QUALITY_PRICE_FIELD_MIN_EDGE || 0.065);
const QUALITY_PRICE_FIELD_DOWN_MIN_EDGE = Number(process.env.QUALITY_PRICE_FIELD_DOWN_MIN_EDGE || 0.09);
const QUALITY_PRICE_FIELD_MIN_DEPTH_ADVANTAGE = Number(process.env.QUALITY_PRICE_FIELD_MIN_DEPTH_ADVANTAGE || 0.18);
const QUALITY_PRICE_FIELD_MIN_MICRO_EDGE_CENTS = Number(process.env.QUALITY_PRICE_FIELD_MIN_MICRO_EDGE_CENTS || 0.04);
const QUALITY_DUAL_SIDE_MIN_EDGE = Number(process.env.QUALITY_DUAL_SIDE_MIN_EDGE || 0.006);
const QUALITY_DUAL_SIDE_MIN_DEPTH_ADVANTAGE = Number(process.env.QUALITY_DUAL_SIDE_MIN_DEPTH_ADVANTAGE || -0.15);
const QUALITY_DUAL_SIDE_MIN_MICRO_EDGE_CENTS = Number(process.env.QUALITY_DUAL_SIDE_MIN_MICRO_EDGE_CENTS || -0.02);
const QUALITY_DUAL_SIDE_RESTRICT_AFTER_SECONDS = Number(process.env.QUALITY_DUAL_SIDE_RESTRICT_AFTER_SECONDS || 75);
const QUALITY_DUAL_SIDE_A_PLUS_AFTER_SECONDS = Number(process.env.QUALITY_DUAL_SIDE_A_PLUS_AFTER_SECONDS || 105);
const QUALITY_DUAL_SIDE_HARD_BLOCK_AFTER_SECONDS = Number(process.env.QUALITY_DUAL_SIDE_HARD_BLOCK_AFTER_SECONDS || 135);
const QUALITY_DUAL_SIDE_RESTRICTED_MIN_EDGE = Number(process.env.QUALITY_DUAL_SIDE_RESTRICTED_MIN_EDGE || 0.035);
const QUALITY_DUAL_SIDE_RESTRICTED_MIN_DEPTH_ADVANTAGE = Number(process.env.QUALITY_DUAL_SIDE_RESTRICTED_MIN_DEPTH_ADVANTAGE || 0.10);
const QUALITY_DUAL_SIDE_RESTRICTED_MIN_MICRO_EDGE_CENTS = Number(process.env.QUALITY_DUAL_SIDE_RESTRICTED_MIN_MICRO_EDGE_CENTS || 0.02);
const QUALITY_DUAL_SIDE_LATE_A_PLUS_MIN_EDGE = Number(process.env.QUALITY_DUAL_SIDE_LATE_A_PLUS_MIN_EDGE || 0.060);
const QUALITY_DUAL_SIDE_LATE_A_PLUS_MIN_DEPTH_ADVANTAGE = Number(process.env.QUALITY_DUAL_SIDE_LATE_A_PLUS_MIN_DEPTH_ADVANTAGE || 0.20);
const QUALITY_DUAL_SIDE_LATE_A_PLUS_MIN_MICRO_EDGE_CENTS = Number(process.env.QUALITY_DUAL_SIDE_LATE_A_PLUS_MIN_MICRO_EDGE_CENTS || 0.04);
const QUALITY_DOWN_PROBABILITY_PENALTY = Number(process.env.QUALITY_DOWN_PROBABILITY_PENALTY || 0.006);
const QUALITY_DOWN_EDGE_PENALTY = Number(process.env.QUALITY_DOWN_EDGE_PENALTY || 0.010);
const QUALITY_DOWN_MIN_EDGE = Number(process.env.QUALITY_DOWN_MIN_EDGE || 0.021);
const QUALITY_DOWN_MIN_DEPTH_ADVANTAGE = Number(process.env.QUALITY_DOWN_MIN_DEPTH_ADVANTAGE || -0.10);
const QUALITY_DOWN_MIN_MICRO_EDGE_CENTS = Number(process.env.QUALITY_DOWN_MIN_MICRO_EDGE_CENTS || -0.01);
const QUALITY_ORDERBOOK_MIN_EDGE = Number(process.env.QUALITY_ORDERBOOK_MIN_EDGE || 0.03);
const QUALITY_ORDERBOOK_MIN_CONFIRMATIONS = Number(process.env.QUALITY_ORDERBOOK_MIN_CONFIRMATIONS || 2);
const QUALITY_ORDERBOOK_MIN_PRESSURE = Number(process.env.QUALITY_ORDERBOOK_MIN_PRESSURE || 0.22);
const QUALITY_ORDERBOOK_MIN_DEPTH_ADVANTAGE = Number(process.env.QUALITY_ORDERBOOK_MIN_DEPTH_ADVANTAGE || 0.30);
const QUALITY_ORDERBOOK_MIN_MICRO_EDGE_CENTS = Number(process.env.QUALITY_ORDERBOOK_MIN_MICRO_EDGE_CENTS || 0.08);
const QUALITY_C_ENTRY_ENABLED = process.env.QUALITY_C_ENTRY_ENABLED === "1";
const QUALITY_A_PLUS_REQUIRE_BOOK_CONFIRMATION = process.env.QUALITY_A_PLUS_REQUIRE_BOOK_CONFIRMATION !== "0";
const QUALITY_A_PLUS_MIN_DEPTH_PRESSURE = Number(process.env.QUALITY_A_PLUS_MIN_DEPTH_PRESSURE || 0.05);
const QUALITY_A_PLUS_MIN_DEPTH_ADVANTAGE = Number(process.env.QUALITY_A_PLUS_MIN_DEPTH_ADVANTAGE || 0.10);
const QUALITY_A_PLUS_MIN_MICRO_EDGE_CENTS = Number(process.env.QUALITY_A_PLUS_MIN_MICRO_EDGE_CENTS || 0.01);
const QUALITY_LATE_WINDOW_SECONDS = Number(process.env.QUALITY_LATE_WINDOW_SECONDS || 180);
const QUALITY_LATE_ENTRY_PRICE = Number(process.env.QUALITY_LATE_ENTRY_PRICE || 0.62);
const QUALITY_LATE_ENTRY_MIN_EDGE = Number(process.env.QUALITY_LATE_ENTRY_MIN_EDGE || 0.18);
const QUALITY_LATE_ENTRY_MIN_DEPTH_ADVANTAGE = Number(process.env.QUALITY_LATE_ENTRY_MIN_DEPTH_ADVANTAGE || 0.35);
const QUALITY_LATE_ENTRY_MIN_MICRO_EDGE_CENTS = Number(process.env.QUALITY_LATE_ENTRY_MIN_MICRO_EDGE_CENTS || 0.03);
const QUALITY_MOMENTUM_AGAINST_MAX_BPS = Number(process.env.QUALITY_MOMENTUM_AGAINST_MAX_BPS || 2);
const QUALITY_SAMPLE_GUARD_ENABLED = process.env.QUALITY_SAMPLE_GUARD_ENABLED !== "0";
const QUALITY_INFLATED_EDGE_PERCENT = Number(process.env.QUALITY_INFLATED_EDGE_PERCENT || 30);
const QUALITY_LATE_WEAK_BOOK_SECONDS = Number(process.env.QUALITY_LATE_WEAK_BOOK_SECONDS || 180);
const QUALITY_LATE_WEAK_BOOK_ENTRY_PRICE = Number(process.env.QUALITY_LATE_WEAK_BOOK_ENTRY_PRICE || 0.55);
const QUALITY_WEAK_BOOK_WIDE_SPREAD_CENTS = Number(process.env.QUALITY_WEAK_BOOK_WIDE_SPREAD_CENTS || 4);

const SOFT_QUALITY_MODE = process.env.SOFT_QUALITY_MODE !== "0";
const RUNTIME_RULE_CACHE_ENABLED = process.env.RUNTIME_RULE_CACHE_ENABLED === "1";
const RUNTIME_RULE_CACHE_MAX_SIGNALS = Number(process.env.RUNTIME_RULE_CACHE_MAX_SIGNALS || 120);
const RUNTIME_RULE_CACHE_MIN_BUCKET_SAMPLES = Number(process.env.RUNTIME_RULE_CACHE_MIN_BUCKET_SAMPLES || 2);
const RUNTIME_RULE_CACHE_RECENT_HALFLIFE_TRADES = Number(process.env.RUNTIME_RULE_CACHE_RECENT_HALFLIFE_TRADES || 24);
const RUNTIME_RULE_CACHE_MIN_STAKE_MULTIPLIER = Number(process.env.RUNTIME_RULE_CACHE_MIN_STAKE_MULTIPLIER || 0.08);
const RUNTIME_RULE_CACHE_MAX_STAKE_MULTIPLIER = Number(process.env.RUNTIME_RULE_CACHE_MAX_STAKE_MULTIPLIER || 1.25);
const RUNTIME_RULE_CACHE_MAX_SCORE_ADJUSTMENT = Number(process.env.RUNTIME_RULE_CACHE_MAX_SCORE_ADJUSTMENT || 60);
const RUNTIME_RULE_CACHE_TOXIC_MIN_TRADES = Number(process.env.RUNTIME_RULE_CACHE_TOXIC_MIN_TRADES || 5);
const RUNTIME_RULE_CACHE_TOXIC_MAX_WIN_RATE = Number(process.env.RUNTIME_RULE_CACHE_TOXIC_MAX_WIN_RATE || 35);
const RUNTIME_RULE_CACHE_TOXIC_MIN_ROI = Number(process.env.RUNTIME_RULE_CACHE_TOXIC_MIN_ROI || -35);
const RUNTIME_RULE_CACHE_TOXIC_STAKE_MULTIPLIER = Number(process.env.RUNTIME_RULE_CACHE_TOXIC_STAKE_MULTIPLIER || 0.10);
const RUNTIME_RULE_CACHE_TOXIC_SCORE_PENALTY = Number(process.env.RUNTIME_RULE_CACHE_TOXIC_SCORE_PENALTY || -60);
const RUNTIME_TOXIC_MAX_STAKE_USD = Number(process.env.RUNTIME_TOXIC_MAX_STAKE_USD || 1.00);
const RUNTIME_PROBE_MAX_STAKE_USD = Number(process.env.RUNTIME_PROBE_MAX_STAKE_USD || 1.25);
const SOFT_QUALITY_PROBE_MAX_STAKE_USD = Number(process.env.SOFT_QUALITY_PROBE_MAX_STAKE_USD || 1.25);
const REST_BOOK_MAX_STAKE_USD = Number(process.env.REST_BOOK_MAX_STAKE_USD || 1.00);
const LATE_75_105_MAX_STAKE_USD = Number(process.env.LATE_75_105_MAX_STAKE_USD || 1.50);
const LATE_105_135_MAX_STAKE_USD = Number(process.env.LATE_105_135_MAX_STAKE_USD || 1.00);
const PRICE_055_059_MAX_STAKE_USD = Number(process.env.PRICE_055_059_MAX_STAKE_USD || 2.20);
const PRICE_065_069_MAX_STAKE_USD = Number(process.env.PRICE_065_069_MAX_STAKE_USD || 1.00);
const PRICE_070_082_MAX_STAKE_USD = Number(process.env.PRICE_070_082_MAX_STAKE_USD || 1.00);
// V374.5 has no artificial fixed-dollar execution floor. The only floor is
// max(PAPER_MIN_RECORDED_FILL_USD, market minimum shares × final fill price).
const MIN_EXECUTABLE_STAKE_USD = 0;
const ACTIVE_POSITION_IMMUTABILITY_GUARD_ENABLED = process.env.ACTIVE_POSITION_IMMUTABILITY_GUARD_ENABLED !== "0";
const MIN_PROBE_STAKE_USD = Number(process.env.MIN_PROBE_STAKE_USD || 1.00);
const MIN_CLEAN_STAKE_USD = Number(process.env.MIN_CLEAN_STAKE_USD || 1.00);
const EXECUTION_QUALITY_ENABLED = process.env.EXECUTION_QUALITY_ENABLED === "1";
const EXECUTION_MIN_QUALITY_SCORE = Number(process.env.EXECUTION_MIN_QUALITY_SCORE || 108);
const EXECUTION_EXCEPTIONAL_QUALITY_SCORE = Number(process.env.EXECUTION_EXCEPTIONAL_QUALITY_SCORE || 122);
const EXECUTION_MAX_FULL_STAKE_BOOK_AGE_MS = Number(process.env.EXECUTION_MAX_FULL_STAKE_BOOK_AGE_MS || 250);
const EXECUTION_MAX_REDUCED_BOOK_AGE_MS = Number(process.env.EXECUTION_MAX_REDUCED_BOOK_AGE_MS || 750);
const EXECUTION_REPLAY_BAD_PENALTY = Number(process.env.EXECUTION_REPLAY_BAD_PENALTY || 25);
const EXECUTION_RUNTIME_TOXIC_PENALTY = Number(process.env.EXECUTION_RUNTIME_TOXIC_PENALTY || 18);
const EXECUTION_SUSPICIOUS_EDGE_PERCENT = Number(process.env.EXECUTION_SUSPICIOUS_EDGE_PERCENT || 20);
const EXECUTION_SUSPICIOUS_EDGE_PENALTY = Number(process.env.EXECUTION_SUSPICIOUS_EDGE_PENALTY || 16);
const EXECUTION_MODE = process.env.EXECUTION_MODE || "balanced_clean_aggressive";
const CLEAN_UP_MIN_SCORE = Number(process.env.CLEAN_UP_MIN_SCORE || 118);
const CLEAN_DOWN_MIN_SCORE = Number(process.env.CLEAN_DOWN_MIN_SCORE || 145);
const REPLAY_BLOCK_UP_MIN_SCORE = Number(process.env.REPLAY_BLOCK_UP_MIN_SCORE || 142);
const REPLAY_BLOCK_DOWN_OBSERVE_ONLY = process.env.REPLAY_BLOCK_DOWN_OBSERVE_ONLY !== "0";
const REPLAY_BLOCK_UP_MAX_STAKE_USD = Number(process.env.REPLAY_BLOCK_UP_MAX_STAKE_USD || 1.25);
const DOWN_RECOVERY_MAX_STAKE_USD = Number(process.env.DOWN_RECOVERY_MAX_STAKE_USD || 1.25);
const EXECUTION_LOW_SCORE_OBSERVE_ONLY = process.env.EXECUTION_LOW_SCORE_OBSERVE_ONLY !== "0";
const EXECUTION_LOW_SCORE_OBSERVE_MAX = Number(process.env.EXECUTION_LOW_SCORE_OBSERVE_MAX || 124);
const RECOVERY_MODE_ENABLED = process.env.RECOVERY_MODE_ENABLED !== "0";
const RECOVERY_LOOKBACK_TRADES = Number(process.env.RECOVERY_LOOKBACK_TRADES || 10);
const RECOVERY_MIN_WIN_RATE = Number(process.env.RECOVERY_MIN_WIN_RATE || 50);
const RECOVERY_MIN_ROI = Number(process.env.RECOVERY_MIN_ROI || 0);
const RECOVERY_EXIT_WIN_RATE = Number(process.env.RECOVERY_EXIT_WIN_RATE || 60);
const RECOVERY_EXIT_ROI = Number(process.env.RECOVERY_EXIT_ROI || 0);
const RECOVERY_DOWN_MIN_SCORE = Number(process.env.RECOVERY_DOWN_MIN_SCORE || 155);
const RECOVERY_REPLAY_BLOCK_OBSERVE_ONLY = process.env.RECOVERY_REPLAY_BLOCK_OBSERVE_ONLY !== "0";
const RECOVERY_NO_PROGRESSIVE_BOOST = process.env.RECOVERY_NO_PROGRESSIVE_BOOST !== "0";
const REPLAY_SOFT_BLOCK_UP_STAKE_MULTIPLIER = Number(process.env.REPLAY_SOFT_BLOCK_UP_STAKE_MULTIPLIER || 0.65);
const REPLAY_SOFT_BLOCK_DOWN_STAKE_MULTIPLIER = Number(process.env.REPLAY_SOFT_BLOCK_DOWN_STAKE_MULTIPLIER || 0.45);
const REPLAY_SOFT_BLOCK_SCORE_PENALTY = Number(process.env.REPLAY_SOFT_BLOCK_SCORE_PENALTY || 10);

const REAL_EXECUTION_READINESS_ENABLED = process.env.REAL_EXECUTION_READINESS_ENABLED !== "0";
const REAL_EXECUTION_MODE = process.env.REAL_EXECUTION_MODE || "paper_shadow";
const REAL_ORDER_MAX_TEST_STAKE_USD = Number(process.env.REAL_ORDER_MAX_TEST_STAKE_USD || 1.00);
const REAL_SHADOW_CAP_PAPER_STAKE = process.env.REAL_SHADOW_CAP_PAPER_STAKE === "1";
const REAL_TICK_SIZE_DEFAULT = Number(process.env.REAL_TICK_SIZE_DEFAULT || 0.01);
const REAL_TICK_SIZE_TOLERANCE = Number(process.env.REAL_TICK_SIZE_TOLERANCE || 0.000001);
const REAL_SHADOW_ENABLED = process.env.REAL_SHADOW_ENABLED !== "0";
const REAL_SHADOW_BLOCK_UNREALISTIC_PAPER = process.env.REAL_SHADOW_BLOCK_UNREALISTIC_PAPER === "1";
const REAL_SHADOW_MAX_BOOK_AGE_MS = Number(process.env.REAL_SHADOW_MAX_BOOK_AGE_MS || 750);
const REAL_SHADOW_REQUIRE_WS_BOOK = process.env.REAL_SHADOW_REQUIRE_WS_BOOK !== "0";
const REAL_SHADOW_SLIPPAGE_CENTS = Number(process.env.REAL_SHADOW_SLIPPAGE_CENTS || 1);
const REAL_SHADOW_MIN_DEPTH_MULTIPLIER = Number(process.env.REAL_SHADOW_MIN_DEPTH_MULTIPLIER || 1.25);
const REAL_SHADOW_PARTIAL_FILL_MIN_FRACTION = Number(process.env.REAL_SHADOW_PARTIAL_FILL_MIN_FRACTION || 0.80);
const REAL_SHADOW_ALLOW_PARTIAL_FILL = process.env.REAL_SHADOW_ALLOW_PARTIAL_FILL !== "0";
const REAL_SHADOW_MAX_STAKE_USD = Number(process.env.REAL_SHADOW_MAX_STAKE_USD || 1.00);
const PAPER_ORDER_TYPE = String(process.env.PAPER_ORDER_TYPE || "FAK").toUpperCase();
const PAPER_MAX_SLIPPAGE_CENTS = Number(process.env.PAPER_MAX_SLIPPAGE_CENTS || REAL_SHADOW_SLIPPAGE_CENTS);
const PAPER_CRYPTO_TAKER_FEE_RATE = Number(process.env.PAPER_CRYPTO_TAKER_FEE_RATE || 0.07);
const PAPER_MIN_RECORDED_FILL_USD = Number(process.env.PAPER_MIN_RECORDED_FILL_USD || 0.01);

const RUNTIME_RULE_CACHE_PERSIST_MS = Number(process.env.RUNTIME_RULE_CACHE_PERSIST_MS || 15_000);
const RUNTIME_RULE_CACHE_PATH = process.env.RUNTIME_RULE_CACHE_PATH || path.join(DATA_DIR, "learning", "runtime-rule-cache.json");
const CALIBRATED_ENTRY_MODEL_ENABLED = process.env.CALIBRATED_ENTRY_MODEL_ENABLED === "1";
const LEGACY_CALIBRATION_EXECUTION_GATE_ENABLED = process.env.LEGACY_CALIBRATION_EXECUTION_GATE_ENABLED === "1";
const REGIME_CORE_POLICY_ENABLED = process.env.REGIME_CORE_POLICY_ENABLED === "1";
const CALIBRATED_ENTRY_MODEL_PATH = process.env.CALIBRATED_ENTRY_MODEL_PATH || path.join(DATA_DIR, "learning", "walkforward-calibration.json");
const CALIBRATED_TARGET_WIN_RATE = Number(process.env.CALIBRATED_TARGET_WIN_RATE || 75);
const CALIBRATED_LANE_S_MIN_WIN_PROB = Number(process.env.CALIBRATED_LANE_S_MIN_WIN_PROB || 0.74);
const CALIBRATED_LANE_A_MIN_WIN_PROB = Number(process.env.CALIBRATED_LANE_A_MIN_WIN_PROB || 0.64);
const CALIBRATED_LANE_B_MIN_WIN_PROB = Number(process.env.CALIBRATED_LANE_B_MIN_WIN_PROB || 0.58);
const CALIBRATED_LANE_A_MIN_NET_EV = Number(process.env.CALIBRATED_LANE_A_MIN_NET_EV || 0.018);
const CALIBRATED_LANE_B_MIN_NET_EV = Number(process.env.CALIBRATED_LANE_B_MIN_NET_EV || 0.006);
const CALIBRATED_LANE_B_MAX_STAKE_USD = Number(process.env.CALIBRATED_LANE_B_MAX_STAKE_USD || LANE_B_MAX_TRADE_USD);
const FAST_GROW_EV_POLICY_ENABLED = process.env.FAST_GROW_EV_POLICY_ENABLED === "1";
const FAST_GROW_EV_MIN_NET_EDGE = Number(process.env.FAST_GROW_EV_MIN_NET_EDGE || 0.05);
const FAST_GROW_EV_LANE_S_MIN_NET_EDGE = Number(process.env.FAST_GROW_EV_LANE_S_MIN_NET_EDGE || 0.10);
const FAST_GROW_EV_LANE_A_MIN_FRACTION = Number(process.env.FAST_GROW_EV_LANE_A_MIN_FRACTION || 0.08);
const FAST_GROW_EV_LANE_A_MAX_FRACTION = Number(process.env.FAST_GROW_EV_LANE_A_MAX_FRACTION || 0.10);
const FAST_GROW_EV_LANE_S_MIN_FRACTION = Number(process.env.FAST_GROW_EV_LANE_S_MIN_FRACTION || 0.12);
const FAST_GROW_EV_LANE_S_MAX_FRACTION = Number(process.env.FAST_GROW_EV_LANE_S_MAX_FRACTION || 0.15);
const FAST_GROW_EV_LANE_S_MAX_EDGE = Number(process.env.FAST_GROW_EV_LANE_S_MAX_EDGE || 0.20);
const FAST_GROW_DEPTH_UTILIZATION = Number(process.env.FAST_GROW_DEPTH_UTILIZATION || 1);
const FAST_GROW_SKIP_BELOW_MARKET_MIN = process.env.FAST_GROW_SKIP_BELOW_MARKET_MIN !== "0";
const INDEPENDENT_ASSET_EDGE_ENABLED = process.env.INDEPENDENT_ASSET_EDGE_ENABLED !== "0";
const INDEPENDENT_ASSET_MIN_NET_EDGE = Number(process.env.INDEPENDENT_ASSET_MIN_NET_EDGE || 0.05);
const INDEPENDENT_ASSET_STRESS_SLIPPAGE_PER_SHARE = Number(process.env.INDEPENDENT_ASSET_STRESS_SLIPPAGE_PER_SHARE || 0.005);
const ELIGIBILITY_EPISODE_ENABLED = process.env.ELIGIBILITY_EPISODE_ENABLED !== "0";
const ELIGIBILITY_EPISODE_STRONG_ASSET_NET_EDGE = Number(process.env.ELIGIBILITY_EPISODE_STRONG_ASSET_NET_EDGE || 0.075);
const ELIGIBILITY_EPISODE_NEAR_SNAPSHOTS = Number(process.env.ELIGIBILITY_EPISODE_NEAR_SNAPSHOTS || 3);
const ELIGIBILITY_EPISODE_STRONG_SNAPSHOTS = Number(process.env.ELIGIBILITY_EPISODE_STRONG_SNAPSHOTS || 2);
const ELIGIBILITY_EPISODE_MIN_CHAINLINK_EVENTS = Number(process.env.ELIGIBILITY_EPISODE_MIN_CHAINLINK_EVENTS || 2);
const ELIGIBILITY_EPISODE_NEAR_DURATION_MS = Number(process.env.ELIGIBILITY_EPISODE_NEAR_DURATION_MS || 400);
const ELIGIBILITY_EPISODE_STRONG_DURATION_MS = Number(process.env.ELIGIBILITY_EPISODE_STRONG_DURATION_MS || 150);
const ELIGIBILITY_EPISODE_MAX_GAP_MS = Number(process.env.ELIGIBILITY_EPISODE_MAX_GAP_MS || 2_000);
const COHORT_REGIME_GUARD_ENABLED = process.env.COHORT_REGIME_GUARD_ENABLED === "1";
const COHORT_REGIME_GUARD_LOOKBACK = Number(process.env.COHORT_REGIME_GUARD_LOOKBACK || 3);
const COHORT_REGIME_GUARD_LOSS_TRIGGER = Number(process.env.COHORT_REGIME_GUARD_LOSS_TRIGGER || 2);
const COHORT_REGIME_GUARD_TTL_SETTLEMENTS = Number(process.env.COHORT_REGIME_GUARD_TTL_SETTLEMENTS || 3);
const CALIBRATED_REPLAY_LANE_A_MAX_STAKE_USD = Number(process.env.CALIBRATED_REPLAY_LANE_A_MAX_STAKE_USD || 2.20);
const CALIBRATED_CLEAR_WINDOW_START = Number(process.env.CALIBRATED_CLEAR_WINDOW_START || 30);
const CALIBRATED_CLEAR_WINDOW_END = Number(process.env.CALIBRATED_CLEAR_WINDOW_END || 105);
const CALIBRATED_HIGH_SCORE_MIN = Number(process.env.CALIBRATED_HIGH_SCORE_MIN || 128);
const CALIBRATED_FAST_FALLBACK_SCORE_MIN = Number(process.env.CALIBRATED_FAST_FALLBACK_SCORE_MIN || 102);
const CALIBRATED_OBSERVE_REPLAY_BLOCK = process.env.CALIBRATED_OBSERVE_REPLAY_BLOCK !== "0";
const CALIBRATED_PROFIT_WINDOW_START = Number(process.env.CALIBRATED_PROFIT_WINDOW_START || 45);
const CALIBRATED_PROFIT_WINDOW_END = Number(process.env.CALIBRATED_PROFIT_WINDOW_END || 60);
const FAST_CANDIDATE_BRIDGE_ENABLED = process.env.FAST_CANDIDATE_BRIDGE_ENABLED === "1";
const FAST_WORTH_IT_LANE_ENABLED = process.env.FAST_WORTH_IT_LANE_ENABLED === "1";
const FAST_WORTH_IT_MIN_EDGE = Number(process.env.FAST_WORTH_IT_MIN_EDGE || 0.003);
const FAST_WORTH_IT_MIN_NET_EV = Number(process.env.FAST_WORTH_IT_MIN_NET_EV || 0.002);
const FAST_WORTH_IT_MAX_ENTRY_PRICE = Number(process.env.FAST_WORTH_IT_MAX_ENTRY_PRICE || 0.64);
const FAST_WORTH_IT_MAX_SPREAD_CENTS = Number(process.env.FAST_WORTH_IT_MAX_SPREAD_CENTS || 4);
const FAST_WORTH_IT_MAX_BOOK_AGE_MS = Number(process.env.FAST_WORTH_IT_MAX_BOOK_AGE_MS || 750);
const FAST_WORTH_IT_MIN_DEPTH_SHARES = Number(process.env.FAST_WORTH_IT_MIN_DEPTH_SHARES || 1);
const FAST_WORTH_IT_UP_MAX_STAKE_USD = Number(process.env.FAST_WORTH_IT_UP_MAX_STAKE_USD || 2.50);
const FAST_WORTH_IT_DOWN_MAX_STAKE_USD = Number(process.env.FAST_WORTH_IT_DOWN_MAX_STAKE_USD || 1.25);
const STARTUP_PROTECTION_SETTLED_TRADES = Number(process.env.STARTUP_PROTECTION_SETTLED_TRADES || 20);
const STARTUP_PROTECTION_ENABLED = process.env.STARTUP_PROTECTION_ENABLED !== "0";
const STARTUP_LANE_A_MAX_STAKE_USD = Number(process.env.STARTUP_LANE_A_MAX_STAKE_USD || 2.20);
const STARTUP_A_PLUS_MAX_STAKE_USD = Number(process.env.STARTUP_A_PLUS_MAX_STAKE_USD || 2.20);
const STARTUP_15M_MAX_STAKE_USD = Number(process.env.STARTUP_15M_MAX_STAKE_USD || 1.25);
const ENTRY_STARVATION_FAILSAFE_ENABLED = process.env.ENTRY_STARVATION_FAILSAFE_ENABLED !== "0";
const ENTRY_STARVATION_IDLE_MS = Number(process.env.ENTRY_STARVATION_IDLE_MS || 90_000);
const ENTRY_STARVATION_MIN_OPPORTUNITIES = Number(process.env.ENTRY_STARVATION_MIN_OPPORTUNITIES || 3);
const ENTRY_STARVATION_MAX_STAKE_USD = Number(process.env.ENTRY_STARVATION_MAX_STAKE_USD || 1.00);
const ROUTER_EMPTY_DIAGNOSTICS_ENABLED = process.env.ROUTER_EMPTY_DIAGNOSTICS_ENABLED !== "0";
const PROFIT_LOCK_ENABLED = process.env.PROFIT_LOCK_ENABLED !== "0";
const PROFIT_LOCK_MIN_PEAK_PROFIT_USD = Number(process.env.PROFIT_LOCK_MIN_PEAK_PROFIT_USD || 4);
const PROFIT_LOCK_GIVEBACK_RATIO = Number(process.env.PROFIT_LOCK_GIVEBACK_RATIO || 0.25);
const PROFIT_LOCK_HARD_RECOVERY_GIVEBACK_RATIO = Number(process.env.PROFIT_LOCK_HARD_RECOVERY_GIVEBACK_RATIO || 0.45);
const PROFIT_LOCK_LANE_A_MAX_STAKE_USD = Number(process.env.PROFIT_LOCK_LANE_A_MAX_STAKE_USD || 2.20);
const PROFIT_LOCK_HARD_LANE_A_MAX_STAKE_USD = Number(process.env.PROFIT_LOCK_HARD_LANE_A_MAX_STAKE_USD || 1.25);
const PROFIT_LOCK_LANE_B_MAX_STAKE_USD = Number(process.env.PROFIT_LOCK_LANE_B_MAX_STAKE_USD || 1.00);
const PROFIT_LOCK_DISABLE_PROGRESSIVE = process.env.PROFIT_LOCK_DISABLE_PROGRESSIVE !== "0";
const PROFIT_LOCK_AFTER_PROFIT_USD = Number(process.env.PROFIT_LOCK_AFTER_PROFIT_USD || 8);
const PROFIT_LOCK_AFTER_PROFIT_LANE_B_MAX_PER_WINDOW = Number(process.env.PROFIT_LOCK_AFTER_PROFIT_LANE_B_MAX_PER_WINDOW || 1);

// Win-Safe Stake Reset
const STAKE_RESET_ON_WIN_SAFE_ENABLED = process.env.STAKE_RESET_ON_WIN_SAFE_ENABLED !== "0";
const STAKE_RESET_WIN_SAFE_LANES = process.env.STAKE_RESET_WIN_SAFE_LANES || "A,S";

const WINDOW_30_45_LANE_A_MAX_STAKE_USD = Number(process.env.WINDOW_30_45_LANE_A_MAX_STAKE_USD || 1.25);
const WINDOW_60_75_LANE_A_MAX_STAKE_USD = Number(process.env.WINDOW_60_75_LANE_A_MAX_STAKE_USD || 1.25);
const WINDOW_75_105_PROBE_MAX_STAKE_USD = Number(process.env.WINDOW_75_105_PROBE_MAX_STAKE_USD || 1.00);
const WINDOW_105_135_PROBE_MAX_STAKE_USD = Number(process.env.WINDOW_105_135_PROBE_MAX_STAKE_USD || 1.00);
const LANE_A_DEFAULT_MAX_STAKE_USD = Number(process.env.LANE_A_DEFAULT_MAX_STAKE_USD || 2.20);
const LANE_A_PROFIT_WINDOW_MAX_STAKE_USD = Number(process.env.LANE_A_PROFIT_WINDOW_MAX_STAKE_USD || PAPER_MAX_TRADE_USD);
const A_PLUS_FULL_STAKE_MIN_SCORE = Number(process.env.A_PLUS_FULL_STAKE_MIN_SCORE || 220);
const A_PLUS_NON_PREMIUM_MAX_STAKE_USD = Number(process.env.A_PLUS_NON_PREMIUM_MAX_STAKE_USD || 3.50);
const TIMEFRAME_15M_MAX_STAKE_USD = Number(process.env.TIMEFRAME_15M_MAX_STAKE_USD || 1.25);
const DOWN_MAX_STAKE_USD = Number(process.env.DOWN_MAX_STAKE_USD || 1.25);
const DOWN_LANE_S_EXTREME_MIN_SCORE = Number(process.env.DOWN_LANE_S_EXTREME_MIN_SCORE || 220);

// v330 anti-cluster / startup protection. Keeps scan fast, but prevents correlated full-stake bursts.
const CLUSTER_GUARD_ENABLED = process.env.CLUSTER_GUARD_ENABLED !== "0";
const STARTUP_PROTECTION_RUNTIME_MS = Number(process.env.STARTUP_PROTECTION_RUNTIME_MS || 20 * 60_000);
const STARTUP_MAX_TOTAL_POSITIONS_PER_WINDOW = Math.min(3, Number(process.env.STARTUP_MAX_TOTAL_POSITIONS_PER_WINDOW || 2));
const STARTUP_MAX_FULL_STAKE_PER_WINDOW = Number(process.env.STARTUP_MAX_FULL_STAKE_PER_WINDOW || 1);
const STARTUP_MAX_SAME_SIDE_CRYPTO_PER_WINDOW = Math.min(3, Number(process.env.STARTUP_MAX_SAME_SIDE_CRYPTO_PER_WINDOW || 1));
const STARTUP_FAST_BRIDGE_MAX_STAKE_USD = Number(process.env.STARTUP_FAST_BRIDGE_MAX_STAKE_USD || 1.50);
const CLUSTER_MAX_TOTAL_POSITIONS_PER_WINDOW = Number(process.env.CLUSTER_MAX_TOTAL_POSITIONS_PER_WINDOW || 3);
const CLUSTER_MAX_NORMAL_POSITIONS_PER_WINDOW = Number(process.env.CLUSTER_MAX_NORMAL_POSITIONS_PER_WINDOW || 2);
const MAX_SAME_SIDE_CRYPTO_POSITIONS_PER_WINDOW = Number(process.env.MAX_SAME_SIDE_CRYPTO_POSITIONS_PER_WINDOW || 1);
const MAX_FULL_STAKE_SAME_SIDE_PER_WINDOW = Number(process.env.MAX_FULL_STAKE_SAME_SIDE_PER_WINDOW || 1);
const CLUSTER_FULL_STAKE_THRESHOLD_USD = Number(process.env.CLUSTER_FULL_STAKE_THRESHOLD_USD || 2.50);
const CLUSTER_PROBE_STAKE_USD = Number(process.env.CLUSTER_PROBE_STAKE_USD || 1.00);
const PRICE_060_064_MAX_STAKE_USD = Number(process.env.PRICE_060_064_MAX_STAKE_USD || 1.50);
const PRICE_065_082_MAX_STAKE_USD = Number(process.env.PRICE_065_082_MAX_STAKE_USD || 1.00);
const BRIDGE_UP_MAX_STAKE_USD = Number(process.env.BRIDGE_UP_MAX_STAKE_USD || 1.50);
const BRIDGE_DOWN_MAX_STAKE_USD = Number(process.env.BRIDGE_DOWN_MAX_STAKE_USD || 1.00);
const SAME_WINDOW_LOSS_BRAKE_ENABLED = process.env.SAME_WINDOW_LOSS_BRAKE_ENABLED !== "0";
const SAME_WINDOW_LOSS_BRAKE_COUNT = Number(process.env.SAME_WINDOW_LOSS_BRAKE_COUNT || 2);
const RECENT_LOSS_BRAKE_ENABLED = process.env.RECENT_LOSS_BRAKE_ENABLED !== "0";
const RECENT_LOSS_BRAKE_LOOKBACK = Number(process.env.RECENT_LOSS_BRAKE_LOOKBACK || 5);
const RECENT_LOSS_BRAKE_MAX_STAKE_USD = Number(process.env.RECENT_LOSS_BRAKE_MAX_STAKE_USD || 2.00);

// v332 Polymarket Edge Engine: EV-first routing, microstructure confirmation, Kelly-lite sizing, and guarded equity scaling.
const EDGE_ENGINE_ENABLED = process.env.EDGE_ENGINE_ENABLED === "1";
const EDGE_ENGINE_TARGET_WIN_RATE = Number(process.env.EDGE_ENGINE_TARGET_WIN_RATE || 0.64);
const EDGE_ENGINE_LANE_S_MIN_WIN_PROB = Number(process.env.EDGE_ENGINE_LANE_S_MIN_WIN_PROB || 0.68);
const EDGE_ENGINE_LANE_A_MIN_WIN_PROB = Number(process.env.EDGE_ENGINE_LANE_A_MIN_WIN_PROB || 0.61);
const EDGE_ENGINE_LANE_B_MIN_WIN_PROB = Number(process.env.EDGE_ENGINE_LANE_B_MIN_WIN_PROB || 0.56);
const EDGE_ENGINE_LANE_S_MIN_NET_EV = Number(process.env.EDGE_ENGINE_LANE_S_MIN_NET_EV || 0.035);
const EDGE_ENGINE_LANE_A_MIN_NET_EV = Number(process.env.EDGE_ENGINE_LANE_A_MIN_NET_EV || 0.018);
const EDGE_ENGINE_LANE_B_MIN_NET_EV = Number(process.env.EDGE_ENGINE_LANE_B_MIN_NET_EV || 0.006);
const EDGE_ENGINE_MICROSTRUCTURE_WEIGHT = Number(process.env.EDGE_ENGINE_MICROSTRUCTURE_WEIGHT || 0.30);
const EDGE_ENGINE_DUAL_PROBABILITY_WEIGHT = Number(process.env.EDGE_ENGINE_DUAL_PROBABILITY_WEIGHT || 0.30);
const EDGE_ENGINE_KELLY_LITE_ENABLED = process.env.EDGE_ENGINE_KELLY_LITE_ENABLED !== "0";
const EDGE_ENGINE_KELLY_LITE_FRACTION = Number(process.env.EDGE_ENGINE_KELLY_LITE_FRACTION || 0.28);
const EDGE_ENGINE_KELLY_MAX_FRACTION = Number(process.env.EDGE_ENGINE_KELLY_MAX_FRACTION || 0.08);
const EDGE_ENGINE_LANE_S_MAX_STAKE_USD = Number(process.env.EDGE_ENGINE_LANE_S_MAX_STAKE_USD || PAPER_MAX_TRADE_USD);
const EDGE_ENGINE_LANE_A_MIN_STAKE_USD = Number(process.env.EDGE_ENGINE_LANE_A_MIN_STAKE_USD || 2.00);
const EDGE_ENGINE_LANE_A_MAX_STAKE_USD = Number(process.env.EDGE_ENGINE_LANE_A_MAX_STAKE_USD || 4.00);
const EDGE_ENGINE_LANE_B_MIN_STAKE_USD = Number(process.env.EDGE_ENGINE_LANE_B_MIN_STAKE_USD || 1.00);
const EDGE_ENGINE_LANE_B_MAX_STAKE_USD = Number(process.env.EDGE_ENGINE_LANE_B_MAX_STAKE_USD || 1.25);
const EDGE_ENGINE_DOWN_LANE_A_MAX_STAKE_USD = Number(process.env.EDGE_ENGINE_DOWN_LANE_A_MAX_STAKE_USD || 2.20);
const EDGE_ENGINE_DOWN_LANE_S_MAX_STAKE_USD = Number(process.env.EDGE_ENGINE_DOWN_LANE_S_MAX_STAKE_USD || 3.50);
const EDGE_ENGINE_15M_LANE_A_MAX_STAKE_USD = Number(process.env.EDGE_ENGINE_15M_LANE_A_MAX_STAKE_USD || 2.20);
const EDGE_ENGINE_15M_LANE_S_MAX_STAKE_USD = Number(process.env.EDGE_ENGINE_15M_LANE_S_MAX_STAKE_USD || 3.50);
const S_LANE_THROTTLE_ENABLED = process.env.S_LANE_THROTTLE_ENABLED !== "0";
const S_LANE_COLD_SETTLED_TRADES = Number(process.env.S_LANE_COLD_SETTLED_TRADES || STARTUP_PROTECTION_SETTLED_TRADES);
const S_LANE_COLD_MAX_STAKE_USD = Number(process.env.S_LANE_COLD_MAX_STAKE_USD || EDGE_ENGINE_LANE_B_MAX_STAKE_USD);
const S_LANE_RECOVERY_MAX_STAKE_USD = Number(process.env.S_LANE_RECOVERY_MAX_STAKE_USD || Math.max(EDGE_ENGINE_LANE_B_MAX_STAKE_USD, 3.25));
const S_LANE_FULL_STAKE_MIN_PNL_USD = Number(process.env.S_LANE_FULL_STAKE_MIN_PNL_USD || 3.00);
const S_LANE_FULL_STAKE_MIN_WIN_RATE = Number(process.env.S_LANE_FULL_STAKE_MIN_WIN_RATE || 62);
const FIFTEEN_M_GLOBAL_MAX_STAKE_USD = Number(process.env.FIFTEEN_M_GLOBAL_MAX_STAKE_USD || EDGE_ENGINE_15M_LANE_A_MAX_STAKE_USD);
const EDGE_ENGINE_POSITIVE_BUCKET_MIN_PROB = Number(process.env.EDGE_ENGINE_POSITIVE_BUCKET_MIN_PROB || 0.62);
const EDGE_ENGINE_POSITIVE_BUCKET_MIN_ROI = Number(process.env.EDGE_ENGINE_POSITIVE_BUCKET_MIN_ROI || -0.02);
const EDGE_ENGINE_BAD_BUCKET_MAX_PROB = Number(process.env.EDGE_ENGINE_BAD_BUCKET_MAX_PROB || 0.54);
const EDGE_ENGINE_BAD_BUCKET_MIN_ROI = Number(process.env.EDGE_ENGINE_BAD_BUCKET_MIN_ROI || -0.12);
const EDGE_ENGINE_MAX_BOOK_AGE_MS = Number(process.env.EDGE_ENGINE_MAX_BOOK_AGE_MS || 1100);
const EDGE_ENGINE_MAX_LANE_A_BOOK_AGE_MS = Number(process.env.EDGE_ENGINE_MAX_LANE_A_BOOK_AGE_MS || 850);
const EDGE_ENGINE_PREMIUM_BOOK_AGE_MS = Number(process.env.EDGE_ENGINE_PREMIUM_BOOK_AGE_MS || 250);
const EDGE_ENGINE_MAX_SPREAD_CENTS = Number(process.env.EDGE_ENGINE_MAX_SPREAD_CENTS || 8);
const EDGE_ENGINE_MAX_LANE_A_SPREAD_CENTS = Number(process.env.EDGE_ENGINE_MAX_LANE_A_SPREAD_CENTS || 5);
const EDGE_ENGINE_PREMIUM_SPREAD_CENTS = Number(process.env.EDGE_ENGINE_PREMIUM_SPREAD_CENTS || 2.5);
const EDGE_ENGINE_MIN_DEPTH_SHARES = Number(process.env.EDGE_ENGINE_MIN_DEPTH_SHARES || 1);
const EDGE_ENGINE_DEPTH_REFERENCE_SHARES = Number(process.env.EDGE_ENGINE_DEPTH_REFERENCE_SHARES || 18);
const EDGE_ENGINE_MIN_DEPTH_ADVANTAGE = Number(process.env.EDGE_ENGINE_MIN_DEPTH_ADVANTAGE || -0.12);
const EDGE_ENGINE_MIN_MICROPRICE_EDGE_CENTS = Number(process.env.EDGE_ENGINE_MIN_MICROPRICE_EDGE_CENTS || -0.03);
const EDGE_ENGINE_PREMIUM_DEPTH_ADVANTAGE = Number(process.env.EDGE_ENGINE_PREMIUM_DEPTH_ADVANTAGE || 0.08);
const EDGE_ENGINE_PREMIUM_MICROPRICE_EDGE_CENTS = Number(process.env.EDGE_ENGINE_PREMIUM_MICROPRICE_EDGE_CENTS || 0.015);
const EDGE_ENGINE_SLIPPAGE_BUFFER_CENTS = Number(process.env.EDGE_ENGINE_SLIPPAGE_BUFFER_CENTS || 0.35);
const EDGE_ENGINE_LANE_A_QUALITY_MIN_SCORE = Number(process.env.EDGE_ENGINE_LANE_A_QUALITY_MIN_SCORE || 94);
const EDGE_ENGINE_LANE_S_QUALITY_MIN_SCORE = Number(process.env.EDGE_ENGINE_LANE_S_QUALITY_MIN_SCORE || 104);
const EDGE_ENGINE_LANE_B_QUALITY_MIN_SCORE = Number(process.env.EDGE_ENGINE_LANE_B_QUALITY_MIN_SCORE || 88);
const EDGE_ENGINE_LANE_A_DOWN_QUALITY_MIN_SCORE = Number(process.env.EDGE_ENGINE_LANE_A_DOWN_QUALITY_MIN_SCORE || 118);
const EDGE_ENGINE_LANE_B_DOWN_QUALITY_MIN_SCORE = Number(process.env.EDGE_ENGINE_LANE_B_DOWN_QUALITY_MIN_SCORE || 112);
const EDGE_ENGINE_PREMIUM_WINDOW_START = Number(process.env.EDGE_ENGINE_PREMIUM_WINDOW_START || 45);
const EDGE_ENGINE_PREMIUM_WINDOW_END = Number(process.env.EDGE_ENGINE_PREMIUM_WINDOW_END || 60);
const EDGE_ENGINE_CLEAR_WINDOW_START = Number(process.env.EDGE_ENGINE_CLEAR_WINDOW_START || 15);
const EDGE_ENGINE_CLEAR_WINDOW_END = Number(process.env.EDGE_ENGINE_CLEAR_WINDOW_END || 105);
let lastRuntimeRuleCachePersistAt = 0;
let cachedCalibratedEntryModel = null;
let cachedCalibratedEntryModelMtimeMs = 0;


const LEARNING_BRAIN_ENABLED = process.env.LEARNING_BRAIN_ENABLED !== "0";
const LEARNING_BRAIN_MODE = process.env.LEARNING_BRAIN_MODE || "enforce";
const LEARNING_BRAIN_MIN_RUNTIME_SETTLED = Number(process.env.LEARNING_BRAIN_MIN_RUNTIME_SETTLED || 100);
const PROGRESSIVE_STAKE_ENABLED = process.env.PROGRESSIVE_STAKE_ENABLED !== "0";
const PROGRESSIVE_WARMUP_SETTLED = Number(process.env.PROGRESSIVE_WARMUP_SETTLED || 20);
const PROGRESSIVE_GROWTH_SETTLED = Number(process.env.PROGRESSIVE_GROWTH_SETTLED || 20);
const PROGRESSIVE_AGGRESSIVE_SETTLED = Number(process.env.PROGRESSIVE_AGGRESSIVE_SETTLED || 50);
const PROGRESSIVE_WARMUP_STAKE_MULTIPLIER = Number(process.env.PROGRESSIVE_WARMUP_STAKE_MULTIPLIER || 0.65);
const PROGRESSIVE_GROWTH_STAKE_MULTIPLIER = Number(process.env.PROGRESSIVE_GROWTH_STAKE_MULTIPLIER || 0.90);
const PROGRESSIVE_AGGRESSIVE_STAKE_MULTIPLIER = Number(process.env.PROGRESSIVE_AGGRESSIVE_STAKE_MULTIPLIER || 1.15);
const PROGRESSIVE_RECOVERY_STAKE_MULTIPLIER = Number(process.env.PROGRESSIVE_RECOVERY_STAKE_MULTIPLIER || 0.35);
const PROGRESSIVE_RECOVERY_LOSS_STREAK = Number(process.env.PROGRESSIVE_RECOVERY_LOSS_STREAK || 3);
const PROGRESSIVE_GROWTH_MIN_WIN_RATE = Number(process.env.PROGRESSIVE_GROWTH_MIN_WIN_RATE || 58);
const PROGRESSIVE_AGGRESSIVE_MIN_WIN_RATE = Number(process.env.PROGRESSIVE_AGGRESSIVE_MIN_WIN_RATE || 65);
const PROGRESSIVE_AGGRESSIVE_MIN_ROI = Number(process.env.PROGRESSIVE_AGGRESSIVE_MIN_ROI || 8);
const PROGRESSIVE_CURRENT_VERSION_ONLY = process.env.PROGRESSIVE_CURRENT_VERSION_ONLY !== "0";

const ADAPTIVE_LEARNING_ENABLED = process.env.ADAPTIVE_LEARNING_ENABLED === "1";
const ADAPTIVE_MODE = process.env.ADAPTIVE_MODE || "enforce";
const ADAPTIVE_USE_IMPORTED_LEARNING = process.env.ADAPTIVE_USE_IMPORTED_LEARNING !== "0";
const ADAPTIVE_LOSS_PATTERN_MIN_SAMPLES = Number(process.env.LOSS_PATTERN_MIN_SAMPLES || 2);
const ADAPTIVE_LOSS_PATTERN_LOOKBACK = Number(process.env.LOSS_PATTERN_LOOKBACK || 50);
const ADAPTIVE_PATTERN_AUTO_BLOCK = process.env.LOSS_PATTERN_AUTO_BLOCK !== "0";
const ADAPTIVE_BLOCK_AFTER_LOSSES = Number(process.env.ADAPTIVE_BLOCK_AFTER_LOSSES || 2);
const ADAPTIVE_MIN_LOSS_RATE_PERCENT = Number(process.env.ADAPTIVE_MIN_LOSS_RATE_PERCENT || 55);
const ADAPTIVE_MIN_PATTERN_ROI = Number(process.env.ADAPTIVE_MIN_PATTERN_ROI || 0);
const ADAPTIVE_EARLY_WINDOW_SECONDS = Number(process.env.ADAPTIVE_EARLY_WINDOW_SECONDS || ACTIVE_BTC_PREDICTION_MIN_SECONDS_INTO_WINDOW);
const ADAPTIVE_LATE_WINDOW_SECONDS = Number(process.env.ADAPTIVE_LATE_WINDOW_SECONDS || 120);
const ADAPTIVE_HIGH_ENTRY_PRICE = Number(process.env.ADAPTIVE_HIGH_ENTRY_PRICE || 0.75);
const ADAPTIVE_WIDE_SPREAD_CENTS = Number(process.env.ADAPTIVE_WIDE_SPREAD_CENTS || ACTIVE_BTC_PREDICTION_MAX_SPREAD_CENTS);
const ADAPTIVE_REDUCE_STAKE_MULTIPLIER = Number(process.env.ADAPTIVE_REDUCE_STAKE_MULTIPLIER || 0.5);
const ADAPTIVE_PATTERN_BLOCK_MINUTES = Number(process.env.ADAPTIVE_PATTERN_BLOCK_MINUTES || 10);
const ADAPTIVE_SAME_SIDE_RUNTIME_LIMIT = Number(process.env.ADAPTIVE_SAME_SIDE_RUNTIME_LIMIT || Math.max(1, MAX_SAME_SIDE_PER_WINDOW));
const ADAPTIVE_RECOVERY_LOSS_STREAK = Number(process.env.ADAPTIVE_RECOVERY_LOSS_STREAK || PROGRESSIVE_RECOVERY_LOSS_STREAK);
const ADAPTIVE_RECOVERY_STAKE_MULTIPLIER = Number(process.env.ADAPTIVE_RECOVERY_STAKE_MULTIPLIER || PROGRESSIVE_RECOVERY_STAKE_MULTIPLIER);
const ADAPTIVE_HARD_STOP_LOSS_STREAK = Number(process.env.ADAPTIVE_HARD_STOP_LOSS_STREAK || 0);
const ADAPTIVE_GLOBAL_COOLDOWN_MS = Number(process.env.ADAPTIVE_GLOBAL_COOLDOWN_MS || 0);
const EFFECTIVE_MAX_CONSECUTIVE_LOSSES = ADAPTIVE_LEARNING_ENABLED
  ? (ADAPTIVE_HARD_STOP_LOSS_STREAK > 0 ? ADAPTIVE_HARD_STOP_LOSS_STREAK : 999)
  : ACTIVE_MAX_CONSECUTIVE_LOSSES;
const REPLAY_OPTIMIZER_ENABLED = process.env.REPLAY_OPTIMIZER_ENABLED === "1";
const REPLAY_OPTIMIZER_MIN_SAMPLES = Number(process.env.REPLAY_OPTIMIZER_MIN_SAMPLES || 3);
const REPLAY_OPTIMIZER_MIN_LOSSES = Number(process.env.REPLAY_OPTIMIZER_MIN_LOSSES || 2);
const REPLAY_OPTIMIZER_BAD_MAX_ROI = Number(process.env.REPLAY_OPTIMIZER_BAD_MAX_ROI || -5);
const REPLAY_OPTIMIZER_BAD_MIN_LOSS_RATE = Number(process.env.REPLAY_OPTIMIZER_BAD_MIN_LOSS_RATE || 58);
const REPLAY_OPTIMIZER_GOOD_MIN_ROI = Number(process.env.REPLAY_OPTIMIZER_GOOD_MIN_ROI || 8);
const REPLAY_OPTIMIZER_GOOD_MIN_WIN_RATE = Number(process.env.REPLAY_OPTIMIZER_GOOD_MIN_WIN_RATE || 58);
const REPLAY_OPTIMIZER_STRATEGY_SIDE_MIN_SAMPLES = Number(process.env.REPLAY_OPTIMIZER_STRATEGY_SIDE_MIN_SAMPLES || 4);
const REPLAY_OPTIMIZER_STRATEGY_SIDE_WINDOW_MIN_SAMPLES = Number(process.env.REPLAY_OPTIMIZER_STRATEGY_SIDE_WINDOW_MIN_SAMPLES || 3);
const REPLAY_OPTIMIZER_STRATEGY_SIDE_ENTRY_MIN_SAMPLES = Number(process.env.REPLAY_OPTIMIZER_STRATEGY_SIDE_ENTRY_MIN_SAMPLES || 3);
const REPLAY_OPTIMIZER_PROFIT_LEAK_MAX_ROI = Number(process.env.REPLAY_OPTIMIZER_PROFIT_LEAK_MAX_ROI || -8);
const REPLAY_OPTIMIZER_RUNTIME_OVERRIDE_SETTLED = Number(process.env.REPLAY_OPTIMIZER_RUNTIME_OVERRIDE_SETTLED || 30);

// V3.1: paper trading must prefer live Polymarket data. When enabled, synthetic
// fallback data is never allowed to create entries or learning samples.
const REAL_MARKET_DATA_ONLY = process.env.REAL_MARKET_DATA_ONLY !== "0";
const ALLOW_SYNTHETIC_BOOK = process.env.ALLOW_SYNTHETIC_BOOK === "1";
const ALLOW_SYNTHETIC_PRICE = process.env.ALLOW_SYNTHETIC_PRICE === "1";
const GATE_REQUIRE_REAL_MARKET_DATA = process.env.GATE_REQUIRE_REAL_MARKET_DATA === "1" || REAL_MARKET_DATA_ONLY;
const GATE_BLOCK_SYNTHETIC_BOOK = process.env.GATE_BLOCK_SYNTHETIC_BOOK === "1" || REAL_MARKET_DATA_ONLY;
const GATE_BLOCK_LEARNING_FALLBACK = process.env.GATE_BLOCK_LEARNING_FALLBACK === "1" || REAL_MARKET_DATA_ONLY;
const FALLBACK_CAN_OPEN_POSITION = process.env.FALLBACK_CAN_OPEN_POSITION === "1" && !REAL_MARKET_DATA_ONLY;
const FALLBACK_EXCLUDE_FROM_LEARNING = process.env.FALLBACK_EXCLUDE_FROM_LEARNING !== "0";
const POLYMARKET_OFFICIAL_SETTLEMENT_ENABLED = process.env.POLYMARKET_OFFICIAL_SETTLEMENT_ENABLED !== "0";
const POLYMARKET_OFFICIAL_SETTLEMENT_GRACE_MS = Number(process.env.POLYMARKET_OFFICIAL_SETTLEMENT_GRACE_MS || 240_000);
const POLYMARKET_OFFICIAL_SETTLEMENT_REQUIRE = process.env.POLYMARKET_OFFICIAL_SETTLEMENT_REQUIRE !== "0";
const POLYMARKET_OFFICIAL_SETTLEMENT_TIMEOUT_MS = Number(process.env.POLYMARKET_OFFICIAL_SETTLEMENT_TIMEOUT_MS || 8_000);
const POLYMARKET_OFFICIAL_RECONCILE_ENABLED = process.env.POLYMARKET_OFFICIAL_RECONCILE_ENABLED !== "0";
const POLYMARKET_OFFICIAL_RECONCILE_MAX_PER_SCAN = Math.max(0, Number(process.env.POLYMARKET_OFFICIAL_RECONCILE_MAX_PER_SCAN || 12));
const POLYMARKET_OFFICIAL_SETTLEMENT_CACHE_TTL_MS = Math.max(1_000, Number(process.env.POLYMARKET_OFFICIAL_SETTLEMENT_CACHE_TTL_MS || 300_000));
const POLYMARKET_OFFICIAL_SETTLEMENT_MISS_TTL_MS = Math.max(250, Number(process.env.POLYMARKET_OFFICIAL_SETTLEMENT_MISS_TTL_MS || 2_500));
const STRATEGY_RUNTIME_AUTO_DISABLE_ENABLED = process.env.STRATEGY_RUNTIME_AUTO_DISABLE_ENABLED !== "0";
const STRATEGY_RUNTIME_AUTO_DISABLE_MIN_SAMPLES = Number(process.env.STRATEGY_RUNTIME_AUTO_DISABLE_MIN_SAMPLES || 15);
const STRATEGY_RUNTIME_AUTO_DISABLE_MIN_ROI = Number(process.env.STRATEGY_RUNTIME_AUTO_DISABLE_MIN_ROI || -5);
const STRATEGY_RUNTIME_AUTO_DISABLE_MIN_WIN_RATE = Number(process.env.STRATEGY_RUNTIME_AUTO_DISABLE_MIN_WIN_RATE || 45);

let IMPORTED_LEARNING_BRAIN = loadImportedLearningBrain(DATA_DIR, { enabled: LEARNING_BRAIN_ENABLED });

function buildV3745CriticalConfigSnapshot() {
  return {
    releaseVersion: V356_RELEASE_VERSION,
    botRole: BOT_ROLE,
    botInstanceId: BOT_INSTANCE_ID,
    dataDir: DATA_DIR,
    strategyVersion: BTC_PREDICTION_STRATEGY_VERSION,
    scanIntervalMs: SCAN_INTERVAL_MS,
    paperMaxEntriesPerTick: PAPER_MAX_ENTRIES_PER_TICK,
    maxActivePositions: MAX_ACTIVE_POSITIONS,
    entryRefreshBeforeOpen: ENTRY_REFRESH_BEFORE_OPEN,
    entryRestFallbackBeforeOpen: ENTRY_REST_FALLBACK_BEFORE_OPEN,
    entryUseCacheOnlyBeforeOpen: ENTRY_USE_CACHE_ONLY_BEFORE_OPEN,
    realMarketDataOnly: REAL_MARKET_DATA_ONLY,
    officialSettlementRequired: POLYMARKET_OFFICIAL_SETTLEMENT_REQUIRE,
    multiAssetPredictionEnabled: MULTI_ASSET_PREDICTION_ENABLED,
    multiAssetSymbols: MULTI_ASSET_PREDICTION_SYMBOLS,
    multiAssetTimeframes: MULTI_ASSET_PREDICTION_TIMEFRAMES,
    requireExternalAnchor: V372_REQUIRE_EXTERNAL_ANCHOR,
    externalMinReturnSamples: V372_EXTERNAL_MIN_RETURN_SAMPLES,
    externalPricePrimary: EXTERNAL_PRICE_PRIMARY,
    externalPriceWatchdogEnabled: EXTERNAL_PRICE_WATCHDOG_ENABLED,
    externalPriceWatchdogIntervalMs: EXTERNAL_PRICE_WATCHDOG_INTERVAL_MS,
    externalPriceWatchdogStaleAfterMs: EXTERNAL_PRICE_WATCHDOG_STALE_AFTER_MS,
    externalPriceWatchdogStartupGraceMs: EXTERNAL_PRICE_WATCHDOG_STARTUP_GRACE_MS,
    externalPriceWatchdogReconnectDelayMs: EXTERNAL_PRICE_WATCHDOG_RECONNECT_DELAY_MS,
    externalPriceWatchdogTransportStaleAfterMs: EXTERNAL_PRICE_WATCHDOG_TRANSPORT_STALE_AFTER_MS,
    externalPriceWatchdogPublisherStaleAfterMs: EXTERNAL_PRICE_WATCHDOG_PUBLISHER_STALE_AFTER_MS,
    externalPriceWatchdogMaxBackoffMs: EXTERNAL_PRICE_WATCHDOG_MAX_BACKOFF_MS,
    officialChainlinkRequired: OFFICIAL_CHAINLINK_REQUIRED,
    binanceContextFeatureEnabled: BINANCE_CONTEXT_FEATURE_ENABLED,
    paperOrderType: PAPER_ORDER_TYPE,
    paperStartBalanceUsd: PAPER_START_BALANCE,
    paperMaxTradeUsd: PAPER_MAX_TRADE_USD,
    paperMaxSlippageCents: PAPER_MAX_SLIPPAGE_CENTS,
    paperCryptoTakerFeeRate: PAPER_CRYPTO_TAKER_FEE_RATE,
    paperOnePositionPerSlug: PAPER_ONE_POSITION_PER_SLUG,
    paperHardCashLedgerEnabled: PAPER_HARD_CASH_LEDGER_ENABLED,
    paperReserveEntryFees: PAPER_RESERVE_ENTRY_FEES,
    dynamicEquityScalingEnabled: DYNAMIC_EQUITY_SCALING_ENABLED,
    dynamicEquityScalingStartEquity: DYNAMIC_EQUITY_SCALING_START_EQUITY,
    maxTradeEquityFraction: MAX_TRADE_EQUITY_FRACTION,
    maxTradeUsdHardCap: MAX_TRADE_USD_HARD_CAP,
    maxUnresolvedReserveFraction: MAX_UNRESOLVED_RESERVE_FRACTION,
    equityLaneScalingEnabled: EQUITY_LANE_SCALING_ENABLED,
    fastGrowEvPolicyEnabled: FAST_GROW_EV_POLICY_ENABLED,
    fastGrowEvMinNetEdge: FAST_GROW_EV_MIN_NET_EDGE,
    fastGrowEvLaneSMinNetEdge: FAST_GROW_EV_LANE_S_MIN_NET_EDGE,
    fastGrowEvLaneAMinFraction: FAST_GROW_EV_LANE_A_MIN_FRACTION,
    fastGrowEvLaneAMaxFraction: FAST_GROW_EV_LANE_A_MAX_FRACTION,
    fastGrowEvLaneSMinFraction: FAST_GROW_EV_LANE_S_MIN_FRACTION,
    fastGrowEvLaneSMaxFraction: FAST_GROW_EV_LANE_S_MAX_FRACTION,
    fastGrowEvLaneSMaxEdge: FAST_GROW_EV_LANE_S_MAX_EDGE,
    fastGrowDepthUtilization: FAST_GROW_DEPTH_UTILIZATION,
    fastGrowSkipBelowMarketMin: FAST_GROW_SKIP_BELOW_MARKET_MIN,
    independentAssetEdgeEnabled: INDEPENDENT_ASSET_EDGE_ENABLED,
    independentAssetMinNetEdge: INDEPENDENT_ASSET_MIN_NET_EDGE,
    independentAssetStressSlippagePerShare: INDEPENDENT_ASSET_STRESS_SLIPPAGE_PER_SHARE,
    eligibilityEpisodeEnabled: ELIGIBILITY_EPISODE_ENABLED,
    eligibilityEpisodeStrongAssetNetEdge: ELIGIBILITY_EPISODE_STRONG_ASSET_NET_EDGE,
    eligibilityEpisodeNearSnapshots: ELIGIBILITY_EPISODE_NEAR_SNAPSHOTS,
    eligibilityEpisodeStrongSnapshots: ELIGIBILITY_EPISODE_STRONG_SNAPSHOTS,
    eligibilityEpisodeMinChainlinkEvents: ELIGIBILITY_EPISODE_MIN_CHAINLINK_EVENTS,
    eligibilityEpisodeNearDurationMs: ELIGIBILITY_EPISODE_NEAR_DURATION_MS,
    eligibilityEpisodeStrongDurationMs: ELIGIBILITY_EPISODE_STRONG_DURATION_MS,
    eligibilityEpisodeMaxGapMs: ELIGIBILITY_EPISODE_MAX_GAP_MS,
    eligibilityProbabilityBasis: "regime_core_independent_asset_probability_frozen_no_observer_execution",
    legacyCalibrationExecutionGateEnabled: LEGACY_CALIBRATION_EXECUTION_GATE_ENABLED,
    legacyCalibrationRole: "telemetry_only",
    regimeCorePolicyEnabled: REGIME_CORE_POLICY_ENABLED,
    cohortRegimeGuardEnabled: COHORT_REGIME_GUARD_ENABLED,
    cohortRegimeGuardLookback: COHORT_REGIME_GUARD_LOOKBACK,
    cohortRegimeGuardLossTrigger: COHORT_REGIME_GUARD_LOSS_TRIGGER,
    cohortRegimeGuardTtlSettlements: COHORT_REGIME_GUARD_TTL_SETTLEMENTS,
    orderBookRole: "confirmation_and_ranking_only",
    antiPlateauSizingBasis: "current_realized_equity_not_peak_equity",
    antiPlateauMartingale: false,
    startupProtectionEnabled: STARTUP_PROTECTION_ENABLED,
    oppositeSideExposureGuardEnabled: OPPOSITE_SIDE_EXPOSURE_GUARD_ENABLED,
    calibratedEntryModelEnabled: CALIBRATED_ENTRY_MODEL_ENABLED,
    adaptiveLearningEnabled: ADAPTIVE_LEARNING_ENABLED,
    replayOptimizerEnabled: REPLAY_OPTIMIZER_ENABLED,
    aggressiveLearningMode: AGGRESSIVE_LEARNING_MODE,
    veryAggressiveSampleMode: VERY_AGGRESSIVE_SAMPLE_MODE,
    researchSampleBucketSeconds: RESEARCH_SAMPLE_BUCKET_SECONDS,
    mainAccuracyLaneEnabled: MAIN_ACCURACY_LANE_ENABLED,
    mainAccuracyMinConfidence: MAIN_ACCURACY_MIN_CONFIDENCE,
    mainAccuracyMinSecondsIntoWindow: MAIN_ACCURACY_MIN_SECONDS_INTO_WINDOW,
    mainAccuracyMaxSecondsIntoWindowExclusive: MAIN_ACCURACY_MAX_SECONDS_INTO_WINDOW_EXCLUSIVE,
    mainAccuracyRequireModelReady: MAIN_ACCURACY_REQUIRE_MODEL_READY,
    mainAccuracyRequireDirectionLock: MAIN_ACCURACY_REQUIRE_DIRECTION_LOCK,
    mainAccuracyRequireChainlink: MAIN_ACCURACY_REQUIRE_CHAINLINK,
    mainAccuracyRequireOfficialTarget: MAIN_ACCURACY_REQUIRE_OFFICIAL_TARGET,
    mainAccuracyRequireWsBook: MAIN_ACCURACY_REQUIRE_WS_BOOK,
    mainAccuracyMaxChainlinkAgeMs: MAIN_ACCURACY_MAX_CHAINLINK_AGE_MS,
    mainAccuracyMaxBookAgeMs: MAIN_ACCURACY_MAX_BOOK_AGE_MS,
    mainAccuracyMinEntryPrice: MAIN_ACCURACY_MIN_ENTRY_PRICE,
    mainAccuracyMaxEntryPrice: MAIN_ACCURACY_MAX_ENTRY_PRICE,
    settlementObserverEnabled: SETTLEMENT_OBSERVER_ENABLED,
    observerPolicyPath: OBSERVER_POLICY_PATH,
    observerPolicyMaxAgeMs: OBSERVER_POLICY_MAX_AGE_MS,
    observerPolicyMinCohortSamples: OBSERVER_POLICY_MIN_COHORT_SAMPLES,
    antiDowngradeReportPath: ANTI_DOWNGRADE_REPORT_PATH,
    mainBehaviorPolicyId: MAIN_BEHAVIOR_POLICY_ID,
    antiDowngradeShadowEnabled: ANTI_DOWNGRADE_SHADOW_ENABLED,
    antiDowngradeShadowExecutionEnabled: ANTI_DOWNGRADE_SHADOW_EXECUTION_ENABLED,
    antiDowngradeAutomaticPromotion: ANTI_DOWNGRADE_AUTOMATIC_PROMOTION,
    directionShadowEnabled: DIRECTION_SHADOW_ENABLED,
    directionShadowExecutionEnabled: DIRECTION_SHADOW_EXECUTION_ENABLED,
    directionShadowAutomaticPromotion: DIRECTION_SHADOW_AUTOMATIC_PROMOTION,
    directionShadowMaxObservationDelayMs: DIRECTION_SHADOW_MAX_OBSERVATION_DELAY_MS,
    directionShadowReportPath: DIRECTION_SHADOW_REPORT_PATH,
    paperStatePersistenceEnabled: PAPER_STATE_PERSISTENCE_ENABLED,
    paperStatePath: BTC_PAPER_STATE_PATH,
    paperStateHeartbeatMs: PAPER_STATE_HEARTBEAT_MS,
    strategyCurrentPredictionEnabled: STRATEGY_CURRENT_PREDICTION_ENABLED,
    strategyDualSideEnabled: STRATEGY_DUAL_SIDE_ENABLED,
    strategyExecutableStrategies: STRATEGY_EXECUTABLE_STRATEGIES,
    strategyForceAllow: STRATEGY_FORCE_ALLOW,
    strategyForceBlock: STRATEGY_FORCE_BLOCK,
  };
}

const V3745_CRITICAL_CONFIG = buildV3745CriticalConfigSnapshot();
const V3745_CONFIG_HASH = crypto.createHash("sha256").update(JSON.stringify(V3745_CRITICAL_CONFIG)).digest("hex");
const officialSettlementRequestCache = new AsyncResultCache({
  hitTtlMs: POLYMARKET_OFFICIAL_SETTLEMENT_CACHE_TTL_MS,
  missTtlMs: POLYMARKET_OFFICIAL_SETTLEMENT_MISS_TTL_MS,
});

function buildReplayOptimizerConfig() {
  return {
    enabled: REPLAY_OPTIMIZER_ENABLED,
    minSamples: REPLAY_OPTIMIZER_MIN_SAMPLES,
    minLosses: REPLAY_OPTIMIZER_MIN_LOSSES,
    badMaxRoi: REPLAY_OPTIMIZER_BAD_MAX_ROI,
    badMinLossRate: REPLAY_OPTIMIZER_BAD_MIN_LOSS_RATE,
    goodMinRoi: REPLAY_OPTIMIZER_GOOD_MIN_ROI,
    goodMinWinRate: REPLAY_OPTIMIZER_GOOD_MIN_WIN_RATE,
    strategySideMinSamples: REPLAY_OPTIMIZER_STRATEGY_SIDE_MIN_SAMPLES,
    strategySideWindowMinSamples: REPLAY_OPTIMIZER_STRATEGY_SIDE_WINDOW_MIN_SAMPLES,
    strategySideEntryMinSamples: REPLAY_OPTIMIZER_STRATEGY_SIDE_ENTRY_MIN_SAMPLES,
    strategySideProfitLeakMaxRoi: REPLAY_OPTIMIZER_PROFIT_LEAK_MAX_ROI,
    strategySideWindowProfitLeakMaxRoi: REPLAY_OPTIMIZER_PROFIT_LEAK_MAX_ROI,
    strategySideEntryProfitLeakMaxRoi: REPLAY_OPTIMIZER_PROFIT_LEAK_MAX_ROI,
    strategySideReduceStakeMultiplier: NO_STAKE_REDUCTION_MODE ? 1 : ADAPTIVE_REDUCE_STAKE_MULTIPLIER,
    strategySideBadAction: NO_STAKE_REDUCTION_MODE ? "observe" : (process.env.REPLAY_OPTIMIZER_STRATEGY_SIDE_BAD_ACTION || "observe"),
    actionMode: (NO_ENTRY_REDUCTION_MODE || NO_STAKE_REDUCTION_MODE) ? "observe" : (process.env.REPLAY_OPTIMIZER_ACTION_MODE || "observe"),
    blockingEnabled: (NO_ENTRY_REDUCTION_MODE || NO_BLOCK_QUALITY_CANDIDATES) ? false : process.env.REPLAY_OPTIMIZER_BLOCKING_ENABLED !== "0",
    reduceStakeEnabled: NO_STAKE_REDUCTION_MODE ? false : process.env.REPLAY_OPTIMIZER_REDUCE_STAKE_ENABLED === "1",
    noStakeReductionMode: NO_STAKE_REDUCTION_MODE,
    noEntryReductionMode: NO_ENTRY_REDUCTION_MODE,
  };
}

let REPLAY_OPTIMIZER_STATE = buildReplayThresholdOptimizerState(IMPORTED_LEARNING_BRAIN?.adaptiveSignals || [], buildReplayOptimizerConfig());
function buildActiveReplayOptimizerState(runtimeSignals = []) {
  const runtimeSettled = Array.isArray(runtimeSignals)
    ? runtimeSignals.filter((signal) => signal.status === "paper_win" || signal.status === "paper_loss")
    : [];
  if (!runtimeSettled.length) return REPLAY_OPTIMIZER_STATE;
  const useRuntimeOnly = runtimeSettled.length >= REPLAY_OPTIMIZER_RUNTIME_OVERRIDE_SETTLED;
  const importedSignals = !useRuntimeOnly && ADAPTIVE_USE_IMPORTED_LEARNING ? (IMPORTED_LEARNING_BRAIN?.adaptiveSignals || []) : [];
  const state = buildReplayThresholdOptimizerState([...importedSignals, ...runtimeSettled], buildReplayOptimizerConfig());
  state.learningSource = useRuntimeOnly ? "runtime" : "imported_plus_runtime";
  persistReplayThresholdOptimizerState(DATA_DIR, state);
  return state;
}
persistReplayThresholdOptimizerState(DATA_DIR, REPLAY_OPTIMIZER_STATE);

const CONFIDENCE_BUCKET_RANGES = [
  { label: "58-65", min: 58, max: 65 },
  { label: "65-75", min: 65, max: 75 },
  { label: "75-85", min: 75, max: 85 },
  { label: "85+", min: 85, max: 101 },
];

const subscribers = new Set();
const uiSubscribers = new Set();
const seenTrades = new Map();
const seenPredictionSignals = new Map();
const eligibilityEpisodeStore = new EligibilityEpisodeStore({
  minAssetNetEdge: INDEPENDENT_ASSET_MIN_NET_EDGE,
  strongAssetNetEdge: ELIGIBILITY_EPISODE_STRONG_ASSET_NET_EDGE,
  nearRequiredSnapshots: ELIGIBILITY_EPISODE_NEAR_SNAPSHOTS,
  strongRequiredSnapshots: ELIGIBILITY_EPISODE_STRONG_SNAPSHOTS,
  requiredChainlinkEvents: ELIGIBILITY_EPISODE_MIN_CHAINLINK_EVENTS,
  nearRequiredDurationMs: ELIGIBILITY_EPISODE_NEAR_DURATION_MS,
  strongRequiredDurationMs: ELIGIBILITY_EPISODE_STRONG_DURATION_MS,
  maxObservationGapMs: ELIGIBILITY_EPISODE_MAX_GAP_MS,
  maxChainlinkAgeMs: MAIN_ACCURACY_MAX_CHAINLINK_AGE_MS,
  maxBookAgeMs: MAIN_ACCURACY_MAX_BOOK_AGE_MS,
  maxEntries: 512,
});
let paperLedgerGeneration = 0;
let postResetState = {
  active: false,
  resetAt: null,
  resetGeneration: 0,
  settledAfterReset: 0,
  lastGoodLocked: false,
};
const seenReferenceTradeKeys = new Set();
const dnsCache = new Map();
const priceTargetCache = new Map();
const orderBookCache = new Map();
const entryAsyncRefreshInFlight = new Map();
let gammaMarketCache = { expiresAt: 0, markets: [] };
let cryptoScannerMarketCache = { expiresAt: 0, markets: [] };
let agentAdviceCache = { expiresAt: 0, data: null };
const auditLogger = createAuditLogger(DATA_DIR, {
  snapshotDedupeMs: AUDIT_SNAPSHOT_DEDUPE_MS,
  decisionDedupeMs: AUDIT_DECISION_DEDUPE_MS,
  strategyDedupeMs: AUDIT_STRATEGY_DEDUPE_MS,
  gateDedupeMs: AUDIT_GATE_DEDUPE_MS,
  eventDedupeMs: AUDIT_IDLE_OBSERVER_EVENT_DEDUPE_MS,
});
const predictionPersistenceGate = createPredictionPersistenceGate({ heartbeatMs: PAPER_STATE_HEARTBEAT_MS });
const checkpointObserver = createCheckpointObserver();
const observerPolicyReader = createObserverPolicyReader({
  policyPath: OBSERVER_POLICY_PATH,
  maximumAgeMs: OBSERVER_POLICY_MAX_AGE_MS,
  minimumCohortSamples: OBSERVER_POLICY_MIN_COHORT_SAMPLES,
});
const settlementObserverLearner = SETTLEMENT_OBSERVER_ENABLED
  ? createSettlementObserverLearner({
      settlementDirectory: MAIN_SETTLEMENT_DIR,
      checkpointDirectory: OBSERVER_CHECKPOINT_DIR,
      policyPath: OBSERVER_POLICY_PATH,
      statePath: OBSERVER_STATE_PATH,
      antiDowngradeReportPath: ANTI_DOWNGRADE_REPORT_PATH,
      minimumSamples: OBSERVER_POLICY_MIN_FORWARD_SAMPLES,
      minimumWinRate: 70,
      startEquityUsd: PAPER_START_BALANCE,
    })
  : null;
const directionShadowObserver = DIRECTION_SHADOW_ENABLED
  ? createDirectionOnlyShadowObserver({
      signalDirectory: MAIN_SIGNAL_DIR,
      settlementDirectory: MAIN_SETTLEMENT_DIR,
      decisionDirectory: DIRECTION_SHADOW_DECISION_DIR,
      statePath: DIRECTION_SHADOW_STATE_PATH,
      reportPath: DIRECTION_SHADOW_REPORT_PATH,
      releaseVersion: V356_RELEASE_VERSION,
      maximumObservationDelayMs: DIRECTION_SHADOW_MAX_OBSERVATION_DELAY_MS,
      startEquityUsd: PAPER_START_BALANCE,
    })
  : null;

function recordPredictionSnapshot(row) {
  auditLogger.snapshot(row);
  if (BOT_ROLE !== "checkpoint_observer") return;
  const checkpoint = checkpointObserver.consider(row);
  if (checkpoint) auditLogger.checkpoint(checkpoint);
}

const httpAgent = new http.Agent({
  keepAlive: HTTP_KEEP_ALIVE_ENABLED,
  maxSockets: HTTP_MAX_SOCKETS,
  maxFreeSockets: HTTP_MAX_FREE_SOCKETS,
  timeout: HTTP_SOCKET_TIMEOUT_MS,
});
const httpsAgent = new https.Agent({
  keepAlive: HTTP_KEEP_ALIVE_ENABLED,
  maxSockets: HTTP_MAX_SOCKETS,
  maxFreeSockets: HTTP_MAX_FREE_SOCKETS,
  timeout: HTTP_SOCKET_TIMEOUT_MS,
});
const referencePollState = {
  inFlight: false,
  warmedUp: false,
  lastLatencyMs: 0,
};
const bookFeedState = {
  status: ORDERBOOK_WS_ENABLED ? "starting" : "disabled",
  ws: null,
  heartbeatTimer: null,
  reconnectTimer: null,
  tokenKey: "",
  tokens: [],
  updates: 0,
  marketEvents: 0,
  staleReconnects: 0,
  lastMessageAt: null,
  connectedAt: null,
  lastSubscribeAt: null,
  lastError: "",
};

let state = createInitialState();

function createPaperSessionState(overrides = {}) {
  const now = new Date().toISOString();
  return {
    ok: true,
    id: overrides.id || null,
    hold: Boolean(overrides.hold),
    createdAt: overrides.createdAt || now,
    resetAt: overrides.resetAt || null,
    resumedAt: overrides.resumedAt || null,
    releaseVersion: V356_RELEASE_VERSION,
    baselineCore: V356_BASELINE_CORE,
    predictionLogicBase: V356_PREDICTION_LOGIC_BASE,
    safeRecoveryMode: V356_SAFE_RECOVERY_MODE,
    profitBucketReplacementEnabled: PROFIT_BUCKET_REPLACEMENT_ENABLED,
    profitBucketReplacementMode: PROFIT_BUCKET_REPLACEMENT_MODE,
    appliedToLiveSelection: false,
    diagnosticOnlyReason: "session_and_profit_bucket_diagnostics_do_not_reduce_entries_stake_or_speed",
  };
}

function loadPaperSessionState() {
  try {
    if (!fs.existsSync(PAPER_SESSION_STATE_PATH)) return createPaperSessionState();
    const parsed = JSON.parse(fs.readFileSync(PAPER_SESSION_STATE_PATH, "utf8"));
    return createPaperSessionState(parsed && typeof parsed === "object" ? parsed : {});
  } catch {
    return createPaperSessionState();
  }
}

let paperSessionState = loadPaperSessionState();

function persistPaperSessionState() {
  try {
    fs.mkdirSync(path.dirname(PAPER_SESSION_STATE_PATH), { recursive: true });
    fs.writeFileSync(PAPER_SESSION_STATE_PATH, JSON.stringify(paperSessionState, null, 2));
  } catch {
    // Session persistence failure must not stop scanner/backend.
  }
}

function makePaperSessionId(now = Date.now()) {
  return `session-${new Date(now).toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z")}`;
}

function startPaperResetSession(now = Date.now()) {
  paperSessionState = createPaperSessionState({
    id: makePaperSessionId(now),
    hold: true,
    createdAt: new Date(now).toISOString(),
    resetAt: new Date(now).toISOString(),
  });
  persistPaperSessionState();
  return paperSessionState;
}

function resumePaperSession(now = Date.now()) {
  const current = paperSessionState || createPaperSessionState();
  paperSessionState = createPaperSessionState({
    ...current,
    id: current.id || makePaperSessionId(now),
    hold: false,
    resumedAt: new Date(now).toISOString(),
  });
  persistPaperSessionState();
  return paperSessionState;
}

function buildV356NoDowngradeAudit(snapshot = {}) {
  const signals = snapshot?.prediction?.signals || [];
  const stakeBelowMinCount = signals.filter((signal) => Number(signal.stakeUsd ?? signal.stake ?? 3) < 3).length;
  return {
    ok: true,
    releaseVersion: V356_RELEASE_VERSION,
    baselineCore: V356_BASELINE_CORE,
    liveSelectionCore: V356_BASELINE_CORE,
    predictionLogicBase: V356_PREDICTION_LOGIC_BASE,
    safeRecoveryMode: V356_SAFE_RECOVERY_MODE,
    v3537RerankerEnabled: false,
    v3538RerankerEnabled: false,
    v3538PolicyLockEnabled: false,
    v354LiveSelectionWrapperEnabled: false,
    profitBucketReplacementEnabled: PROFIT_BUCKET_REPLACEMENT_ENABLED,
    profitBucketReplacementMode: PROFIT_BUCKET_REPLACEMENT_MODE,
    profitBucketAppliedToLiveSelection: false,
    sessionAppliedToLiveSelection: false,
    diagnosticSnapshotAppliedToLiveSelection: false,
    paperSessionId: paperSessionState?.id || null,
    paperSessionHold: Boolean(paperSessionState?.hold),
    stakeBelowMinCount,
  };
}
let scanRunning = false;
let scanSkippedWhileRunning = false;
let scanCatchupScheduled = false;
let lastCompletedScanAt = 0;
const PROCESS_STARTED_AT_MS = Date.now();
const latencyState = {
  httpConnectMs: [],
  httpTlsMs: [],
  httpTotalMs: [],
  eventLoopDelayMs: [],
  orderbookQueueWaitMs: [],
  entryBookAgeMs: [],
  scanLatencyMs: [],
  scanSkippedTicks: 0,
  scanCatchupRuns: 0,
  entryRefreshes: 0,
  staleEntryDrops: 0,
  lastLatencyLogAt: 0,
};

function pushLatencySample(key, value, limit = 240) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  const list = latencyState[key];
  if (!Array.isArray(list)) return;
  list.push(numeric);
  if (list.length > limit) list.splice(0, list.length - limit);
}

function avgLatencySample(key) {
  const list = latencyState[key] || [];
  return list.length ? list.reduce((total, value) => total + value, 0) / list.length : 0;
}

function percentileLatencySample(key, percentile = 0.95) {
  const list = [...(latencyState[key] || [])].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return 0;
  const index = Math.min(list.length - 1, Math.max(0, Math.ceil(list.length * percentile) - 1));
  return list[index];
}

function maybeLogLatencyDiagnostics(extra = {}) {
  if (!LATENCY_DIAGNOSTICS_ENABLED) return;
  const now = Date.now();
  if (now - latencyState.lastLatencyLogAt < LATENCY_LOG_EVERY_MS) return;
  latencyState.lastLatencyLogAt = now;
  auditLogger.event({
    time: new Date(now).toISOString(),
    type: "latency_diagnostics",
    httpConnectMs: avgLatencySample("httpConnectMs"),
    httpTlsMs: avgLatencySample("httpTlsMs"),
    httpTotalMs: avgLatencySample("httpTotalMs"),
    eventLoopDelayMs: avgLatencySample("eventLoopDelayMs"),
    eventLoopDelayP95Ms: percentileLatencySample("eventLoopDelayMs", 0.95),
    orderbookQueueWaitMs: avgLatencySample("orderbookQueueWaitMs"),
    entryBookAgeMs: avgLatencySample("entryBookAgeMs"),
    scanSkippedTicks: latencyState.scanSkippedTicks,
    scanCatchupRuns: latencyState.scanCatchupRuns,
    entryRefreshes: latencyState.entryRefreshes,
    staleEntryDrops: latencyState.staleEntryDrops,
    ...extra,
  });
}

let lastEventLoopProbeAt = Date.now();
if (LATENCY_DIAGNOSTICS_ENABLED) {
  const eventLoopProbe = setInterval(() => {
    const now = Date.now();
    pushLatencySample("eventLoopDelayMs", Math.max(0, now - lastEventLoopProbeAt - 1_000));
    lastEventLoopProbeAt = now;
  }, 1_000);
  eventLoopProbe.unref?.();
}

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");
    const overrideLocalEnv = process.env.BOT_ENV_OVERRIDE === "1";
    if (overrideLocalEnv || !process.env[key]) process.env[key] = value;
  }
}

function createInitialState() {
  return {
    mode: "paper",
    status: "booting",
    blocked: false,
    source: {
      gamma: "pending",
      clob: "pending",
      btc: "pending",
      reference: "pending",
      lastError: "",
      lastScanAt: null,
      nextScanAt: null,
      insecureTls: process.env.POLYMARKET_INSECURE_TLS === "1",
    },
    config: {
      marketLimit: MARKET_LIMIT,
      orderbookLimit: ORDERBOOK_LIMIT,
      orderbookScanConcurrency: ORDERBOOK_SCAN_CONCURRENCY,
      orderbookCacheTtlMs: ORDERBOOK_CACHE_TTL_MS,
      entryMaxBookAgeMs: ENTRY_MAX_BOOK_AGE_MS,
      entryRefreshBookIfOlderMs: ENTRY_REFRESH_BOOK_IF_OLDER_MS,
      entryRefreshBeforeOpen: ENTRY_REFRESH_BEFORE_OPEN,
      entryRestFallbackBeforeOpen: ENTRY_REST_FALLBACK_BEFORE_OPEN,
      entryUseCacheOnlyBeforeOpen: ENTRY_USE_CACHE_ONLY_BEFORE_OPEN,
      entryForceRefreshMaxWaitMs: ENTRY_FORCE_REFRESH_MAX_WAIT_MS,
      entryRevalidateAsyncAfterSignal: ENTRY_REVALIDATE_ASYNC_AFTER_SIGNAL,
      hotMarketFastLaneEnabled: HOT_MARKET_FAST_LANE_ENABLED,
      hotMarketScanIntervalMs: HOT_MARKET_SCAN_INTERVAL_MS,
      ultraHotMarketScanIntervalMs: ULTRA_HOT_MARKET_SCAN_INTERVAL_MS,
      httpMaxSockets: HTTP_MAX_SOCKETS,
      httpMaxFreeSockets: HTTP_MAX_FREE_SOCKETS,
      scanCatchupAfterLongTick: SCAN_CATCHUP_AFTER_LONG_TICK,
      scanSkippedTickCatchup: SCAN_SKIPPED_TICK_CATCHUP,
      latencyDiagnosticsEnabled: LATENCY_DIAGNOSTICS_ENABLED,
      resetPreserveLearningMemory: RESET_PRESERVE_LEARNING_MEMORY,
      lastGoodModelEnabled: LAST_GOOD_MODEL_ENABLED,
      accuracyRerankerEnabled: ACCURACY_RERANKER_ENABLED,
      orderbookWsEnabled: ORDERBOOK_WS_ENABLED,
      externalPriceWatchdogEnabled: EXTERNAL_PRICE_WATCHDOG_ENABLED,
      externalPriceWatchdogIntervalMs: EXTERNAL_PRICE_WATCHDOG_INTERVAL_MS,
      externalPriceWatchdogStaleAfterMs: EXTERNAL_PRICE_WATCHDOG_STALE_AFTER_MS,
      externalPriceWatchdogStartupGraceMs: EXTERNAL_PRICE_WATCHDOG_STARTUP_GRACE_MS,
      externalPriceWatchdogReconnectDelayMs: EXTERNAL_PRICE_WATCHDOG_RECONNECT_DELAY_MS,
      paperFillMode: `marketable_limit_${PAPER_ORDER_TYPE.toLowerCase()}_observed_depth`,
      minEdgeCents: MIN_EDGE_CENTS,
      minDepthShares: MIN_DEPTH_SHARES,
      minPaperProfitUsd: MIN_PAPER_PROFIT_USD,
      paperStartBalance: PAPER_START_BALANCE,
      paperMaxTradeUsd: PAPER_MAX_TRADE_USD,
      dynamicEquityScalingEnabled: DYNAMIC_EQUITY_SCALING_ENABLED,
      dynamicEquityScalingStartEquity: DYNAMIC_EQUITY_SCALING_START_EQUITY,
      maxTradeEquityFraction: MAX_TRADE_EQUITY_FRACTION,
      maxTradeUsdHardCap: MAX_TRADE_USD_HARD_CAP,
      equityLaneScalingEnabled: EQUITY_LANE_SCALING_ENABLED,
      equityLaneScalingBaseEquity: EQUITY_LANE_SCALING_BASE_EQUITY,
      equityLaneScalingStartEquity: EQUITY_LANE_SCALING_START_EQUITY,
      equityLaneScalingCurve: EQUITY_LANE_SCALING_CURVE,
      equityLaneScalingMaxMultiplier: EQUITY_LANE_SCALING_MAX_MULTIPLIER,
      equityLaneScalingRequireNormalProfitLock: EQUITY_LANE_SCALING_REQUIRE_NORMAL_PROFIT_LOCK,
      equityLaneScalingRequireWsBook: EQUITY_LANE_SCALING_REQUIRE_WS_BOOK,
      fastGrowEvPolicyEnabled: FAST_GROW_EV_POLICY_ENABLED,
      fastGrowEvMinNetEdge: FAST_GROW_EV_MIN_NET_EDGE,
      fastGrowEvLaneSMinNetEdge: FAST_GROW_EV_LANE_S_MIN_NET_EDGE,
      fastGrowEvLaneAMinFraction: FAST_GROW_EV_LANE_A_MIN_FRACTION,
      fastGrowEvLaneAMaxFraction: FAST_GROW_EV_LANE_A_MAX_FRACTION,
      fastGrowEvLaneSMinFraction: FAST_GROW_EV_LANE_S_MIN_FRACTION,
      fastGrowEvLaneSMaxFraction: FAST_GROW_EV_LANE_S_MAX_FRACTION,
      fastGrowEvLaneSMaxEdge: FAST_GROW_EV_LANE_S_MAX_EDGE,
      fastGrowDepthUtilization: FAST_GROW_DEPTH_UTILIZATION,
      fastGrowSkipBelowMarketMin: FAST_GROW_SKIP_BELOW_MARKET_MIN,
      antiPlateauSizingBasis: "current_realized_equity_not_peak_equity",
      antiPlateauMartingale: false,
      v333DrawdownGuardEnabled: V333_DRAWDOWN_GUARD_ENABLED,
      v333MinSizingEquityUsd: V333_MIN_SIZING_EQUITY_USD,
      v333ColdStartSettledRequired: V333_COLD_START_SETTLED_REQUIRED,
      v333ColdStartLaneACapUsd: V333_COLD_START_LANE_A_CAP_USD,
      v333DrawdownProbeCapUsd: V333_DRAWDOWN_PROBE_CAP_USD,
      v333BlockUpInDrawdown: V333_BLOCK_UP_IN_DRAWDOWN,
      v334StrictEntryGuardEnabled: V334_STRICT_ENTRY_GUARD_ENABLED,
      v334AllowedSymbols: [...V334_ALLOWED_SYMBOLS],
      v334AllowedTimeframes: [...V334_ALLOWED_TIMEFRAMES],
      v334AllowedSides: [...V334_ALLOWED_SIDES],
      v334MaxEntryPrice: V334_MAX_ENTRY_PRICE,
      v334MaxOpenPositions: V334_MAX_OPEN_POSITIONS,
      v334BlockRuntimeToxic: V334_BLOCK_RUNTIME_TOXIC,
      v334BlockReplayBad: V334_BLOCK_REPLAY_BAD,
      v334BlockRestBook: V334_BLOCK_REST_BOOK,
      v334BlockAfterLossStreak: V334_BLOCK_AFTER_LOSS_STREAK,
      simulatedLatencyMs: SIMULATED_LATENCY_MS,
      scanIntervalMs: SCAN_INTERVAL_MS,
      uiTickIntervalMs: UI_TICK_INTERVAL_MS,
      btcPredictionEnabled: BTC_PREDICTION_ENABLED,
      btcPredictionStrategyVersion: BTC_PREDICTION_STRATEGY_VERSION,
      btcPredictionTargetWinRate: BTC_PREDICTION_TARGET_WIN_RATE,
      btcPredictionMinConfidence: ACTIVE_BTC_PREDICTION_MIN_CONFIDENCE,
      btcPredictionMinEdgePercent: ACTIVE_BTC_PREDICTION_MIN_EDGE_PERCENT,
      btcPredictionMinDistanceBps: ACTIVE_BTC_PREDICTION_MIN_DISTANCE_BPS,
      btcPredictionMaxBookAgeMs: ACTIVE_BTC_PREDICTION_MAX_BOOK_AGE_MS,
      btcPredictionMinSecondsIntoWindow: ACTIVE_BTC_PREDICTION_MIN_SECONDS_INTO_WINDOW,
      btcPredictionMaxSecondsIntoWindow: ACTIVE_BTC_PREDICTION_MAX_SECONDS_INTO_WINDOW,
      btcPredictionMaxEntryPrice: ACTIVE_BTC_PREDICTION_MAX_ENTRY_PRICE,
      btcPredictionMaxSpreadCents: ACTIVE_BTC_PREDICTION_MAX_SPREAD_CENTS,
      btcPredictionLossCircuitCount: BTC_PREDICTION_LOSS_CIRCUIT_COUNT,
      btcPredictionLossCircuitWindowMs: BTC_PREDICTION_LOSS_CIRCUIT_WINDOW_MS,
      btcPredictionLearnedFilterEnabled: BTC_PREDICTION_LEARNED_FILTER_ENABLED,
      btcPredictionMinBucketSamples: BTC_PREDICTION_MIN_BUCKET_SAMPLES,
      btcPredictionMinBucketRoi: BTC_PREDICTION_MIN_BUCKET_ROI,
      referenceWalletEnabled: REFERENCE_WALLET_ENABLED,
      referenceWalletName: REFERENCE_WALLET_NAME,
      referenceWalletAddress: REFERENCE_WALLET_ADDRESS,
      referenceTradeLimit: REFERENCE_TRADE_LIMIT,
      aiAgentEnabled: AI_AGENT_ENABLED,
      aiAgentMode: AI_AGENT_MODE,
      aiAgentCanExecute: AI_AGENT_CAN_EXECUTE,
      aiAgentPoolSize: AI_AGENT_POOL_SIZE,
      aiAgentActiveMax: AI_AGENT_ACTIVE_MAX,
      agentSidecarEnabled: process.env.AGENT_SIDECAR_ENABLED !== "0",
      agentAdviceCacheTtlMs: AGENT_ADVICE_CACHE_TTL_MS,
      obsidianExportEnabled: process.env.OBSIDIAN_EXPORT_ENABLED !== "0",
      cryptoScannerEnabled: CRYPTO_SCANNER_ENABLED,
      cryptoScannerMode: CRYPTO_SCANNER_MODE,
      cryptoScannerTargetedMarketsEnabled: CRYPTO_SCANNER_TARGETED_MARKETS_ENABLED,
      cryptoScannerSymbols: CRYPTO_SCANNER_SYMBOLS,
      cryptoScannerFastTimeframes: CRYPTO_SCANNER_FAST_TIMEFRAMES,
      cryptoScannerContextTimeframes: CRYPTO_SCANNER_CONTEXT_TIMEFRAMES,
      cryptoScannerMaxWatchedMarkets: CRYPTO_SCANNER_MAX_WATCHED_MARKETS,
      cryptoScannerMaxTradeCandidates: CRYPTO_SCANNER_MAX_TRADE_CANDIDATES,
      marketDiscoveryCacheTtlMs: MARKET_DISCOVERY_CACHE_TTL_MS,
      cryptoScannerMarketCacheTtlMs: CRYPTO_SCANNER_MARKET_CACHE_TTL_MS,
      multiAssetPredictionEnabled: MULTI_ASSET_PREDICTION_ENABLED,
      multiAssetPredictionSymbols: MULTI_ASSET_PREDICTION_SYMBOLS,
      multiAssetPredictionTimeframes: MULTI_ASSET_PREDICTION_TIMEFRAMES,
      multiAssetMinScannerScore: MULTI_ASSET_MIN_SCANNER_SCORE,
      multiAssetMinEdgePercent: MULTI_ASSET_MIN_EDGE_PERCENT,
      multiAssetMinSecondsIntoWindow: MULTI_ASSET_MIN_SECONDS_INTO_WINDOW,
      multiAssetMaxSecondsIntoWindow: MULTI_ASSET_MAX_SECONDS_INTO_WINDOW,
      multiAssetRequireScannerOpportunity: MULTI_ASSET_REQUIRE_SCANNER_OPPORTUNITY,
      multiAssetSelectionPoolSize: MULTI_ASSET_SELECTION_POOL_SIZE,
      multiAssetCommitMarketsPerTick: MULTI_ASSET_COMMIT_MARKETS_PER_TICK,
      fastGrowthMode: FAST_GROWTH_MODE,
      aggressiveLearningMode: AGGRESSIVE_LEARNING_MODE,
      riskProfile: RISK_PROFILE,
      btcPredictionMinSelectedProbability: ACTIVE_BTC_PREDICTION_MIN_SELECTED_PROBABILITY,
      btcPredictionMinFeeAdjustedEdge: ACTIVE_BTC_PREDICTION_MIN_FEE_ADJUSTED_EDGE,
      btcPredictionMinVolAdjDistance: ACTIVE_BTC_PREDICTION_MIN_VOL_ADJ_DISTANCE,
      btcPredictionMaxYesNoAskCost: ACTIVE_BTC_PREDICTION_MAX_YES_NO_ASK_COST,
      btcPredictionSignalStableTicks: ACTIVE_BTC_PREDICTION_SIGNAL_STABLE_TICKS,
      maxActivePositions: MAX_ACTIVE_POSITIONS,
      maxConsecutiveLosses: EFFECTIVE_MAX_CONSECUTIVE_LOSSES,
      maxDailyLossFraction: ACTIVE_MAX_DAILY_LOSS_FRACTION,
      veryAggressiveSampleMode: VERY_AGGRESSIVE_SAMPLE_MODE,
      strategyRouterEnabled: STRATEGY_ROUTER_ENABLED,
      gateProtocolEnabled: GATE_PROTOCOL_ENABLED,
      consensusEngineEnabled: CONSENSUS_ENGINE_ENABLED,
      strategyMode: STRATEGY_MODE,
        realMarketDataOnly: REAL_MARKET_DATA_ONLY,
        allowSyntheticBook: ALLOW_SYNTHETIC_BOOK,
        allowSyntheticPrice: ALLOW_SYNTHETIC_PRICE,
        fallbackCanOpenPosition: FALLBACK_CAN_OPEN_POSITION,
        fallbackExcludeFromLearning: FALLBACK_EXCLUDE_FROM_LEARNING,
      polymarketOfficialSettlementEnabled: POLYMARKET_OFFICIAL_SETTLEMENT_ENABLED,
      polymarketOfficialSettlementGraceMs: POLYMARKET_OFFICIAL_SETTLEMENT_GRACE_MS,
      polymarketOfficialSettlementRequire: POLYMARKET_OFFICIAL_SETTLEMENT_REQUIRE,
      polymarketOfficialSettlementTimeoutMs: POLYMARKET_OFFICIAL_SETTLEMENT_TIMEOUT_MS,
      polymarketOfficialReconcileEnabled: POLYMARKET_OFFICIAL_RECONCILE_ENABLED,
      polymarketOfficialReconcileMaxPerScan: POLYMARKET_OFFICIAL_RECONCILE_MAX_PER_SCAN,
      strategyMaxCandidatesPerTick: STRATEGY_MAX_CANDIDATES_PER_TICK,
        paperMaxEntriesPerTick: PAPER_MAX_ENTRIES_PER_TICK,
        strategyDualSideEnabled: STRATEGY_DUAL_SIDE_ENABLED,
        strategyOrderbookPressureEnabled: STRATEGY_ORDERBOOK_PRESSURE_ENABLED,
        strategyRuntimeAutoDisableEnabled: STRATEGY_RUNTIME_AUTO_DISABLE_ENABLED,
        strategyRuntimeAutoDisableMinSamples: STRATEGY_RUNTIME_AUTO_DISABLE_MIN_SAMPLES,
        strategyRuntimeAutoDisableMinRoi: STRATEGY_RUNTIME_AUTO_DISABLE_MIN_ROI,
        strategyRuntimeAutoDisableMinWinRate: STRATEGY_RUNTIME_AUTO_DISABLE_MIN_WIN_RATE,
        strategyExecutableStrategies: STRATEGY_EXECUTABLE_STRATEGIES,
        qualityEntryPriceMin: QUALITY_ENTRY_PRICE_MIN,
        qualityEntryPriceMax: QUALITY_ENTRY_PRICE_MAX,
        qualityDualSideRestrictAfterSeconds: QUALITY_DUAL_SIDE_RESTRICT_AFTER_SECONDS,
        qualityDualSideHardBlockAfterSeconds: QUALITY_DUAL_SIDE_HARD_BLOCK_AFTER_SECONDS,
      maxPositionsPerWindow: MAX_POSITIONS_PER_WINDOW,
      maxSameSidePerWindow: MAX_SAME_SIDE_PER_WINDOW,
      maxStrategyPositionsPerWindow: MAX_STRATEGY_POSITIONS_PER_WINDOW,
      boostedPyramidEnabled: BOOSTED_PYRAMID_ENABLED,
      boostedPyramidMaxSameSidePerWindow: BOOSTED_PYRAMID_MAX_SAME_SIDE_PER_WINDOW,
      kellySizingEnabled: KELLY_SIZING_ENABLED,
      learningBrainEnabled: LEARNING_BRAIN_ENABLED,
      learningBrainMode: LEARNING_BRAIN_MODE,
    learningBrainImportedSamples: IMPORTED_LEARNING_BRAIN?.importedSamples || 0,
    replayOptimizerEnabled: REPLAY_OPTIMIZER_ENABLED,
    replayOptimizerSettled: REPLAY_OPTIMIZER_STATE?.summary?.settled || 0,
    replayOptimizerActiveRules: REPLAY_OPTIMIZER_STATE?.summary?.activeRules || 0,
    replayOptimizerActionMode: REPLAY_OPTIMIZER_STATE?.actionMode || "enforce",
    replayOptimizerBlockingEnabled: REPLAY_OPTIMIZER_STATE?.blockingEnabled !== false,
    replayOptimizerReduceStakeEnabled: REPLAY_OPTIMIZER_STATE?.reduceStakeEnabled !== false,
    runtimeRuleCacheEnabled: RUNTIME_RULE_CACHE_ENABLED,
    runtimeRuleCacheMinBucketSamples: RUNTIME_RULE_CACHE_MIN_BUCKET_SAMPLES,
    runtimeRuleCacheMinStakeMultiplier: RUNTIME_RULE_CACHE_MIN_STAKE_MULTIPLIER,
    runtimeRuleCacheMaxStakeMultiplier: RUNTIME_RULE_CACHE_MAX_STAKE_MULTIPLIER,
    softQualityMode: SOFT_QUALITY_MODE,
    progressiveStakeEnabled: PROGRESSIVE_STAKE_ENABLED,
    adaptiveLearningEnabled: ADAPTIVE_LEARNING_ENABLED,
    adaptiveMode: ADAPTIVE_MODE,
    adaptiveUseImportedLearning: ADAPTIVE_USE_IMPORTED_LEARNING,
    adaptiveEarlyWindowSeconds: ADAPTIVE_EARLY_WINDOW_SECONDS,
    adaptiveLateWindowSeconds: ADAPTIVE_LATE_WINDOW_SECONDS,
    adaptiveHighEntryPrice: ADAPTIVE_HIGH_ENTRY_PRICE,
    adaptiveWideSpreadCents: ADAPTIVE_WIDE_SPREAD_CENTS,
      adaptivePatternBlockMinutes: ADAPTIVE_PATTERN_BLOCK_MINUTES,
      adaptiveRecoveryStakeMultiplier: ADAPTIVE_RECOVERY_STAKE_MULTIPLIER,
      qualityCEntryEnabled: QUALITY_C_ENTRY_ENABLED,
      qualityAPlusRequireBookConfirmation: QUALITY_A_PLUS_REQUIRE_BOOK_CONFIRMATION,
      qualityLateWindowSeconds: QUALITY_LATE_WINDOW_SECONDS,
      qualityLateEntryPrice: QUALITY_LATE_ENTRY_PRICE,
      qualityLateEntryMinEdge: QUALITY_LATE_ENTRY_MIN_EDGE,
    },
    metrics: {
      balance: PAPER_START_BALANCE,
      cashBalance: PAPER_START_BALANCE,
      paperBalance: PAPER_START_BALANCE,
      paperEquity: PAPER_START_BALANCE,
      openExposure: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      pnlPercent: 0,
      scannedMarkets: 0,
      scannedBooks: 0,
      opportunities: 0,
      acceptedTrades: 0,
      rejectedSignals: 0,
      winRate: 0,
      avgEdgePercent: 0,
      avgProfitUsd: 0,
      bestProfitUsd: 0,
      bestEdgePercent: 0,
      fillRate: 0,
      avgBookAgeMs: 0,
      avgBookFetchMs: 0,
      cacheHitRate: 0,
    },
    execution: createEmptyExecution(),
    bestOpportunity: null,
    opportunities: [],
    trades: [],
    rejects: [],
    marketRows: [],
    rejectionSummary: [],
    categorySummary: [],
    history: [],
    prediction: loadPersistedPrediction(),
    reference: loadPersistedReference(),
    agents: createEmptyAgents(),
    scanner: createEmptyScanner(),
    risk: createEmptyRisk(),
    strategyRouter: createEmptyStrategyRouter(),
    gateProtocol: createEmptyGateProtocol(),
    learning: createEmptyLearning(),
    adaptiveLearning: createEmptyAdaptiveLearningState({
      enabled: ADAPTIVE_LEARNING_ENABLED,
      mode: ADAPTIVE_LEARNING_ENABLED ? ADAPTIVE_MODE : "disabled",
    }),
    weather: buildWeatherStrategyStatus(),
    exitEngine: buildExitEngineStatus(),
    updatedAt: new Date().toISOString(),
  };
}

function createEmptyExecution(overrides = {}) {
  return {
    mode: "paper_depth_fok",
    bookFeedStatus: ORDERBOOK_WS_ENABLED ? "starting" : "disabled",
    bookFeedTokens: 0,
    bookFeedUpdates: 0,
    cacheHits: 0,
    restFetches: 0,
    wsSnapshots: 0,
    staleBooks: 0,
    avgBookAgeMs: 0,
    avgBookFetchMs: 0,
    entryBookAgeMs: 0,
    entryRefreshes: 0,
    staleEntryDrops: 0,
    httpConnectMs: 0,
    httpTlsMs: 0,
    httpTotalMs: 0,
    eventLoopDelayMs: 0,
    eventLoopDelayP95Ms: 0,
    scanSkippedTicks: 0,
    scanCatchupRuns: 0,
    scanLatencyMs: 0,
    scanLatencyP95Ms: 0,
    paperCandidates: 0,
    paperFills: 0,
    paperRejects: 0,
    avgExecutionLatencyMs: SIMULATED_LATENCY_MS,
    avgSlippageCents: 0,
    externalPriceFeed: null,
    lastBookSource: "pending",
    lastError: "",
    updatedAt: null,
    ...overrides,
  };
}

function createEmptyPrediction(overrides = {}) {
  return {
    status: "pending",
    title: "BTC up or down 5m",
    slug: "",
    marketUrl: "",
    windowStart: null,
    windowEnd: null,
    timeLeftSec: 0,
    priceToBeat: 0,
    targetSource: "pending",
    currentPrice: 0,
    currentSource: "pending",
    priceDelta: 0,
    priceDeltaPercent: 0,
    predictedOutcome: "WAIT",
    confidence: 0,
    reason: "waiting_for_first_scan",
    upBuyPrice: 0,
    downBuyPrice: 0,
    upSellPrice: 0,
    downSellPrice: 0,
    upMidPrice: 0,
    downMidPrice: 0,
    upDepthShares: 0,
    downDepthShares: 0,
    upBidPrice: 0,
    downBidPrice: 0,
    bookSource: "pending",
    bookAgeMs: 0,
    paperFillShares: 0,
    upOutcomePrice: 0,
    downOutcomePrice: 0,
    selectedBuyPrice: 0,
    selectedBidPrice: 0,
    selectedEdgePercent: 0,
    selectedSpreadCents: 0,
    probabilityUp: 0,
    probabilityDown: 0,
    selectedProbability: 0,
    feeAdjustedEdge: 0,
    grossEdge: 0,
    feeEstimate: 0,
    rank: "SKIP",
    volatility60Bps: 0,
    volatilityAdjustedDistance: 0,
    momentum15Bps: 0,
    momentum30Bps: 0,
    momentum60Bps: 0,
    selectedBookImbalance: 0,
    yesNoAskCost: 0,
    stableTicks: 0,
    riskApproved: false,
    riskReason: "waiting",
    recommendedStakeUsd: 0,
    adaptiveStakeMultiplier: 1,
    adaptiveDecision: null,
    adaptiveLearning: createEmptyAdaptiveLearningState({
      enabled: ADAPTIVE_LEARNING_ENABLED,
      mode: ADAPTIVE_LEARNING_ENABLED ? ADAPTIVE_MODE : "disabled",
    }),
    secondsIntoWindow: 0,
    requiredConfidence: 0,
    requiredDistanceBps: 0,
    distanceBps: 0,
    tradeable: false,
    lastSignal: null,
    signals: [],
    history: [],
    stats: {
      signals: 0,
      settled: 0,
      wins: 0,
      winRate: 0,
      paperPnl: 0,
      paperRoi: 0,
      totalStakeSettled: 0,
      avgConfidence: 0,
      avgBuyPrice: 0,
      breakEvenAccuracy: 0,
      sampleTarget: BTC_SAMPLE_TARGET,
      sampleProgress: 0,
      minReliableSamples: Math.min(100, BTC_SAMPLE_TARGET),
      reliable: false,
      buckets: [],
    },
    updatedAt: null,
    lastError: "",
    ...overrides,
  };
}


function createEmptyAgents(overrides = {}) {
  return {
    mode: AI_AGENT_MODE,
    enabled: AI_AGENT_ENABLED,
    canExecute: AI_AGENT_CAN_EXECUTE,
    poolSize: AI_AGENT_POOL_SIZE,
    activeMax: AI_AGENT_ACTIVE_MAX,
    activeAgents: 0,
    decision: "WAIT",
    agents: [],
    updatedAt: null,
    ...overrides,
  };
}

function createEmptyAgentAdvice(overrides = {}) {
  return {
    version: 1,
    status: "waiting",
    mode: "read_only_agent_sidecar",
    canExecute: false,
    updatedAt: null,
    nextRunAt: null,
    source: { apiBase: "", dataMode: REAL_MARKET_DATA_ONLY ? "real-only" : "mixed" },
    account: {},
    scanner: {},
    performance: { settled: {}, byStrategy: [] },
    recommendations: [],
    obsidian: { enabled: false },
    ...overrides,
  };
}

function createEmptyScanner(overrides = {}) {
  return {
    enabled: CRYPTO_SCANNER_ENABLED,
    mode: CRYPTO_SCANNER_MODE,
    watchedMarkets: 0,
    cryptoCandidates: 0,
    subscribedMarkets: 0,
    tradeCandidates: 0,
    topCandidates: [],
    strategies: {},
    updatedAt: null,
    ...overrides,
  };
}

function createEmptyStrategyRouter(overrides = {}) {
  return {
    enabled: STRATEGY_ROUTER_ENABLED,
    mode: STRATEGY_MODE,
    veryAggressiveSampleMode: VERY_AGGRESSIVE_SAMPLE_MODE,
    profitFocusMode: PROFIT_FOCUS_MODE,
    candidates: [],
    selected: null,
    summary: { total: 0, approved: 0, blocked: 0, selectedStrategy: "none", selectedSide: "WAIT" },
    updatedAt: null,
    ...overrides,
  };
}

function createEmptyGateProtocol(overrides = {}) {
  return {
    enabled: GATE_PROTOCOL_ENABLED,
    approved: false,
    reason: "waiting",
    blockedAt: null,
    allGates: [],
    gateSummary: { passed: 0, total: 0, firstBlockedGate: null, firstBlockedName: "", firstBlockedReason: "" },
    updatedAt: null,
    ...overrides,
  };
}

function createEmptyLearning(overrides = {}) {
  return {
    status: "waiting",
    total: {},
    bySource: [],
    strategies: [],
    confidenceBuckets: [],
    entryPriceBuckets: [],
    gateFailures: {},
    recommendations: [],
    adaptive: createEmptyAdaptiveLearningState({
      enabled: ADAPTIVE_LEARNING_ENABLED,
      mode: ADAPTIVE_LEARNING_ENABLED ? ADAPTIVE_MODE : "disabled",
    }),
    updatedAt: null,
    ...overrides,
  };
}

function createEmptyRisk(overrides = {}) {
  return {
    fastGrowthMode: FAST_GROWTH_MODE,
    aggressiveLearningMode: AGGRESSIVE_LEARNING_MODE,
    riskProfile: RISK_PROFILE,
    maxActivePositions: MAX_ACTIVE_POSITIONS,
    maxConsecutiveLosses: EFFECTIVE_MAX_CONSECUTIVE_LOSSES,
    maxDailyLossFraction: ACTIVE_MAX_DAILY_LOSS_FRACTION,
    maxPositionsPerWindow: MAX_POSITIONS_PER_WINDOW,
    maxSameSidePerWindow: MAX_SAME_SIDE_PER_WINDOW,
    maxStrategyPositionsPerWindow: MAX_STRATEGY_POSITIONS_PER_WINDOW,
    consecutiveLosses: 0,
    dailyPnl: 0,
    dailyLossFraction: 0,
    activePositions: 0,
    approved: false,
    reason: "waiting",
    recommendedStakeUsd: 0,
    updatedAt: null,
    ...overrides,
  };
}

function createEmptyReference(overrides = {}) {
  const reference = {
    status: "pending",
    walletName: REFERENCE_WALLET_NAME,
    walletAddress: REFERENCE_WALLET_ADDRESS,
    profileUrl: `${POLYMARKET_WEB}/@${REFERENCE_WALLET_NAME.toLowerCase()}`,
    mode: "reference_only",
    trades: [],
    positions: [],
    stats: {
      tradesTracked: 0,
      newTrades: 0,
      buyCount: 0,
      sellCount: 0,
      buyShare: 0,
      totalSampleVolumeUsd: 0,
      avgTradeUsd: 0,
      medianTradeUsd: 0,
      avgPrice: 0,
      latestTradeAt: null,
      latestAgeSec: null,
      active: false,
      openPositions: 0,
      positionValueUsd: 0,
      openPnlUsd: 0,
      topAsset: "WAIT",
      topTimeframe: "WAIT",
      assets: [],
      timeframes: [],
      outcomes: [],
    },
    agreement: {
      status: "waiting",
      botOutcome: "WAIT",
      referenceOutcome: "WAIT",
      referenceMarket: "",
      referenceAgeSec: null,
    },
    updatedAt: null,
    lastError: "",
    ...overrides,
  };

  if (!overrides.stats) reference.stats = summarizeReferenceStats(reference.trades, reference.positions, 0);
  return reference;
}

function getSignalCooldownKey(slug, strategy = "current_prediction", direction = "WAIT", sampleBucket = null, secondsIntoWindow = null) {
  void sampleBucket;
  void secondsIntoWindow;
  return [
    String(slug || "unknown").trim().toLowerCase(),
    String(strategy || "current_prediction").trim().toLowerCase(),
    String(direction || "WAIT").trim().toUpperCase(),
  ].join(":");
}

function loadPersistedPrediction() {
  try {
    if (!PAPER_STATE_PERSISTENCE_ENABLED) return createEmptyPrediction();
    if (!fs.existsSync(BTC_PAPER_STATE_PATH)) return createEmptyPrediction();
    const raw = fs.readFileSync(BTC_PAPER_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const prediction = createEmptyPrediction({
      signals: Array.isArray(parsed.signals) ? parsed.signals.map(normalizeLegacyProxyStatus).slice(0, 500) : [],
      history: Array.isArray(parsed.history) ? parsed.history.slice(-500) : [],
    });
    prediction.stats = summarizePredictionStats(prediction.signals);
    predictionPersistenceGate.markLoaded(
      canonicalPredictionPayload(prediction),
      Date.parse(parsed.updatedAt || "") || Date.now(),
    );
    for (const signal of prediction.signals) {
      if (signal.slug) {
        seenPredictionSignals.set(
          getSignalCooldownKey(
            signal.slug,
            signal.strategy || signal.entryStrategy,
            signal.direction || signal.side,
            signal.researchSampleBucket,
            signal.secondsIntoWindow,
          ),
          Date.parse(signal.time) || Date.now(),
        );
      }
    }
    return prediction;
  } catch {
    return createEmptyPrediction({
      status: "storage_error",
      reason: "paper_state_load_failed",
    });
  }
}

function savePersistedPrediction(prediction, options = {}) {
  try {
    if (!PAPER_STATE_PERSISTENCE_ENABLED) return false;
    const payload = canonicalPredictionPayload(prediction);
    const gate = predictionPersistenceGate.shouldWrite(payload, options);
    if (!gate.write) return false;
    fs.mkdirSync(path.dirname(BTC_PAPER_STATE_PATH), { recursive: true });
    writeJsonFileAtomic(BTC_PAPER_STATE_PATH, {
      ...payload,
      updatedAt: new Date(gate.currentTimeMs).toISOString(),
      persistenceReason: gate.reason,
    });
    predictionPersistenceGate.markWritten(gate.fingerprint, gate.currentTimeMs);
    return true;
  } catch {
    // Persistence failure should not stop live paper scans.
    return false;
  }
}

function writeJsonFile(filePath, payload) {
  writeJsonFileAtomic(filePath, payload);
}

function writeJsonFileAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tempPath, filePath);
}

function appendJsonlFile(filePath, rows = []) {
  const safeRows = rows.filter(Boolean);
  if (!safeRows.length) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, safeRows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

function copyIfExists(sourcePath, targetPath) {
  try {
    if (!fs.existsSync(sourcePath)) return false;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    return true;
  } catch {
    return false;
  }
}

function lastGoodFileMap() {
  return [
    [path.join(DATA_DIR, "learning", "runtime-rule-cache.json"), path.join(LAST_GOOD_DIR, "runtime-rule-cache.good.json")],
    [path.join(DATA_DIR, "learning", "walkforward-calibration.json"), path.join(LAST_GOOD_DIR, "walkforward-calibration.good.json")],
    [path.join(DATA_DIR, "learning", "imported-strategy-performance.json"), path.join(LAST_GOOD_DIR, "imported-strategy-performance.good.json")],
    [path.join(DATA_DIR, "reports", "strategy-performance-latest.json"), path.join(LAST_GOOD_DIR, "strategy-performance.good.json")],
    [path.join(DATA_DIR, "reports", "calibration-latest.json"), path.join(LAST_GOOD_DIR, "calibration.good.json")],
  ];
}

function backupLearningArtifacts(backupDir, reason = "paper_equity_reset") {
  const copied = [];
  const targets = lastGoodFileMap().map(([source]) => source);
  for (const sourcePath of targets) {
    if (!RESET_PRESERVE_RUNTIME_CACHE && sourcePath.includes("runtime-rule-cache")) continue;
    if (!RESET_PRESERVE_STRATEGY_REPORTS && sourcePath.includes(`${path.sep}reports${path.sep}`)) continue;
    const targetPath = path.join(backupDir, "learning-preserved", path.relative(DATA_DIR, sourcePath));
    if (copyIfExists(sourcePath, targetPath)) copied.push(path.relative(DATA_DIR, sourcePath));
  }
  writeJsonFile(path.join(backupDir, "learning-preserve-manifest.json"), {
    reason,
    resetPreserveLearningMemory: RESET_PRESERVE_LEARNING_MEMORY,
    resetPreserveRuntimeCache: RESET_PRESERVE_RUNTIME_CACHE,
    resetPreserveStrategyReports: RESET_PRESERVE_STRATEGY_REPORTS,
    copied,
    updatedAt: new Date().toISOString(),
  });
  return copied;
}

function saveLastGoodModelSnapshot({ prediction = null, reason = "last_good_runtime" } = {}) {
  if (!LAST_GOOD_MODEL_ENABLED) return { saved: false, reason: "last_good_disabled" };
  const stats = prediction?.stats || summarizePredictionStats(prediction?.signals || []);
  const settled = toNumber(stats.settledPaperTrades ?? stats.settledTrades ?? stats.totalSettled ?? stats.samples, 0);
  const winRate = toNumber(stats.paperWinRate ?? stats.winRate, 0);
  const roi = toNumber(stats.paperRoi ?? stats.roi ?? stats.roiPercent, 0);
  if (settled < LAST_GOOD_SAVE_MIN_SETTLED) return { saved: false, reason: "last_good_not_enough_settled", settled, winRate, roi };
  if (winRate < LAST_GOOD_SAVE_MIN_WINRATE) return { saved: false, reason: "last_good_winrate_below_threshold", settled, winRate, roi };
  if (roi < LAST_GOOD_SAVE_MIN_ROI) return { saved: false, reason: "last_good_roi_below_threshold", settled, winRate, roi };

  const copied = [];
  for (const [sourcePath, targetPath] of lastGoodFileMap()) {
    if (copyIfExists(sourcePath, targetPath)) copied.push(path.basename(targetPath));
  }
  writeJsonFile(path.join(LAST_GOOD_DIR, "manifest.json"), {
    savedAt: new Date().toISOString(),
    reason,
    settled,
    winRate,
    roi,
    copied,
    strategyVersion: BTC_PREDICTION_STRATEGY_VERSION,
    effectiveConfig: {
      scanIntervalMs: SCAN_INTERVAL_MS,
      hotMarketFastLaneEnabled: HOT_MARKET_FAST_LANE_ENABLED,
      hotMarketScanIntervalMs: HOT_MARKET_SCAN_INTERVAL_MS,
      ultraHotMarketScanIntervalMs: ULTRA_HOT_MARKET_SCAN_INTERVAL_MS,
      paperMaxEntriesPerTick: PAPER_MAX_ENTRIES_PER_TICK,
      maxActivePositions: MAX_ACTIVE_POSITIONS,
      minExecutableStakeUsd: MIN_EXECUTABLE_STAKE_USD,
      accuracyRerankerEnabled: ACCURACY_RERANKER_ENABLED,
    },
  });
  return { saved: true, settled, winRate, roi, copied };
}

function restoreLastGoodModelSnapshot() {
  if (!LAST_GOOD_MODEL_ENABLED || !LAST_GOOD_RESTORE_ON_RESET) return { restored: false, reason: "last_good_restore_disabled" };
  const restorePairs = lastGoodFileMap().map(([sourcePath, goodPath]) => [goodPath, sourcePath]);
  const restored = [];
  for (const [sourcePath, targetPath] of restorePairs) {
    if (copyIfExists(sourcePath, targetPath)) restored.push(path.relative(DATA_DIR, targetPath));
  }
  return {
    restored: restored.length > 0,
    reason: restored.length ? "last_good_restored" : "last_good_snapshot_missing",
    restored,
  };
}

function settlementPriority(signal = {}) {
  const source = String(signal.settlementSource || signal.settlementFinality || "").toLowerCase();
  if (source.includes("official_poly_reconciled")) return 5;
  if (source.includes("official_poly")) return 4;
  if (source.includes("proxy")) return 2;
  if (source.includes("pending")) return 1;
  return signal.status === "paper_win" || signal.status === "paper_loss" ? 3 : 0;
}

function canonicalSignalId(signal = {}) {
  if (signal.id) return String(signal.id);
  return [
    signal.slug || "unknown",
    signal.strategy || signal.entryStrategy || "unknown",
    String(signal.direction || signal.side || "unknown").toUpperCase(),
    signal.time || signal.windowStart || "",
  ].join(":");
}

function uniqueOfficialFinalSignals(signals = []) {
  const output = [];
  const settledById = new Map();
  for (const signal of Array.isArray(signals) ? signals : []) {
    if (!signal || (signal.status !== "paper_win" && signal.status !== "paper_loss")) {
      output.push(signal);
      continue;
    }
    const key = canonicalSignalId(signal);
    const previous = settledById.get(key);
    if (!previous || settlementPriority(signal) >= settlementPriority(previous.signal)) {
      settledById.set(key, { signal, index: previous?.index ?? output.length });
      if (!previous) output.push(signal);
      else output[previous.index] = signal;
    }
  }
  return output.filter(Boolean);
}

function uniqueOfficialFinalSettled(signals = []) {
  return uniqueOfficialFinalSignals(signals).filter(shouldTrainFromSettlement);
}

function normalizeLegacyProxyStatus(signal = {}) {
  const source = String(signal.settlementSource || signal.settlementFinality || "").toLowerCase();
  if ((signal.status === "paper_win" || signal.status === "paper_loss") && source.includes("proxy")) {
    return { ...signal, status: provisionalProxyStatus(signal.status === "paper_win") };
  }
  return signal;
}

function safeTimestampKey(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "").replace("T", "-").replace("Z", "Z");
}

function readPersistedPaperState() {
  if (!fs.existsSync(BTC_PAPER_STATE_PATH)) return { version: 1, signals: [], history: [] };
  return JSON.parse(fs.readFileSync(BTC_PAPER_STATE_PATH, "utf8"));
}

function markOpenSignalClosed(signal = {}, prediction = {}, now = Date.now()) {
  if (signal.status !== "paper_open") return signal;
  const side = String(signal.direction || signal.side || "").toUpperCase();
  const bid = side === "UP" ? toNumber(prediction.upBidPrice, 0) : side === "DOWN" ? toNumber(prediction.downBidPrice, 0) : 0;
  const markPnlUsd = bid > 0
    ? (toNumber(signal.paperShares, 0) * bid) - toNumber(signal.paperStakeUsd, 0)
    : 0;
  return {
    ...signal,
    status: "paper_closed_manual",
    settledAt: new Date(now).toISOString(),
    finalPrice: prediction.currentPrice || signal.currentPrice || 0,
    bidPrice: bid || signal.bidPrice || 0,
    paperPnlUsd: markPnlUsd,
    settlementSource: "manual_close_mark_bid",
  };
}

function resetPaperLedger({ closeOpen = true, keepHistory = false } = {}) {
  const now = Date.now();
  paperLedgerGeneration += 1;
  const resetGeneration = paperLedgerGeneration;
  const stamp = safeTimestampKey(new Date(now));
  const persisted = readPersistedPaperState();
  const previousPrediction = state?.prediction || createEmptyPrediction({
    signals: Array.isArray(persisted.signals) ? persisted.signals : [],
    history: Array.isArray(persisted.history) ? persisted.history : [],
  });
  const signals = Array.isArray(previousPrediction.signals) ? previousPrediction.signals : [];
  // V356 reset must clean paper-open positions when reset-equity is requested.
  // Active-position immutability is a live-entry guard, not a reset-preservation rule.
  const effectiveCloseOpen = Boolean(closeOpen);
  const closedSignals = effectiveCloseOpen ? signals.map((signal) => markOpenSignalClosed(signal, previousPrediction, now)) : signals;
  const immutableOpenSignals = [];
  const runtimeRuleCache = buildRuntimeRuleCache(signals);
  const settledSamples = closedSignals.filter((signal) => signal.status === "paper_win" || signal.status === "paper_loss");
  const manuallyClosed = closedSignals.filter((signal) => signal.status === "paper_closed_manual");
  const backupDir = path.join(DATA_DIR, "backups", `pre-equity-reset-${stamp}`);

  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(BTC_PAPER_STATE_PATH)) {
    fs.copyFileSync(BTC_PAPER_STATE_PATH, path.join(backupDir, "btc-paper-state.json"));
  }
  writeJsonFile(path.join(backupDir, "paper-reset-manifest.json"), {
    resetAt: new Date(now).toISOString(),
    closeOpen,
    previousSignals: signals.length,
    settledSamples: settledSamples.length,
    manuallyClosed: manuallyClosed.length,
    previousOpen: signals.filter((signal) => signal.status === "paper_open").length,
    immutableOpenPreserved: immutableOpenSignals.length,
    previousPaperStats: previousPrediction.stats || summarizePredictionStats(signals),
    resetPreserveLearningMemory: RESET_PRESERVE_LEARNING_MEMORY,
    resetBootstrapFromLastGoodCache: RESET_BOOTSTRAP_FROM_LAST_GOOD_CACHE,
    resetRuntimeMinSettledBeforeOverride: RESET_RUNTIME_MIN_SETTLED_BEFORE_OVERRIDE,
    lastGoodLockAfterResetSettled: LAST_GOOD_LOCK_AFTER_RESET_SETTLED,
    paperLedgerGeneration: resetGeneration,
  });
  writeJsonFile(path.join(backupDir, "preserved-signals.json"), closedSignals);
  const preservedLearningArtifacts = RESET_PRESERVE_LEARNING_MEMORY
    ? backupLearningArtifacts(backupDir, "paper_equity_reset_preserve_learning")
    : [];
  const lastGoodRestore = RESET_BOOTSTRAP_FROM_LAST_GOOD_CACHE
    ? restoreLastGoodModelSnapshot()
    : { restored: false, reason: "reset_bootstrap_from_last_good_disabled" };

  appendJsonlFile(path.join(DATA_DIR, "learning", "samples", "settlements", `${new Date(now).toISOString().slice(0, 10)}.jsonl`), settledSamples);
  appendJsonlFile(path.join(DATA_DIR, "learning", "samples", "manual-closes", `${new Date(now).toISOString().slice(0, 10)}.jsonl`), manuallyClosed);

  let previousBrain = IMPORTED_LEARNING_BRAIN;
  let previousReplayState = REPLAY_OPTIMIZER_STATE;
  try {
    IMPORTED_LEARNING_BRAIN = loadImportedLearningBrain(DATA_DIR, { enabled: LEARNING_BRAIN_ENABLED });
    REPLAY_OPTIMIZER_STATE = buildReplayThresholdOptimizerState(IMPORTED_LEARNING_BRAIN?.adaptiveSignals || [], buildReplayOptimizerConfig());
    persistReplayThresholdOptimizerState(DATA_DIR, REPLAY_OPTIMIZER_STATE);
  } catch (error) {
    // Learning brain reload should not stop the reset flow. Keep old in-process memory if reload fails.
    if (typeof previousBrain !== "undefined") IMPORTED_LEARNING_BRAIN = previousBrain;
    if (typeof previousReplayState !== "undefined") REPLAY_OPTIMIZER_STATE = previousReplayState;
  }

  const sessionAfterReset = startPaperResetSession(now);

  postResetState = {
    active: POST_RESET_STABILIZER_ENABLED,
    resetAt: new Date(now).toISOString(),
    resetGeneration,
    settledAfterReset: 0,
    lastGoodLocked: POST_RESET_STABILIZER_ENABLED,
    lockSettledTarget: POST_RESET_LOCK_LAST_GOOD_SETTLED,
    action: POST_RESET_ACTION,
    noStakeReduction: POST_RESET_NO_STAKE_REDUCTION,
    noPositionReduction: POST_RESET_NO_POSITION_REDUCTION,
    noScanSlowdown: POST_RESET_NO_SCAN_SLOWDOWN,
  };

  const nextPrediction = createEmptyPrediction({
    status: "reset",
    reason: immutableOpenSignals.length ? "paper_equity_reset_open_positions_preserved" : "paper_equity_reset_samples_preserved",
    signals: immutableOpenSignals,
    history: keepHistory ? (previousPrediction.history || []).slice(-500) : [],
    updatedAt: new Date(now).toISOString(),
    paperLedgerGeneration: resetGeneration,
    paperSessionId: sessionAfterReset.id,
    paperSessionHold: sessionAfterReset.hold,
    stats: summarizePredictionStats([]),
    resetProofMemory: {
      enabled: RESET_PRESERVE_LEARNING_MEMORY,
      preservedLearningArtifacts,
      lastGoodRestore,
      runtimeMinSettledBeforeOverride: RESET_RUNTIME_MIN_SETTLED_BEFORE_OVERRIDE,
      lastGoodLockAfterResetSettled: LAST_GOOD_LOCK_AFTER_RESET_SETTLED,
    },
  });
  savePersistedPrediction(nextPrediction);
  seenPredictionSignals.clear();
  seenTrades.clear();
  eligibilityEpisodeStore.clear();
  state = {
    ...state,
    prediction: nextPrediction,
    bestOpportunity: null,
    opportunities: [],
    trades: [],
    rejects: [],
    marketRows: [],
    rejectionSummary: [],
    categorySummary: [],
    history: [],
    metrics: {
      ...state.metrics,
      balance: PAPER_START_BALANCE,
      cashBalance: PAPER_START_BALANCE,
      paperBalance: PAPER_START_BALANCE,
      paperEquity: PAPER_START_BALANCE,
      openExposure: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      arbitrageRealizedPnl: 0,
      pnlPercent: 0,
      acceptedTrades: 0,
      rejectedSignals: 0,
      winRate: 0,
      avgEdgePercent: 0,
      avgProfitUsd: 0,
      bestProfitUsd: 0,
      bestEdgePercent: 0,
      fillRate: 0,
    },
    risk: createEmptyRisk({ activePositions: immutableOpenSignals.length, updatedAt: new Date(now).toISOString() }),
    paperLedgerGeneration: resetGeneration,
    updatedAt: new Date(now).toISOString(),
  };
  // V360.1 Reset Determinism Audit Fingerprint
  const getHash = (obj) => {
    if (!obj) return "no_hash";
    return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 16);
  };
  const fingerprint = {
    time: new Date(now).toISOString(),
    paperSessionId: sessionAfterReset.id,
    paperSessionHold: sessionAfterReset.hold,
    learningMemoryHash: getHash(IMPORTED_LEARNING_BRAIN),
    runtimeRuleCacheHash: getHash(runtimeRuleCache),
    importedBrainHash: getHash(IMPORTED_LEARNING_BRAIN?.report),
    activeScoreWeightsHash: getHash(state?.metrics || {}),
    openPositionsAfterReset: immutableOpenSignals.length,
    paperLedgerGeneration: resetGeneration,
  };
  writeJsonFile(path.join(backupDir, "reset-determinism-fingerprint.json"), fingerprint);
  console.log(`[RESET DETERMINISM AUDIT] Fingerprint logged: ${fingerprint.paperSessionId}`);

  return {
    ok: true,
    resetAt: new Date(now).toISOString(),
    backupDir,
    previousSignals: signals.length,
    settledSamplesPreserved: settledSamples.length,
    manualClosedPositions: manuallyClosed.length,
    openPositionsAfterReset: 0,
    paperStartBalance: PAPER_START_BALANCE,
    preservedLearningArtifacts,
    lastGoodRestore,
    paperSessionId: sessionAfterReset.id,
    paperSessionHold: sessionAfterReset.hold,
    releaseVersion: V356_RELEASE_VERSION,
    liveSelectionCore: V356_BASELINE_CORE,
    resetProofMemoryEnabled: RESET_PRESERVE_LEARNING_MEMORY,
    paperLedgerGeneration: resetGeneration,
  };
}

function loadPersistedReference() {
  try {
    if (!fs.existsSync(REFERENCE_STATE_PATH)) return createEmptyReference();
    const raw = fs.readFileSync(REFERENCE_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const trades = Array.isArray(parsed.trades) ? parsed.trades.slice(0, 500) : [];
    const positions = Array.isArray(parsed.positions) ? parsed.positions.slice(0, 100) : [];

    for (const trade of trades) {
      const key = getReferenceTradeKey(trade);
      if (key) seenReferenceTradeKeys.add(key);
    }
    if (trades.length) referencePollState.warmedUp = true;

    return createEmptyReference({
      trades,
      positions,
      stats: summarizeReferenceStats(trades, positions, 0),
      updatedAt: parsed.updatedAt || null,
    });
  } catch {
    return createEmptyReference({
      status: "storage_error",
      lastError: "reference_state_load_failed",
    });
  }
}

function savePersistedReference(reference) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      walletName: reference.walletName,
      walletAddress: reference.walletAddress,
      trades: (reference.trades || []).slice(0, 500),
      positions: (reference.positions || []).slice(0, 100),
    };
    fs.writeFileSync(REFERENCE_STATE_PATH, JSON.stringify(payload, null, 2));
  } catch {
    // Persistence failure should not stop live paper scans.
  }
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendNotFound(response) {
  sendJson(response, 404, { error: "Not found" });
}

function parseTimeMs(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function projectRealtimeStateSnapshot(baseState = state, now = Date.now()) {
  const prediction = baseState.prediction ? { ...baseState.prediction } : null;
  if (prediction) {
    const windowStartMs = parseTimeMs(prediction.windowStart);
    const windowEndMs = parseTimeMs(prediction.windowEnd);
    const predictionUpdatedMs = parseTimeMs(prediction.updatedAt);

    if (windowEndMs !== null) {
      prediction.timeLeftSec = Math.max(0, Math.round((windowEndMs - now) / 1_000));
    }

    if (windowStartMs !== null) {
      prediction.secondsIntoWindow = Math.max(0, Math.round((now - windowStartMs) / 1_000));
    }

    if (predictionUpdatedMs !== null) {
      prediction.bookAgeMs = Math.max(
        0,
        Math.round(toNumber(prediction.bookAgeMs, 0) + Math.max(0, now - predictionUpdatedMs)),
      );
    }
  }

  const reference = baseState.reference ? { ...baseState.reference } : null;
  if (reference?.stats) {
    const latestTradeMs = parseTimeMs(reference.stats.latestTradeAt);
    reference.stats = {
      ...reference.stats,
      latestAgeSec: latestTradeMs === null ? reference.stats.latestAgeSec : Math.max(0, Math.round((now - latestTradeMs) / 1_000)),
    };
  }

  return {
    ...baseState,
    prediction,
    reference,
    realtimeAt: new Date(now).toISOString(),
  };
}

function classifySettlementSource(signal = {}) {
  const source = String(signal.settlementSource || "").toLowerCase();
  if (signal.status === "paper_open") return "pending_window";
  if (signal.officialSettlementUsed || source.includes("official_poly") || source.includes("polymarket_gamma") || source.includes("polymarket_web")) {
    return source.includes("reconciled") || signal.reconciledAt ? "official_poly_reconciled" : "official_poly";
  }
  if (source.includes("pending") && source.includes("official")) return "pending_official";
  if (source.includes("proxy") || source.includes("binance")) return "proxy_pending_official";
  if (source.includes("manual")) return "manual_mark";
  return source || "unknown";
}

function settlementDisplayLabel(signal = {}) {
  const type = classifySettlementSource(signal);
  if (type === "official_poly") return "Official Poly";
  if (type === "official_poly_reconciled") return "Official Poly reconciled";
  if (type === "proxy_pending_official") return "Proxy / waiting official";
  if (type === "pending_official") return "Pending official";
  if (type === "pending_window") return "Pending window close";
  if (type === "manual_mark") return "Manual mark";
  return type.replaceAll("_", " ");
}

function compactSignal(signal = {}, prediction = null) {
  return {
    id: getSignalUiId(signal),
    status: signal.status,
    strategyVersion: signal.strategyVersion,
    strategy: signal.strategy || signal.entryStrategy || "unknown",
    entryStrategy: signal.entryStrategy || signal.strategy || "unknown",
    sourceType: signal.sourceType,
    time: signal.time,
    settledAt: signal.settledAt || null,
    slug: signal.slug,
    title: signal.title,
    marketUrl: signal.marketUrl || (signal.slug ? `${POLYMARKET_WEB}/event/${signal.slug}` : ""),
    symbol: signal.symbol || detectCryptoSymbol(`${signal.title || ""} ${signal.slug || ""}`),
    timeframe: signal.timeframe || detectMarketTimeframe(`${signal.title || ""} ${signal.slug || ""}`),
    direction: signal.direction,
    rank: signal.rank,
    calibratedLane: signal.calibratedLane || null,
    entryLane: signal.entryLane || null,
    calibratedWinProbability: signal.calibratedWinProbability ?? null,
    calibratedNetEdge: signal.calibratedNetEdge ?? signal.calibratedNetEv?.netEdge ?? null,
    fastGrowEvPolicy: signal.fastGrowEvPolicy || null,
    fastGrowSizing: signal.fastGrowSizing || null,
    fillReconciliation: signal.fillReconciliation || null,
    antiPlateauCompounding: signal.antiPlateauCompounding || null,
    buyPrice: signal.buyPrice,
    bidPrice: signal.bidPrice,
    finalPrice: signal.finalPrice,
    priceToBeat: signal.priceToBeat,
    currentPrice: signal.currentPrice,
    confidence: signal.confidence,
    selectedProbability: signal.selectedProbability,
    feeAdjustedEdge: signal.feeAdjustedEdge,
    selectedEdgePercent: signal.selectedEdgePercent,
    selectedSpreadCents: signal.selectedSpreadCents,
    selectedDepthPressure: signal.selectedDepthPressure,
    sideDepthAdvantage: signal.sideDepthAdvantage,
    selectedMicropriceEdgeCents: signal.selectedMicropriceEdgeCents,
    secondsIntoWindow: signal.secondsIntoWindow,
    depthShares: signal.depthShares,
    paperStakeUsd: signal.paperStakeUsd,
    paperShares: signal.paperShares,
    potentialProfitUsd: signal.potentialProfitUsd,
    paperPnlUsd: signal.paperPnlUsd,
    markPnlUsd: estimatePaperSignalPnl(signal, prediction),
    windowStart: signal.windowStart,
    windowEnd: signal.windowEnd,
    bookSource: signal.bookSource,
    settlementSource: signal.settlementSource,
    settlementSourceDetail: signal.settlementSourceDetail || null,
    settlementFinality: signal.settlementFinality || classifySettlementSource(signal),
    settlementLabel: signal.settlementLabel || settlementDisplayLabel(signal),
    officialSettlementUsed: Boolean(signal.officialSettlementUsed),
    officialOutcome: signal.officialOutcome || null,
    settlementPendingSince: signal.settlementPendingSince || null,
    settlementRetryCount: toNumber(signal.settlementRetryCount, 0),
    reconciledAt: signal.reconciledAt || null,
    replayOptimizerMatchedRules: signal.replayOptimizerMatchedRules || [],
    runtimeRuleReason: signal.runtimeRuleReason || "runtime_rule_cache_neutral",
    runtimeStakeMultiplier: signal.runtimeStakeMultiplier ?? 1,
    softQualityStakeMultiplier: signal.softQualityStakeMultiplier ?? 1,
    exposureGovernorReason: signal.exposureGovernorReason || "",
    exposureStakeMultiplier: signal.exposureStakeMultiplier ?? 1,
    exposureOpenUsd: signal.exposureOpenUsd || 0,
    exposureLimitUsd: signal.exposureLimitUsd || 0,
    selectedCandidateReasons: signal.selectedCandidateReasons || [],
  };
}

function getSignalUiId(signal = {}) {
  return [
    signal.id || signal.slug || "signal",
    signal.strategy || signal.entryStrategy || "strategy",
    signal.direction || signal.side || "side",
    signal.time || signal.settledAt || "",
  ].filter(Boolean).join(":");
}

function estimatePaperSignalPnl(signal = {}, prediction = null) {
  if (signal.status === "paper_win" || signal.status === "paper_loss") return toNumber(signal.paperPnlUsd, 0);
  if (signal.status !== "paper_open" || !prediction || signal.slug !== prediction.slug) return 0;
  const side = String(signal.direction || "").toUpperCase();
  const bid = side === "UP" ? toNumber(prediction.upBidPrice, 0) : side === "DOWN" ? toNumber(prediction.downBidPrice, 0) : 0;
  if (bid <= 0) return 0;
  return toNumber(signal.paperShares, 0) * bid - toNumber(signal.paperStakeUsd, 0);
}

function compactCandidate(candidate = {}) {
  return {
    strategy: candidate.strategy,
    side: candidate.side,
    rank: candidate.rank,
    approved: Boolean(candidate.approved),
    confidence: candidate.confidence,
    probability: candidate.probability,
    entryPrice: candidate.entryPrice,
    bidPrice: candidate.bidPrice,
    feeAdjustedEdge: candidate.feeAdjustedEdge,
    spreadCents: candidate.spreadCents,
    depthShares: candidate.depthShares,
    depthPressure: candidate.depthPressure,
    depthAdvantage: candidate.depthAdvantage,
    micropriceEdgeCents: candidate.micropriceEdgeCents,
    score: candidate.score,
    replayBlockReason: candidate.replayBlockReason,
    qualityBlockReason: candidate.qualityBlockReason,
    strategyBlockReason: candidate.strategyBlockReason,
    blockedReason: candidate.blockedReason,
    blockedAt: candidate.blockedAt,
    replayOptimizer: {
      approved: candidate.replayOptimizer?.approved,
      reason: candidate.replayOptimizer?.reason,
      matchedRules: (candidate.replayOptimizer?.matchedRules || []).slice(0, 6).map((rule) => ({
        id: rule.id,
        action: rule.action,
        reason: rule.reason,
      })),
    },
    reasons: candidate.reasons || [],
    symbol: candidate.symbol || candidate.marketSymbol || null,
    recentLossPenalty: candidate.recentLossPenalty || 0,
    recentLossReasons: candidate.recentLossReasons || [],
    noDowngradeRerankReasons: candidate.noDowngradeRerankReasons || [],
    uqie: candidate.uqie || null,
  };
}

function compactMarketCandidate(market = {}) {
  return {
    symbol: market.symbol,
    timeframe: market.timeframe,
    marketFamily: market.marketFamily,
    scannerLane: market.scannerLane,
    strategy: market.strategy,
    status: market.status,
    reason: market.reason,
    opportunityScore: market.opportunityScore,
    v337PriorityScore: market.v337PriorityScore,
    v337PriorityReasons: market.v337PriorityReasons,
    question: market.question,
    slug: market.slug,
    conditionId: market.conditionId || market.marketId || null,
    yesAsk: market.yesAsk,
    noAsk: market.noAsk,
    combinedAsk: market.combinedAsk,
    edgePercent: market.edgePercent,
    edgeCents: market.edgeCents,
    depthShares: market.depthShares,
    executableShares: market.executableShares,
    volume: market.volume,
    liquidity: market.liquidity,
    bookAgeMs: market.bookAgeMs,
    bookSource: market.bookSource,
  };
}

function loadAgentAdvice(now = Date.now()) {
  if (agentAdviceCache.expiresAt > now && agentAdviceCache.data) return agentAdviceCache.data;
  try {
    if (!fs.existsSync(AGENT_ADVICE_PATH)) {
      const waiting = createEmptyAgentAdvice({ status: "waiting", source: { apiBase: "", dataMode: REAL_MARKET_DATA_ONLY ? "real-only" : "mixed" } });
      agentAdviceCache = { expiresAt: now + AGENT_ADVICE_CACHE_TTL_MS, data: waiting };
      return waiting;
    }
    const parsed = JSON.parse(fs.readFileSync(AGENT_ADVICE_PATH, "utf8"));
    const advice = createEmptyAgentAdvice({
      ...parsed,
      recommendations: (parsed.recommendations || []).slice(0, 8).map((item) => ({
        id: item.id,
        priority: item.priority,
        title: item.title,
        reason: item.reason,
        action: item.action,
        evidence: item.evidence || {},
        autoApply: Boolean(item.autoApply),
      })),
      performance: {
        settled: parsed.performance?.settled || {},
        byStrategy: (parsed.performance?.byStrategy || []).slice(0, 8),
      },
    });
    agentAdviceCache = { expiresAt: now + AGENT_ADVICE_CACHE_TTL_MS, data: advice };
    return advice;
  } catch (error) {
    const failed = createEmptyAgentAdvice({
      status: "error",
      updatedAt: new Date(now).toISOString(),
      error: error instanceof Error ? error.message : "agent_advice_load_failed",
    });
    agentAdviceCache = { expiresAt: now + AGENT_ADVICE_CACHE_TTL_MS, data: failed };
    return failed;
  }
}

function projectUiStateSnapshot(baseState = state, now = Date.now()) {
  const snapshot = projectRealtimeStateSnapshot(baseState, now);
  const prediction = snapshot.prediction || {};
  const resetTime = paperSessionState?.resetAt ? Date.parse(paperSessionState.resetAt) : 0;
  const rawSignals = uniqueOfficialFinalSignals(Array.isArray(prediction.signals) ? prediction.signals : [])
    .filter(s => {
      const t = Date.parse(s.time || s.windowEnd || 0);
      return t >= resetTime;
    });
  const approvedSignals = rawSignals.filter(isPrimaryPaperSignal);
  const openSignals = approvedSignals.filter((signal) => signal.status === "paper_open").map((signal) => compactSignal(signal, prediction));
  const recentSignals = approvedSignals
    .filter((signal) => signal.status !== "paper_open")
    .slice(0, 80)
    .map((signal) => compactSignal(signal, prediction));

  const shadowSignals = rawSignals.filter((signal) => !isPrimaryPaperSignal(signal));
  const shadowOpenSignals = shadowSignals.filter((signal) => signal.status === "paper_open").map((signal) => compactSignal(signal, prediction));
  const shadowRecentSignals = shadowSignals
    .filter((signal) => signal.status !== "paper_open")
    .slice(0, 80)
    .map((signal) => compactSignal(signal, prediction));
  const antiPlateau = buildAntiPlateauTelemetry(approvedSignals, now);

  return {
    mode: snapshot.mode,
    releaseVersion: V356_RELEASE_VERSION,
    paperSessionId: paperSessionState?.id || null,
    paperSessionHold: Boolean(paperSessionState?.hold),
    v356NoDowngradeAudit: buildV356NoDowngradeAudit(snapshot),
    status: snapshot.status,
    blocked: snapshot.blocked,
    realtimeAt: snapshot.realtimeAt,
    updatedAt: snapshot.updatedAt,
    source: snapshot.source,
    config: snapshot.config,
    metrics: snapshot.metrics,
    antiPlateau,
    execution: snapshot.execution,
    risk: snapshot.risk,
    gateProtocol: snapshot.gateProtocol,
    strategyRouter: {
      ...(snapshot.strategyRouter || createEmptyStrategyRouter()),
      candidates: (snapshot.strategyRouter?.candidates || []).slice(0, 12).map(compactCandidate),
    },
    scanner: {
      ...(snapshot.scanner || createEmptyScanner()),
      topCandidates: (snapshot.scanner?.topCandidates || []).slice(0, CRYPTO_SCANNER_MAX_TRADE_CANDIDATES).map(compactMarketCandidate),
    },
    agentAdvice: loadAgentAdvice(now),
    marketRows: (snapshot.marketRows || []).slice(0, 30).map(compactMarketCandidate),
    rejectionSummary: (snapshot.rejectionSummary || []).slice(0, 10),
    categorySummary: (snapshot.categorySummary || []).slice(0, 8),
    rejects: (snapshot.rejects || []).slice(0, 18).map((reject) => ({
      time: reject.time,
      reason: reject.reason,
      question: reject.question,
      symbol: reject.symbol,
      timeframe: reject.timeframe,
      marketFamily: reject.marketFamily,
      edgePercent: reject.edgePercent,
      bookSource: reject.bookSource,
      bookAgeMs: reject.bookAgeMs,
    })),
    prediction: {
      status: prediction.status,
      title: prediction.title,
      slug: prediction.slug,
      symbol: prediction.symbol,
      timeframe: prediction.timeframe,
      marketFamily: prediction.marketFamily,
      predictionEngine: prediction.predictionEngine,
      scannerScore: prediction.scannerScore,
      scannerEdgePercent: prediction.scannerEdgePercent,
      marketUrl: prediction.marketUrl,
      windowStart: prediction.windowStart,
      windowEnd: prediction.windowEnd,
      timeLeftSec: prediction.timeLeftSec,
      secondsIntoWindow: prediction.secondsIntoWindow,
      priceToBeat: prediction.priceToBeat,
      currentPrice: prediction.currentPrice,
      priceDelta: prediction.priceDelta,
      predictedOutcome: prediction.predictedOutcome,
      selectedStrategy: prediction.selectedStrategy,
      strategy: prediction.strategy,
      confidence: prediction.confidence,
      rank: prediction.rank,
      selectedBuyPrice: prediction.selectedBuyPrice,
      selectedBidPrice: prediction.selectedBidPrice,
      selectedEdgePercent: prediction.selectedEdgePercent,
      selectedSpreadCents: prediction.selectedSpreadCents,
      selectedProbability: prediction.selectedProbability,
      feeAdjustedEdge: prediction.feeAdjustedEdge,
      yesNoAskCost: prediction.yesNoAskCost,
      upBuyPrice: prediction.upBuyPrice,
      downBuyPrice: prediction.downBuyPrice,
      upBidPrice: prediction.upBidPrice,
      downBidPrice: prediction.downBidPrice,
      bookSource: prediction.bookSource,
      bookAgeMs: prediction.bookAgeMs,
      reason: prediction.reason,
      riskReason: prediction.riskReason,
      tradeable: prediction.tradeable,
      recommendedStakeUsd: prediction.recommendedStakeUsd,
      rawRecommendedStakeUsd: prediction.rawRecommendedStakeUsd,
      paperMaxTradeUsd: prediction.paperMaxTradeUsd,
      dynamicMaxTradeUsd: prediction.dynamicMaxTradeUsd,
      accountEquity: prediction.accountEquity,
      equityStakeScale: prediction.equityStakeScale,
      equityScaledLaneCapUsd: prediction.equityScaledLaneCapUsd,
      stakeCapUsd: prediction.stakeCapUsd,
      stakeCapReasons: prediction.stakeCapReasons,
      calibratedLane: prediction.calibratedLane,
      calibratedWinProbability: prediction.calibratedWinProbability ?? null,
      calibratedNetEdge: prediction.preliminaryCalibratedNetEv?.netEdge ?? null,
      fastGrowEvPolicy: prediction.fastGrowEvPolicy || null,
      fastGrowSizing: prediction.fastGrowSizing || null,
      antiPlateauCompounding: prediction.antiPlateauCompounding || null,
      profitLockMode: prediction.profitLockMode,
      candidateCount: prediction.candidateCount,
      approvedCandidateCount: prediction.approvedCandidateCount,
      stats: prediction.stats,
      openSignals,
      recentSignals,
      signals: [...openSignals, ...recentSignals],
      shadowOpenSignals,
      shadowRecentSignals,
      lastSignal: prediction.lastSignal ? compactSignal(prediction.lastSignal, prediction) : null,
    },
    learning: {
      ...(snapshot.learning || createEmptyLearning()),
      strategies: (snapshot.learning?.strategies || []).slice(0, 8),
      recommendations: (snapshot.learning?.recommendations || []).slice(0, 6),
    },
    reference: snapshot.reference ? {
      status: snapshot.reference.status,
      walletName: snapshot.reference.walletName,
      stats: snapshot.reference.stats,
      agreement: snapshot.reference.agreement,
      updatedAt: snapshot.reference.updatedAt,
      lastError: snapshot.reference.lastError,
    } : null,
  };
}

function broadcast() {
  const fullPayload = subscribers.size ? `data: ${JSON.stringify(projectRealtimeStateSnapshot())}\n\n` : "";
  const uiPayload = uiSubscribers.size ? `data: ${JSON.stringify(projectUiStateSnapshot())}\n\n` : "";

  for (const response of subscribers) {
    response.write(fullPayload);
  }
  for (const response of uiSubscribers) {
    response.write(uiPayload);
  }
}

function sse(response, { compact = false } = {}) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  response.write(`data: ${JSON.stringify(compact ? projectUiStateSnapshot() : projectRealtimeStateSnapshot())}\n\n`);
  const targetSubscribers = compact ? uiSubscribers : subscribers;
  targetSubscribers.add(response);
  response.on("close", () => targetSubscribers.delete(response));
}

function requestText(url, { useDohLookup = USE_DOH, timeoutMs = HTTP_REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "http:" ? http : https;
    const requestStartedAt = Date.now();
    let connectMs = 0;
    let tlsMs = 0;
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: "GET",
        agent: target.protocol === "http:" ? httpAgent : httpsAgent,
        headers: {
          accept: "application/json",
          "accept-encoding": "identity",
          "user-agent": "trade-paper-bot/1.0",
        },
        lookup: useDohLookup ? dohLookup : undefined,
        timeout: Math.max(100, timeoutMs),
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          const totalMs = Date.now() - requestStartedAt;
          pushLatencySample("httpConnectMs", connectMs || totalMs);
          if (target.protocol === "https:") pushLatencySample("httpTlsMs", tlsMs || totalMs);
          pushLatencySample("httpTotalMs", totalMs);
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            contentType: response.headers["content-type"] || "",
            text,
            timings: { connectMs: connectMs || totalMs, tlsMs: tlsMs || 0, totalMs },
          });
        });
      },
    );

    request.on("socket", (socket) => {
      if (socket.connecting) {
        socket.once("connect", () => {
          connectMs = Date.now() - requestStartedAt;
        });
        socket.once("secureConnect", () => {
          tlsMs = Date.now() - requestStartedAt;
        });
      } else {
        connectMs = 0;
        tlsMs = 0;
      }
    });
    request.on("timeout", () => {
      request.destroy(Object.assign(new Error("Request timeout"), { code: "ETIMEDOUT" }));
    });
    request.on("error", reject);
    request.end();
  });
}

function requestDohJson(hostname) {
  const path = `/dns-query?name=${encodeURIComponent(hostname)}&type=A`;

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: DOH_IP,
        servername: DOH_HOST,
        path,
        method: "GET",
        headers: {
          accept: "application/dns-json",
          host: DOH_HOST,
          "user-agent": "trade-paper-bot/1.0",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(Object.assign(new Error(`DoH HTTP ${response.statusCode}`), { code: "DOH_HTTP" }));
            return;
          }

          try {
            resolve(JSON.parse(text));
          } catch (cause) {
            reject(Object.assign(new Error("Invalid DoH JSON"), { code: "DOH_JSON", cause }));
          }
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(Object.assign(new Error("DoH timeout"), { code: "DOH_TIMEOUT" }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function resolveDoh(hostname) {
  const cached = dnsCache.get(hostname);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.address;

  const payload = await requestDohJson(hostname);
  const answer = Array.isArray(payload.Answer)
    ? payload.Answer.find((entry) => entry.type === 1 && typeof entry.data === "string")
    : null;

  if (!answer) {
    throw Object.assign(new Error(`DoH returned no A record for ${hostname}`), { code: "DOH_NO_RECORD" });
  }

  dnsCache.set(hostname, {
    address: answer.data,
    expiresAt: now + Math.max(10, Number(answer.TTL || 60)) * 1_000,
  });

  return answer.data;
}

function dohLookup(hostname, options, callback) {
  if (!USE_DOH || hostname === DOH_HOST || hostname === DOH_IP) {
    dns.lookup(hostname, options, callback);
    return;
  }

  resolveDoh(hostname)
    .then((address) => {
      if (options?.all) {
        callback(null, [{ address, family: 4 }]);
        return;
      }
      callback(null, address, 4);
    })
    .catch(() => dns.lookup(hostname, options, callback));
}

async function fetchText(url, options = {}) {
  try {
    return await requestText(url, options);
  } catch (cause) {
    const error = new Error(cause instanceof Error ? cause.message : "fetch failed");
    error.code = cause?.cause?.code || cause?.code || "FETCH_FAILED";
    error.cause = cause;
    throw error;
  }
}

async function fetchJson(url, options = {}) {
  const result = await fetchText(url, options);
  const trimmed = result.text.trim();

  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || trimmed.includes("<title>Internet Baik</title>")) {
    const error = new Error("Network returned HTML/captive portal instead of Polymarket JSON");
    error.code = "CAPTIVE_PORTAL";
    error.status = result.status;
    error.sample = trimmed.slice(0, 140);
    throw error;
  }

  if (!result.ok) {
    const error = new Error(`HTTP ${result.status}`);
    error.status = result.status;
    error.sample = trimmed.slice(0, 240);
    throw error;
  }

  try {
    return JSON.parse(trimmed);
  } catch (cause) {
    const error = new Error("Invalid JSON from Polymarket API");
    error.cause = cause;
    error.sample = trimmed.slice(0, 240);
    throw error;
  }
}

function parseArrayField(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isFallbackPrediction(prediction = {}) {
  const text = `${prediction.bookSource || ""} ${prediction.title || ""} ${prediction.sourceType || ""}`.toLowerCase();
  return Boolean(prediction.synthetic) || text.includes("synthetic") || text.includes("learning fallback") || text.includes("fallback");
}

function hasLiveBookSource(bookSource = "") {
  const source = String(bookSource || "").toLowerCase();
  if (!source) return false;
  if (source.includes("synthetic") || source.includes("none") || source.includes("pending") || source.includes("unknown")) return false;
  return source.includes("rest") || source.includes("ws") || source.includes("live");
}

function canUsePredictionForEntry(prediction = {}) {
  if (!REAL_MARKET_DATA_ONLY) return true;
  return !isFallbackPrediction(prediction) && hasLiveBookSource(prediction.bookSource);
}

function getBestAsk(book) {
  const asks = Array.isArray(book?.asks) ? book.asks : [];
  return asks
    .map((level) => ({
      price: toNumber(level.price, Number.POSITIVE_INFINITY),
      size: toNumber(level.size, 0),
    }))
    .filter((level) => Number.isFinite(level.price) && level.price > 0 && level.size > 0)
    .sort((left, right) => left.price - right.price)[0] || null;
}

function getBestBid(book) {
  const bids = Array.isArray(book?.bids) ? book.bids : [];
  return bids
    .map((level) => ({
      price: toNumber(level.price, 0),
      size: toNumber(level.size, 0),
    }))
    .filter((level) => level.price > 0 && level.size > 0)
    .sort((left, right) => right.price - left.price)[0] || null;
}

function normalizeBookLevels(levels, side = "ask") {
  const sorted = (Array.isArray(levels) ? levels : [])
    .map((level) => ({
      price: toNumber(level.price, 0),
      size: toNumber(level.size, 0),
    }))
    .filter((level) => level.price > 0 && level.size > 0)
    .sort((left, right) => side === "bid" ? right.price - left.price : left.price - right.price);

  return sorted.slice(0, 80);
}

function sumLevelSize(levels) {
  return (levels || []).reduce((sum, level) => sum + toNumber(level.size, 0), 0);
}

function largestLevel(levels) {
  return (levels || []).reduce((best, level) => {
    if (!best || toNumber(level.size, 0) > toNumber(best.size, 0)) return level;
    return best;
  }, null);
}

function weightedPrice(levels) {
  const size = sumLevelSize(levels);
  if (size <= 0) return 0;
  return levels.reduce((sum, level) => sum + toNumber(level.price, 0) * toNumber(level.size, 0), 0) / size;
}

function getBookDepthDiagnostics(book) {
  const asks = normalizeBookLevels(book?.asks, "ask").slice(0, 5);
  const bids = normalizeBookLevels(book?.bids, "bid").slice(0, 5);
  const bestAsk = asks[0] || null;
  const bestBid = bids[0] || null;
  const askDepth5 = sumLevelSize(asks);
  const bidDepth5 = sumLevelSize(bids);
  const totalDepth5 = Math.max(1e-9, askDepth5 + bidDepth5);
  const askWall = largestLevel(asks);
  const bidWall = largestLevel(bids);
  const bestAskPrice = toNumber(bestAsk?.price, 0);
  const bestBidPrice = toNumber(bestBid?.price, 0);
  const midPrice = bestAskPrice > 0 && bestBidPrice > 0 ? (bestAskPrice + bestBidPrice) / 2 : 0;
  const microprice = bestAskPrice > 0 && bestBidPrice > 0
    ? ((bestAskPrice * bidDepth5) + (bestBidPrice * askDepth5)) / totalDepth5
    : 0;
  return {
    askDepth5,
    bidDepth5,
    bidAskPressure: (bidDepth5 - askDepth5) / totalDepth5,
    askWeightedPrice5: weightedPrice(asks),
    bidWeightedPrice5: weightedPrice(bids),
    askSlopeCents: asks.length >= 2 ? Math.max(0, (toNumber(asks.at(-1)?.price, 0) - bestAskPrice) * 100) : 0,
    bidSlopeCents: bids.length >= 2 ? Math.max(0, (bestBidPrice - toNumber(bids.at(-1)?.price, 0)) * 100) : 0,
    askWallPrice: toNumber(askWall?.price, 0),
    askWallSize: toNumber(askWall?.size, 0),
    bidWallPrice: toNumber(bidWall?.price, 0),
    bidWallSize: toNumber(bidWall?.size, 0),
    microprice,
    micropriceEdgeCents: midPrice > 0 ? (microprice - midPrice) * 100 : 0,
    levels: Math.max(asks.length, bids.length),
  };
}

function normalizeBook(rawBook, tokenId, source, receivedAt = Date.now(), current = null) {
  return buildBookSnapshot(rawBook, { tokenId, source, receivedAt, current });
}

function cacheBook(tokenId, rawBook, source) {
  const current = orderBookCache.get(String(tokenId));
  const normalized = normalizeBook(rawBook, tokenId, source, Date.now(), current);
  if (!normalized.tokenId) return null;
  orderBookCache.set(normalized.tokenId, normalized);
  return isBookUsable(normalized) ? normalized : null;
}

function updateCachedTickSize(tokenId, tickSize, source = "ws") {
  const id = String(tokenId || "");
  const numericTick = toNumber(tickSize, 0);
  if (!id || numericTick <= 0) return;
  const current = orderBookCache.get(id);
  if (!current) return;
  orderBookCache.set(id, {
    ...updateBookTickSize(current, tickSize, { receivedAt: Date.now() }),
    source,
  });
}

function getCachedBook(tokenId, { maxAgeMs = ORDERBOOK_CACHE_TTL_MS } = {}) {
  const cached = orderBookCache.get(String(tokenId));
  if (!isBookUsable(cached)) return null;

  const ageMs = Date.now() - cached.receivedAt;
  if (ageMs > maxAgeMs) return null;

  return {
    book: cached,
    source: cached.source,
    ageMs,
    fetchMs: 0,
    cacheHit: true,
  };
}

function getCachedBookAnyAge(tokenId) {
  const cached = orderBookCache.get(String(tokenId));
  if (!isBookUsable(cached)) return null;
  const ageMs = Date.now() - cached.receivedAt;
  return {
    book: cached,
    source: cached.source,
    ageMs,
    fetchMs: 0,
    cacheHit: true,
    staleCache: ageMs > ENTRY_MAX_BOOK_AGE_MS,
  };
}

function scheduleAsyncEntryBookRefresh(tokenId, reason = "entry_async_revalidate") {
  if (!ENTRY_REVALIDATE_ASYNC_AFTER_SIGNAL) return;
  const id = String(tokenId || "");
  if (!id || entryAsyncRefreshInFlight.has(id)) return;
  const cached = orderBookCache.get(id);
  const ageMs = cached?.receivedAt ? Date.now() - cached.receivedAt : Infinity;
  if (ageMs < ENTRY_ASYNC_REFRESH_MIN_AGE_MS) return;

  entryAsyncRefreshInFlight.set(id, Date.now());
  latencyState.entryAsyncRefreshes = (latencyState.entryAsyncRefreshes || 0) + 1;
  fetchBookSnapshot(id, { forceRefresh: true, maxAgeMs: ENTRY_MAX_BOOK_AGE_MS, reason })
    .catch((error) => {
      latencyState.lastEntryAsyncRefreshError = error instanceof Error ? error.message : "entry_async_refresh_failed";
    })
    .finally(() => {
      entryAsyncRefreshInFlight.delete(id);
    });
}

function scheduleOrderBookIntegrityResync(tokenId, reason = "orderbook_integrity_resync") {
  const id = String(tokenId || "");
  if (!id || entryAsyncRefreshInFlight.has(id)) return;
  entryAsyncRefreshInFlight.set(id, Date.now());
  latencyState.entryAsyncRefreshes = (latencyState.entryAsyncRefreshes || 0) + 1;
  fetchBookSnapshot(id, { forceRefresh: true, maxAgeMs: 0, reason })
    .catch((error) => {
      latencyState.lastEntryAsyncRefreshError = error instanceof Error ? error.message : "orderbook_integrity_resync_failed";
    })
    .finally(() => entryAsyncRefreshInFlight.delete(id));
}

function costToBuyShares(asks, shares) {
  let remaining = shares;
  let cost = 0;
  let levelsUsed = 0;
  let worstPrice = 0;

  for (const level of asks) {
    if (remaining <= 1e-9) break;
    const filled = Math.min(remaining, level.size);
    cost += filled * level.price;
    remaining -= filled;
    levelsUsed += 1;
    worstPrice = level.price;
  }

  if (remaining > 1e-7) {
    return {
      filled: shares - remaining,
      cost,
      avgPrice: 0,
      worstPrice,
      levelsUsed,
      complete: false,
    };
  }

  return {
    filled: shares,
    cost,
    avgPrice: shares > 0 ? cost / shares : 0,
    worstPrice,
    levelsUsed,
    complete: true,
  };
}

function totalAskDepth(asks) {
  return asks.reduce((total, level) => total + level.size, 0);
}

function calculateDepthFill(yesBook, noBook) {
  const yesAsks = normalizeBookLevels(yesBook?.asks, "ask");
  const noAsks = normalizeBookLevels(noBook?.asks, "ask");
  const yesBest = yesAsks[0] || null;
  const noBest = noAsks[0] || null;
  if (!yesBest || !noBest) {
    return {
      fillable: false,
      reason: "missing_best_ask",
      yesAsk: yesBest,
      noAsk: noBest,
      combinedAsk: 0,
      executableShares: 0,
      costUsd: 0,
      theoreticalProfitUsd: 0,
      slippageCents: 0,
      levelsUsed: 0,
    };
  }

  const bestCombinedAsk = yesBest.price + noBest.price;
  const maxDepthShares = Math.min(totalAskDepth(yesAsks), totalAskDepth(noAsks));
  const budgetUpper = bestCombinedAsk > 0 ? PAPER_MAX_TRADE_USD / bestCombinedAsk : 0;
  const upper = Math.min(maxDepthShares, budgetUpper);
  if (upper <= 0) {
    return {
      fillable: false,
      reason: "insufficient_depth",
      yesAsk: yesBest,
      noAsk: noBest,
      combinedAsk: bestCombinedAsk,
      executableShares: 0,
      costUsd: 0,
      theoreticalProfitUsd: 0,
      slippageCents: 0,
      levelsUsed: 0,
    };
  }

  let low = 0;
  let high = upper;
  let best = null;
  for (let index = 0; index < 28; index += 1) {
    const shares = (low + high) / 2;
    const yesFill = costToBuyShares(yesAsks, shares);
    const noFill = costToBuyShares(noAsks, shares);
    const costUsd = yesFill.cost + noFill.cost;
    const combinedAsk = shares > 0 ? costUsd / shares : 0;
    const edgeCents = 1 - combinedAsk;

    if (
      yesFill.complete &&
      noFill.complete &&
      costUsd <= PAPER_MAX_TRADE_USD &&
      edgeCents >= MIN_EDGE_CENTS
    ) {
      best = {
        yesFill,
        noFill,
        shares,
        costUsd,
        combinedAsk,
        edgeCents,
      };
      low = shares;
    } else {
      high = shares;
    }
  }

  if (!best || best.shares <= 0) {
    return {
      fillable: false,
      reason: "edge_below_threshold_after_depth",
      yesAsk: yesBest,
      noAsk: noBest,
      combinedAsk: bestCombinedAsk,
      executableShares: 0,
      costUsd: 0,
      theoreticalProfitUsd: 0,
      slippageCents: 0,
      levelsUsed: 0,
    };
  }

  const slippageCents = Math.max(0, best.combinedAsk - bestCombinedAsk);
  return {
    fillable: true,
    reason: "depth_fok_passed",
    yesAsk: yesBest,
    noAsk: noBest,
    bestCombinedAsk,
    combinedAsk: best.combinedAsk,
    edgeCents: best.edgeCents,
    edgePercent: best.combinedAsk > 0 ? (best.edgeCents / best.combinedAsk) * 100 : 0,
    depthShares: Math.min(yesBest.size, noBest.size),
    executableShares: best.shares,
    costUsd: best.costUsd,
    theoreticalProfitUsd: best.shares - best.costUsd,
    yesAvgPrice: best.yesFill.avgPrice,
    noAvgPrice: best.noFill.avgPrice,
    yesWorstPrice: best.yesFill.worstPrice,
    noWorstPrice: best.noFill.worstPrice,
    slippageCents,
    levelsUsed: best.yesFill.levelsUsed + best.noFill.levelsUsed,
  };
}

async function fetchBookSnapshot(tokenId, { forceRefresh = false, maxAgeMs = ORDERBOOK_CACHE_TTL_MS, reason = "scan" } = {}) {
  const queuedAt = Date.now();
  if (!forceRefresh) {
    const cached = getCachedBook(tokenId, { maxAgeMs });
    if (cached) return cached;
  }

  const startedAt = Date.now();
  pushLatencySample("orderbookQueueWaitMs", startedAt - queuedAt);
  const params = new URLSearchParams({ token_id: tokenId });
  const payload = await fetchJson(`${CLOB_API}/book?${params.toString()}`, { timeoutMs: HTTP_REQUEST_TIMEOUT_MS });
  const book = cacheBook(tokenId, payload, "rest") || normalizeBook(payload, tokenId, "rest", Date.now());
  return {
    book,
    source: "rest",
    ageMs: 0,
    fetchMs: Date.now() - startedAt,
    cacheHit: false,
    forceRefresh,
    reason,
  };
}

async function fetchEntryBookSnapshot(tokenId, { maxAgeMs = ENTRY_MAX_BOOK_AGE_MS } = {}) {
  // v353.3 speed-safe entry path:
  // - Do NOT pause order execution for a REST /book refresh by default.
  // - Use the latest WS/cache snapshot already maintained by the scanner.
  // - If stale, schedule a background revalidation for the next tick, then let
  //   the existing stale-book guard/reranker choose another candidate.
  const freshCached = getCachedBook(tokenId, { maxAgeMs });
  if (freshCached) return { ...freshCached, entryValidationMode: "fresh_ws_cache_no_block" };

  const cachedAnyAge = getCachedBookAnyAge(tokenId);
  if (cachedAnyAge && ENTRY_USE_CACHE_ONLY_BEFORE_OPEN) {
    scheduleAsyncEntryBookRefresh(tokenId, "entry_stale_cache_async_revalidate");
    return { ...cachedAnyAge, entryValidationMode: "stale_cache_no_block_async_revalidate" };
  }

  if (!ENTRY_REST_FALLBACK_BEFORE_OPEN || !ENTRY_REFRESH_BEFORE_OPEN) {
    scheduleAsyncEntryBookRefresh(tokenId, "entry_missing_cache_async_revalidate");
    return null;
  }

  latencyState.entryRefreshes += 1;
  try {
    const refreshPromise = fetchBookSnapshot(tokenId, { forceRefresh: true, maxAgeMs, reason: "entry_explicit_rest_fallback" });
    if (ENTRY_FORCE_REFRESH_MAX_WAIT_MS > 0) {
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), ENTRY_FORCE_REFRESH_MAX_WAIT_MS));
      const refreshed = await Promise.race([refreshPromise, timeoutPromise]);
      return refreshed ? { ...refreshed, refreshedForEntry: true, entryValidationMode: "explicit_rest_fallback_deadline" } : null;
    }
    const refreshed = await refreshPromise;
    return { ...refreshed, refreshedForEntry: true, entryValidationMode: "explicit_rest_fallback" };
  } catch (error) {
    latencyState.lastEntryRefreshError = error instanceof Error ? error.message : "entry_refresh_failed";
    return cachedAnyAge || null;
  }
}

async function fetchEntryBookPair(upTokenId, downTokenId) {
  const [upBookSnapshot, downBookSnapshot] = await Promise.all([
    fetchEntryBookSnapshot(upTokenId).catch(() => null),
    fetchEntryBookSnapshot(downTokenId).catch(() => null),
  ]);
  const entryAge = Math.max(toNumber(upBookSnapshot?.ageMs, 0), toNumber(downBookSnapshot?.ageMs, 0));
  pushLatencySample("entryBookAgeMs", entryAge);
  if (ENTRY_DROP_STALE_RESULT && entryAge > ENTRY_MAX_BOOK_AGE_MS) latencyState.staleEntryDrops += 1;
  return [upBookSnapshot, downBookSnapshot];
}

function aggregateBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item) || "unknown";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count);
}

function average(values) {
  const filtered = (values || []).filter((value) => Number.isFinite(Number(value)));
  return filtered.length ? filtered.reduce((total, value) => total + Number(value), 0) / filtered.length : 0;
}

function normalizeMarket(market) {
  const outcomes = parseArrayField(market.outcomes).length
    ? parseArrayField(market.outcomes)
    : [market.positiveOutcome, market.negativeOutcome].filter(Boolean);
  const tokenIds = parseArrayField(market.clobTokenIds ?? market.clob_token_ids ?? market.assets_ids).length
    ? parseArrayField(market.clobTokenIds ?? market.clob_token_ids ?? market.assets_ids)
    : [market.yesTokenId, market.noTokenId].filter(Boolean);

  if (outcomes.length !== 2 || tokenIds.length !== 2) return null;
  if (market.enableOrderBook === false || market.closed || market.active === false) return null;

  const yesIndex = outcomes.findIndex((outcome) => /^(yes|up|higher|above)$/i.test(String(outcome).trim()));
  const noIndex = outcomes.findIndex((outcome) => /^(no|down|lower|below)$/i.test(String(outcome).trim()));
  if (yesIndex < 0 || noIndex < 0) return null;
  const title = market.question || market.title || market.group_item_title || "Untitled market";
  const slug = market.slug || "";
  const marketText = `${title} ${slug} ${market.category || ""}`;

  return {
    id: String(market.id || market.conditionId || market.condition_id || market.questionID || market.slug),
    conditionId: market.conditionId || market.condition_id || "",
    question: title,
    slug,
    category: market.category || "Market",
    symbol: detectCryptoSymbol(marketText),
    timeframe: detectMarketTimeframe(marketText),
    marketFamily: detectMarketFamily(marketText),
    positiveOutcome: String(outcomes[yesIndex] || "Yes"),
    negativeOutcome: String(outcomes[noIndex] || "No"),
    volume: toNumber(market.volumeNum ?? market.volume, 0),
    liquidity: toNumber(market.liquidityNum ?? market.liquidity, 0),
    yesTokenId: String(tokenIds[yesIndex]),
    noTokenId: String(tokenIds[noIndex]),
    priceToBeat: declaredMarketPriceToBeat(market) || null,
    targetSource: declaredMarketPriceToBeat(market) > 0 ? "polymarket_market_event_metadata" : null,
    tickSize: toNumber(market.orderPriceMinTickSize ?? market.order_price_min_tick_size ?? market.minimum_tick_size, 0) || null,
    minOrderSize: toNumber(market.orderMinSize ?? market.order_min_size ?? market.min_order_size, 0) || null,
    takerFeeRate: toNumber(market.feeSchedule?.rate ?? market.fee_schedule?.rate ?? market.takerFeeRate, PAPER_CRYPTO_TAKER_FEE_RATE),
    eventMetadata: market.eventMetadata ?? market.event_metadata ?? null,
    endDate: market.endDateIso || market.endDate || null,
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildV337PriorityProfile(candidate = {}) {
  if (!V337_PRIORITY_ALLOCATOR_ENABLED) {
    return { enabled: false, score: 0, stakeMultiplier: 1, reasons: [] };
  }
  const symbol = String(candidate.symbol || "").toUpperCase();
  const side = sideKey(candidate.side || candidate.predictedOutcome || candidate.direction);
  const timeframe = String(candidate.timeframe || candidate.marketTimeframe || "").toUpperCase();
  const bookSource = String(candidate.bookSource || "").toLowerCase();
  const entryPrice = toNumber(candidate.entryPrice ?? candidate.selectedBuyPrice ?? candidate.buyPrice, 0);
  const secondsIntoWindow = toNumber(candidate.secondsIntoWindow, -1);
  const bookAgeMs = toNumber(candidate.bookAgeMs, 9999);
  const lane = String(candidate.calibratedLane || candidate.executionQuality?.calibratedLane || candidate.lane || "").toUpperCase();
  const reasons = [];
  let score = 0;
  let stakeMultiplier = 1;

  const symbolSideScore = {
    "ETH:DOWN": 26,
    "ETH:UP": 22,
    "DOGE:DOWN": 24,
    "DOGE:UP": 22,
    "BTC:UP": 20,
    "XRP:DOWN": 20,
    "XRP:UP": 18,
    "BTC:DOWN": 8,
    "SOL:DOWN": 6,
    "SOL:UP": -6,
    "BNB:DOWN": 6,
    "BNB:UP": -14,
  }[`${symbol}:${side}`] ?? ({
    ETH: 18,
    DOGE: 18,
    BTC: 14,
    XRP: 14,
    SOL: 0,
    BNB: -6,
  }[symbol] ?? 3);
  score += symbolSideScore;
  if (symbolSideScore >= 14) reasons.push("v331_symbol_side_positive");
  if (symbolSideScore < 0) reasons.push("v331_symbol_side_low_priority");

  if (timeframe === "5M") {
    score += 16;
    reasons.push("v331_5m_fast_gain_lane");
  } else if (timeframe === "15M") {
    score += side === "DOWN" ? 10 : 2;
    reasons.push(side === "DOWN" ? "v331_15m_down_positive" : "v331_15m_context_lane");
  } else if (["1H", "4H", "1D", "1W", "PREMARKET", "ETF"].includes(timeframe)) {
    score += 2;
  }

  if (bookSource === "ws+ws") {
    score += 18;
    stakeMultiplier += 0.18;
    reasons.push("fresh_ws_book_priority");
  } else if (bookSource.includes("ws")) {
    score += 8;
    stakeMultiplier += 0.08;
    reasons.push("partial_ws_book_priority");
  } else if (bookSource === "rest+rest") {
    score -= 8;
    stakeMultiplier *= 0.82;
    reasons.push("rest_book_lower_priority_not_blocked");
  }

  if (bookAgeMs <= 500) {
    score += 10;
    stakeMultiplier += 0.10;
    reasons.push("fresh_book_age");
  } else if (bookAgeMs <= 1000) {
    score += 4;
  } else if (bookAgeMs > 2000) {
    score -= 8;
    stakeMultiplier *= 0.85;
    reasons.push("stale_book_lower_priority");
  }

  if (entryPrice >= 0.50 && entryPrice < 0.60) {
    score += 14;
    stakeMultiplier += 0.12;
    reasons.push("v331_best_price_bucket_050_060");
  } else if (entryPrice >= 0.60 && entryPrice < 0.65) {
    score -= 2;
    stakeMultiplier *= 0.95;
    reasons.push("price_060_065_needs_edge");
  } else if (entryPrice >= 0.65) {
    score -= 10;
    stakeMultiplier *= 0.78;
    reasons.push("high_price_lower_priority_not_blocked");
  }

  const premiumWindow =
    (secondsIntoWindow >= 0 && secondsIntoWindow <= 15) ||
    (secondsIntoWindow >= 45 && secondsIntoWindow <= 75) ||
    (secondsIntoWindow >= 90 && secondsIntoWindow <= 135);
  if (premiumWindow) {
    score += 12;
    stakeMultiplier += 0.10;
    reasons.push("v331_high_roi_window");
  } else if (secondsIntoWindow > 135) {
    score -= 8;
    stakeMultiplier *= 0.85;
    reasons.push("late_window_lower_priority_not_blocked");
  } else if (secondsIntoWindow >= 15 && secondsIntoWindow < 45) {
    score -= 4;
    stakeMultiplier *= 0.92;
    reasons.push("v331_weak_15_45_window");
  }

  if (lane === "S") stakeMultiplier += 0.18;
  else if (lane === "A") stakeMultiplier += 0.10;
  else if (lane === "B" || lane === "PROBE") stakeMultiplier = Math.min(stakeMultiplier, 1.12);

  const normalizedScore = clamp(score, -40, 100);
  if (normalizedScore >= 45) stakeMultiplier += 0.12;
  else if (normalizedScore < 0) stakeMultiplier *= 0.82;

  return {
    enabled: true,
    score: normalizedScore,
    stakeMultiplier: clamp(stakeMultiplier, V337_MIN_STAKE_MULTIPLIER, V337_MAX_STAKE_MULTIPLIER),
    reasons,
  };
}

function getReferenceTradeKey(trade) {
  const hash = trade?.transactionHash || trade?.txHash || "";
  const asset = trade?.asset || trade?.tokenId || "";
  const timestamp = trade?.timestamp || trade?.time || "";
  const side = trade?.side || "";
  const outcome = trade?.outcome || "";
  const price = trade?.price || "";
  const size = trade?.size || "";
  return [hash, asset, timestamp, side, outcome, price, size].filter(Boolean).join(":");
}

function detectCryptoSymbol(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("bitcoin") || /\bbtc\b/.test(text)) return "BTC";
  if (text.includes("ethereum") || /\b(eth|ether)\b/.test(text)) return "ETH";
  if (text.includes("solana") || /\bsol\b/.test(text)) return "SOL";
  if (text.includes("ripple") || text.includes("xrp")) return "XRP";
  if (text.includes("dogecoin") || text.includes("doge")) return "DOGE";
  if (text.includes("binance") || /\bbnb\b/.test(text)) return "BNB";
  if (text.includes("microstrategy") || text.includes("strategy") || /\bmstr\b/.test(text)) return "MSTR";
  if (text.includes("cardano") || /\bada\b/.test(text)) return "ADA";
  if (text.includes("chainlink") || /\blink\b/.test(text)) return "LINK";
  if (text.includes("avalanche") || /\bavax\b/.test(text)) return "AVAX";
  if (text.includes("polkadot") || /\bdot\b/.test(text)) return "DOT";
  if (text.includes("litecoin") || /\bltc\b/.test(text)) return "LTC";
  if (text.includes("tron") || /\btrx\b/.test(text)) return "TRX";
  if (text.includes("toncoin") || /\bton\b/.test(text)) return "TON";
  if (text.includes("shiba") || /\bshib\b/.test(text)) return "SHIB";
  if (text.includes("pepe")) return "PEPE";
  if (text.includes("sui")) return "SUI";
  if (text.includes("aptos") || /\bapt\b/.test(text)) return "APT";
  if (text.includes("near")) return "NEAR";
  if (text.includes("arbitrum") || /\barb\b/.test(text)) return "ARB";
  if (text.includes("optimism") || /\bop\b/.test(text)) return "OP";
  if (text.includes("uniswap") || /\buni\b/.test(text)) return "UNI";
  if (text.includes("aave")) return "AAVE";
  if (text.includes("ondo")) return "ONDO";
  if (text.includes("worldcoin") || /\bwld\b/.test(text)) return "WLD";
  if (text.includes("sei")) return "SEI";
  return "OTHER";
}

function detectMarketFamily(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("pre-market") || text.includes("premarket")) return "PREMARKET";
  if (/\betf\b/.test(text)) return "ETF";
  if (/updown|up or down|higher or lower|above or below/.test(text)) return "DIRECTIONAL";
  return "EVENT";
}

function parseReferenceClockToken(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3].toUpperCase();
  if (hour === 12) hour = 0;
  if (meridiem === "PM") hour += 12;
  return hour * 60 + minute;
}

function detectReferenceTimeRange(value) {
  const text = String(value || "");
  const rangeMatch = text.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i);
  if (!rangeMatch) {
    return /\b\d{1,2}(?::00)?\s*(?:AM|PM)\s+ET\b/i.test(text) ? "1H" : "";
  }

  const start = parseReferenceClockToken(rangeMatch[1]);
  const end = parseReferenceClockToken(rangeMatch[2]);
  if (start === null || end === null) return "";

  const minutes = end > start ? end - start : end + 24 * 60 - start;
  if (minutes <= 6) return "5M";
  if (minutes <= 18) return "15M";
  if (minutes <= 70) return "1H";
  if (minutes >= 23 * 60) return "1D";
  return `${minutes}M`;
}

function detectReferenceTimeframe(value) {
  const text = String(value || "").toLowerCase();
  const rangeTimeframe = detectReferenceTimeRange(value);
  if (rangeTimeframe) return rangeTimeframe;
  if (text.includes("5m") || text.includes("5-min") || text.includes("5 min")) return "5M";
  if (text.includes("15m") || text.includes("15-min") || text.includes("15 min")) return "15M";
  if (text.includes("1h") || text.includes("1-hour") || text.includes("1 hour")) return "1H";
  if (text.includes("1d") || text.includes("1-day") || text.includes("1 day")) return "1D";
  return "UNK";
}

function detectMarketTimeframe(value) {
  const text = String(value || "").toLowerCase();
  const rangeTimeframe = detectReferenceTimeRange(value);
  if (rangeTimeframe) return rangeTimeframe;
  if (/pre[-\s]?market/.test(text)) return "PREMARKET";
  if (/\betf\b/.test(text)) return "ETF";
  if (/(\b5m\b|5[-\s]?min|5 minutes)/.test(text)) return "5M";
  if (/(\b15m\b|15[-\s]?min|15 minutes)/.test(text)) return "15M";
  if (/(\b1h\b|1[-\s]?hour|1 hour)/.test(text)) return "1H";
  if (/(\b4h\b|4[-\s]?hour|4 hours)/.test(text)) return "4H";
  if (/(\b1d\b|1[-\s]?day|1 day|every day|daily)/.test(text)) return "1D";
  if (/(\b1w\b|1[-\s]?week|weekly|week)/.test(text)) return "1W";
  if (/(\b1mo\b|monthly|per month|month)/.test(text)) return "1MO";
  if (/(\b1y\b|yearly|per year|each year|year)/.test(text)) return "1Y";
  return "UNK";
}

function toIsoFromUnixSeconds(value) {
  const timestamp = toNumber(value, 0);
  return timestamp > 0 ? new Date(timestamp * 1_000).toISOString() : new Date().toISOString();
}

function normalizeReferenceTrade(raw) {
  const title = raw?.title || raw?.marketTitle || raw?.question || "Unknown market";
  const slug = raw?.slug || raw?.eventSlug || "";
  const timestamp = toNumber(raw?.timestamp, 0);
  const price = toNumber(raw?.price, 0);
  const size = toNumber(raw?.size, 0);
  const usdcSize = toNumber(raw?.usdcSize ?? raw?.amount, price * size);
  const side = String(raw?.side || "").toUpperCase() || "TRADE";
  const outcome = raw?.outcome || (raw?.outcomeIndex === 0 ? "Up" : raw?.outcomeIndex === 1 ? "Down" : "Unknown");
  const symbol = detectCryptoSymbol(`${title} ${slug}`);
  const timeframe = detectReferenceTimeframe(`${title} ${slug}`);

  if (!timestamp || !price || !size || symbol === "OTHER") return null;

  return {
    key: getReferenceTradeKey(raw),
    transactionHash: raw?.transactionHash || "",
    time: toIsoFromUnixSeconds(timestamp),
    timestamp,
    side,
    symbol,
    timeframe,
    outcome,
    price,
    size,
    usdcSize,
    title,
    slug,
    eventSlug: raw?.eventSlug || slug,
    asset: raw?.asset || "",
    conditionId: raw?.conditionId || "",
    outcomeIndex: raw?.outcomeIndex ?? null,
  };
}

function normalizeReferencePosition(raw) {
  const title = raw?.title || "Unknown market";
  const slug = raw?.slug || raw?.eventSlug || "";
  return {
    asset: raw?.asset || "",
    conditionId: raw?.conditionId || "",
    symbol: detectCryptoSymbol(`${title} ${slug}`),
    timeframe: detectReferenceTimeframe(`${title} ${slug}`),
    outcome: raw?.outcome || "Unknown",
    title,
    slug,
    size: toNumber(raw?.size, 0),
    avgPrice: toNumber(raw?.avgPrice, 0),
    curPrice: toNumber(raw?.curPrice, 0),
    initialValue: toNumber(raw?.initialValue, 0),
    currentValue: toNumber(raw?.currentValue, 0),
    cashPnl: toNumber(raw?.cashPnl, 0),
    percentPnl: toNumber(raw?.percentPnl, 0),
  };
}

function aggregateReference(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item) || "UNK";
    const current = map.get(key) || { key, count: 0, volumeUsd: 0 };
    current.count += 1;
    current.volumeUsd += toNumber(item.usdcSize, 0);
    map.set(key, current);
  }
  return [...map.values()].sort((left, right) => right.count - left.count || right.volumeUsd - left.volumeUsd);
}

function summarizeReferenceStats(trades = [], positions = [], newTrades = 0) {
  const sortedTrades = [...trades].sort((left, right) => toNumber(right.timestamp, 0) - toNumber(left.timestamp, 0));
  const buyCount = sortedTrades.filter((trade) => trade.side === "BUY").length;
  const sellCount = sortedTrades.filter((trade) => trade.side === "SELL").length;
  const volumes = sortedTrades.map((trade) => toNumber(trade.usdcSize, 0)).filter((value) => value > 0).sort((a, b) => a - b);
  const totalSampleVolumeUsd = volumes.reduce((total, value) => total + value, 0);
  const prices = sortedTrades.map((trade) => toNumber(trade.price, 0)).filter((value) => value > 0);
  const latest = sortedTrades[0] || null;
  const latestAgeSec = latest ? Math.max(0, Math.floor((Date.now() - Date.parse(latest.time)) / 1_000)) : null;
  const assets = aggregateReference(sortedTrades, (trade) => trade.symbol);
  const timeframes = aggregateReference(sortedTrades, (trade) => trade.timeframe);
  const outcomes = aggregateReference(sortedTrades, (trade) => trade.outcome);
  const openPositions = positions.length;
  const positionValueUsd = positions.reduce((total, position) => total + toNumber(position.currentValue, 0), 0);
  const openPnlUsd = positions.reduce((total, position) => total + toNumber(position.cashPnl, 0), 0);

  return {
    tradesTracked: sortedTrades.length,
    newTrades,
    buyCount,
    sellCount,
    buyShare: sortedTrades.length ? (buyCount / sortedTrades.length) * 100 : 0,
    totalSampleVolumeUsd,
    avgTradeUsd: sortedTrades.length ? totalSampleVolumeUsd / sortedTrades.length : 0,
    medianTradeUsd: volumes.length ? volumes[Math.floor(volumes.length / 2)] : 0,
    avgPrice: prices.length ? prices.reduce((total, value) => total + value, 0) / prices.length : 0,
    latestTradeAt: latest?.time || null,
    latestAgeSec,
    active: latestAgeSec !== null && latestAgeSec * 1_000 <= REFERENCE_ACTIVE_WINDOW_MS,
    openPositions,
    positionValueUsd,
    openPnlUsd,
    topAsset: assets[0]?.key || "WAIT",
    topTimeframe: timeframes[0]?.key || "WAIT",
    assets: assets.slice(0, 8),
    timeframes: timeframes.slice(0, 6),
    outcomes: outcomes.slice(0, 6),
  };
}

function attachReferenceAgreement(reference, prediction) {
  const botOutcome = prediction?.predictedOutcome || "WAIT";
  const trades = reference?.trades || [];
  const sameMarketTrade = prediction?.slug ? trades.find((trade) => trade.slug === prediction.slug || trade.eventSlug === prediction.slug) : null;
  const latestBtcTrade = trades.find((trade) => trade.symbol === "BTC" && (trade.timeframe === "5M" || trade.timeframe === "15M"));
  const referenceTrade = sameMarketTrade || latestBtcTrade || null;

  let status = "waiting";
  if (referenceTrade && botOutcome !== "WAIT") {
    status = referenceTrade.outcome === botOutcome ? "agree" : sameMarketTrade ? "diverge" : "different_window";
  } else if (referenceTrade) {
    status = "reference_only";
  }

  return {
    ...reference,
    agreement: {
      status,
      botOutcome,
      referenceOutcome: referenceTrade?.outcome || "WAIT",
      referenceMarket: referenceTrade?.title || "",
      referenceSlug: referenceTrade?.slug || "",
      referenceAgeSec: referenceTrade ? Math.max(0, Math.floor((Date.now() - Date.parse(referenceTrade.time)) / 1_000)) : null,
      referencePrice: referenceTrade?.price || 0,
      referenceSizeUsd: referenceTrade?.usdcSize || 0,
      sameMarket: Boolean(sameMarketTrade),
    },
  };
}

function parseEpochFromBtcSlug(slug) {
  const match = String(slug || "").match(/btc-updown-5m-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function parseCryptoUpDownSlug(slug) {
  const match = String(slug || "").toLowerCase().match(/^(btc|eth|sol|xrp|doge|bnb)-updown-(5m|15m)-(\d+)$/);
  if (!match) return null;
  const symbolByPrefix = {
    btc: "BTC",
    eth: "ETH",
    sol: "SOL",
    xrp: "XRP",
    doge: "DOGE",
    bnb: "BNB",
  };
  const timeframe = match[2].toUpperCase();
  const seconds = timeframe === "15M" ? 900 : 300;
  const epoch = Number(match[3]);
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  return {
    prefix: match[1],
    symbol: symbolByPrefix[match[1]] || "OTHER",
    timeframe,
    seconds,
    epoch,
  };
}

function normalizeDirectionalPredictionMarket(market, now = Date.now()) {
  if (!market) return null;
  const slug = String(market.slug || "");
  const parsed = parseCryptoUpDownSlug(slug);
  if (!parsed) return null;

  const upTokenId = market.upTokenId || market.yesTokenId;
  const downTokenId = market.downTokenId || market.noTokenId;
  if (!upTokenId || !downTokenId) return null;

  const windowStartMs = parsed.epoch * 1_000;
  const derivedWindowEndMs = (parsed.epoch + parsed.seconds) * 1_000;
  const rawEndMs = Date.parse(market.windowEnd || market.endDate || "");
  const windowEndMs = Number.isFinite(rawEndMs) ? rawEndMs : derivedWindowEndMs;
  const title = market.title || market.question || `${parsed.symbol} Up or Down ${parsed.timeframe}`;

  return {
    id: String(market.id || market.marketId || market.conditionId || slug),
    conditionId: market.conditionId || market.marketId || "",
    title,
    question: title,
    slug,
    symbol: market.symbol || parsed.symbol,
    timeframe: market.timeframe || parsed.timeframe,
    marketFamily: market.marketFamily || "DIRECTIONAL",
    marketUrl: market.marketUrl || `${POLYMARKET_WEB}/event/${slug}`,
    active: market.active !== false,
    closed: Boolean(market.closed),
    enableOrderBook: market.enableOrderBook !== false,
    upTokenId: String(upTokenId),
    downTokenId: String(downTokenId),
    upOutcomePrice: toNumber(market.upOutcomePrice, 0),
    downOutcomePrice: toNumber(market.downOutcomePrice, 0),
    volume: toNumber(market.volume, 0),
    liquidity: toNumber(market.liquidity, 0),
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
    windowStartMs,
    windowEndMs,
    scannerScore: toNumber(market.opportunityScore ?? market.scannerScore, 0),
    scannerEdgePercent: toNumber(market.edgePercent ?? market.scannerEdgePercent, 0),
    scannerStatus: market.status || market.scannerStatus || "candidate",
    selectedFromScannerAt: new Date(now).toISOString(),
    priceToBeat: toNumber(market.priceToBeat ?? market.officialPriceToBeat, 0) || null,
    targetSource: market.targetSource || null,
    tickSize: toNumber(market.tickSize ?? market.minimum_tick_size, 0) || null,
    minOrderSize: toNumber(market.minOrderSize ?? market.min_order_size, 0) || null,
    takerFeeRate: toNumber(market.takerFeeRate, PAPER_CRYPTO_TAKER_FEE_RATE),
  };
}

function normalizeUpDownMarket(market) {
  const outcomes = parseArrayField(market.outcomes);
  const tokenIds = parseArrayField(market.clobTokenIds);
  const outcomePrices = parseArrayField(market.outcomePrices);
  const upIndex = outcomes.findIndex((outcome) => String(outcome).toLowerCase() === "up");
  const downIndex = outcomes.findIndex((outcome) => String(outcome).toLowerCase() === "down");
  const parsedSlug = parseCryptoUpDownSlug(market.slug);
  const epoch = parsedSlug?.epoch || parseEpochFromBtcSlug(market.slug);
  const seconds = parsedSlug?.seconds || 300;
  const derivedWindowEnd = new Date((epoch + seconds) * 1_000).toISOString();
  const rawWindowEnd = market.endDateIso || market.endDate || "";
  const windowEnd = typeof rawWindowEnd === "string" && rawWindowEnd.includes("T") ? rawWindowEnd : derivedWindowEnd;

  if (upIndex < 0 || downIndex < 0 || tokenIds.length !== 2 || !epoch) return null;

  return {
    id: String(market.id || market.conditionId || market.slug),
    conditionId: market.conditionId || "",
    title: market.question || market.title || "BTC up or down 5m",
    slug: market.slug,
    symbol: parsedSlug?.symbol || "BTC",
    timeframe: parsedSlug?.timeframe || "5M",
    marketFamily: "DIRECTIONAL",
    marketUrl: `${POLYMARKET_WEB}/event/${market.slug}`,
    active: Boolean(market.active),
    closed: Boolean(market.closed),
    enableOrderBook: Boolean(market.enableOrderBook),
    upTokenId: String(tokenIds[upIndex]),
    downTokenId: String(tokenIds[downIndex]),
    upOutcomePrice: toNumber(outcomePrices[upIndex], 0),
    downOutcomePrice: toNumber(outcomePrices[downIndex], 0),
    volume: toNumber(market.volumeNum ?? market.volume, 0),
    liquidity: toNumber(market.liquidityNum ?? market.liquidity, 0),
    windowStart: new Date(epoch * 1_000).toISOString(),
    windowEnd,
    windowStartMs: epoch * 1_000,
    windowEndMs: Date.parse(windowEnd),
    priceToBeat: declaredMarketPriceToBeat(market) || null,
    targetSource: declaredMarketPriceToBeat(market) > 0 ? "polymarket_market_event_metadata" : null,
    tickSize: toNumber(market.orderPriceMinTickSize ?? market.order_price_min_tick_size ?? market.minimum_tick_size, 0) || null,
    minOrderSize: toNumber(market.orderMinSize ?? market.order_min_size ?? market.min_order_size, 0) || null,
    takerFeeRate: toNumber(market.feeSchedule?.rate ?? market.fee_schedule?.rate ?? market.takerFeeRate, PAPER_CRYPTO_TAKER_FEE_RATE),
  };
}


async function fetchBtc5mMarket(now = Date.now()) {
  const alignedEpoch = Math.floor(now / 300_000) * 300;
  const epochs = [...new Set([alignedEpoch, alignedEpoch - 300, alignedEpoch + 300, alignedEpoch - 600, alignedEpoch + 600])];
  const results = await Promise.allSettled(
    epochs.map(async (epoch) => {
      const market = await fetchJson(`${GAMMA_API}/markets/slug/btc-updown-5m-${epoch}`);
      return normalizeUpDownMarket(market);
    }),
  );
  const markets = results
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value)
    .sort((left, right) => left.windowStartMs - right.windowStartMs);

  if (!markets.length) {
    throw new Error("No BTC 5m market found from Gamma slug scan");
  }

  const selected =
    markets.find((market) => !market.closed && market.windowStartMs <= now && now < market.windowEndMs + 20_000) ||
    markets.find((market) => !market.closed && market.windowStartMs >= now) ||
    markets.at(-1);

  if (!selected) throw new Error("No active BTC 5m market found from Gamma slug scan");
  return selected;
}

async function fetchClobPrice(tokenId, side) {
  const params = new URLSearchParams({ token_id: tokenId, side });
  const payload = await fetchJson(`${CLOB_API}/price?${params.toString()}`);
  return toNumber(payload.price, 0);
}

async function fetchClobMidpoint(tokenId) {
  const params = new URLSearchParams({ token_id: tokenId });
  const payload = await fetchJson(`${CLOB_API}/midpoint?${params.toString()}`);
  return toNumber(payload.mid, 0);
}



const externalPriceCache = new Map();
const binanceContextPriceCache = new Map();
const externalWindowAnchors = new Map();
const officialAnchorRefreshInFlight = new Map();
let externalPriceWs = null;
let externalPriceReconnectTimer = null;
let externalPriceHeartbeatTimer = null;
let externalPriceWatchdogTimer = null;
let externalPriceWsStarted = false;
const externalPriceLastArrivalBySymbol = new Map();
const externalPriceLastEventProgressBySymbol = new Map();
let externalPriceConnectedAtMs = 0;
let externalPriceConnectStartedAtMs = 0;
let externalPriceReconnects = 0;
let externalPriceWatchdogReconnects = 0;
let externalPriceLastReconnectAtMs = 0;
let externalPriceLastReconnectReason = "";
let externalPriceLastLiveness = null;
let externalPriceLastTransportActivityAtMs = 0;
let externalPriceLastValidChainlinkAtMs = 0;
let externalPriceConsecutiveWatchdogRecoveries = 0;
let externalPriceHealthySinceMs = 0;
let externalPriceParseErrors = 0;
let externalPriceInvalidFrames = 0;
let externalPriceFutureTimestampPurges = 0;

function pruneExternalWindowAnchors(now = Date.now()) {
  const ttlMs = 30 * 60_000;
  for (const [key, anchor] of externalWindowAnchors) {
    const referenceMs = toNumber(anchor?.windowStartMs ?? anchor?.capturedAtMs, 0);
    if (referenceMs <= 0 || now - referenceMs > ttlMs) externalWindowAnchors.delete(key);
  }
  while (externalWindowAnchors.size > 64) {
    const oldest = [...externalWindowAnchors.entries()]
      .sort((left, right) => toNumber(left[1]?.windowStartMs ?? left[1]?.capturedAtMs, 0) - toNumber(right[1]?.windowStartMs ?? right[1]?.capturedAtMs, 0))[0];
    if (!oldest) break;
    externalWindowAnchors.delete(oldest[0]);
  }
}

function normalizeExternalPriceSymbol(value = "") {
  const symbol = String(value || "").trim().toUpperCase();
  if (!symbol) return "";
  if (symbol === "XBT") return "BTC";
  return symbol;
}

function binanceSymbolFor(symbol = "") {
  const normalized = normalizeExternalPriceSymbol(symbol);
  if (!normalized) return "";
  return `${normalized.toLowerCase()}usdt`;
}

function updatePriceStore(store, symbol, price, source = "external_ws", time = Date.now()) {
  const normalized = normalizeExternalPriceSymbol(symbol);
  const numericPrice = toNumber(price, 0);
  if (!normalized || numericPrice <= 0) return null;
  const point = {
    symbol: normalized,
    price: numericPrice,
    source,
    updatedAt: new Date(time).toISOString(),
    updatedAtMs: time,
  };
  const previous = store.get(normalized) || { history: [] };
  const retentionReferenceMs = Math.max(Date.now(), time, toNumber(previous.updatedAtMs, 0));
  const history = [...(previous.history || []), point]
    .filter((item) => retentionReferenceMs - toNumber(item.updatedAtMs, 0) <= 5 * 60_000)
    .sort((left, right) => toNumber(left.updatedAtMs, 0) - toNumber(right.updatedAtMs, 0))
    .slice(-1_200);
  const latest = toNumber(previous.updatedAtMs, 0) > time ? previous : point;
  store.set(normalized, { ...latest, history });
  return point;
}

function updateExternalPriceCache(symbol, price, source = "polymarket_chainlink_rtds", time = Date.now()) {
  return updatePriceStore(externalPriceCache, symbol, price, source, time);
}

function updateBinanceContextPriceCache(symbol, price, source = "polymarket_binance_rtds_context", time = Date.now()) {
  return updatePriceStore(binanceContextPriceCache, symbol, price, source, time);
}

function getExternalPriceSnapshot(symbol, now = Date.now()) {
  const normalized = normalizeExternalPriceSymbol(symbol);
  const cached = normalized ? externalPriceCache.get(normalized) : null;
  if (!cached || cached.price <= 0) {
    return { available: false, status: "unavailable", symbol: normalized, price: 0, ageMs: Infinity, source: "external_price_missing" };
  }
  const ageMs = now - toNumber(cached.updatedAtMs, 0);
  const fresh = ageMs >= 0 && ageMs <= EXTERNAL_PRICE_MAX_AGE_MS;
  return {
    ...cached,
    available: fresh,
    status: fresh ? "ws_cache" : "stale_ws_cache",
    ageMs,
  };
}

function getBinanceContextSnapshot(symbol, now = Date.now()) {
  const normalized = normalizeExternalPriceSymbol(symbol);
  const cached = normalized ? binanceContextPriceCache.get(normalized) : null;
  if (!cached || cached.price <= 0) {
    return { available: false, symbol: normalized, price: null, ageMs: null, source: "binance_context_missing" };
  }
  const ageMs = now - toNumber(cached.updatedAtMs, 0);
  return {
    ...cached,
    available: ageMs >= 0 && ageMs <= EXTERNAL_PRICE_MAX_AGE_MS,
    ageMs,
  };
}

function getExternalMomentumFeatures(symbol, currentPrice = 0, now = Date.now()) {
  const cached = externalPriceCache.get(normalizeExternalPriceSymbol(symbol));
  const history = Array.isArray(cached?.history) ? cached.history : [];
  const priceAtOrBefore = (seconds) => {
    const target = now - seconds * 1000;
    const point = [...history].reverse().find((item) => toNumber(item.updatedAtMs, 0) <= target && toNumber(item.price, 0) > 0);
    return point ? toNumber(point.price, 0) : 0;
  };
  const bps = (thenPrice) => currentPrice > 0 && thenPrice > 0 ? ((currentPrice / thenPrice) - 1) * 10_000 : 0;
  return {
    momentum15Bps: bps(priceAtOrBefore(15)),
    momentum30Bps: bps(priceAtOrBefore(30)),
    momentum60Bps: bps(priceAtOrBefore(60)),
  };
}

function externalAnchorKey(market = {}) {
  const symbol = normalizeExternalPriceSymbol(market.symbol);
  const start = toNumber(market.windowStartMs, 0);
  return symbol && start > 0 ? `${symbol}:${start}` : "";
}

function findExternalWindowOpenFromHistory(snapshot = {}, windowStartMs = 0) {
  const history = Array.isArray(snapshot.history) ? snapshot.history : [];
  return history
    .filter((point) => toNumber(point.price, 0) > 0)
    .map((point) => ({ ...point, deltaMs: Math.abs(toNumber(point.updatedAtMs, 0) - windowStartMs) }))
    .filter((point) => point.deltaMs <= V372_MAX_ANCHOR_CAPTURE_DELAY_MS)
    .sort((left, right) => left.deltaMs - right.deltaMs)[0] || null;
}

function declaredMarketPriceToBeat(market = {}) {
  const direct = toNumber(
    market.priceToBeat ?? market.price_to_beat ?? market.officialPriceToBeat ?? market.eventMetadata?.priceToBeat,
    0,
  );
  if (direct > 0) return direct;
  for (const metadata of collectMetadataObjects(market)) {
    const candidate = readMetadataNumber(metadata, "priceToBeat");
    if (candidate > 0) return candidate;
  }
  return 0;
}

function scheduleOfficialPriceToBeatRefresh(market = {}) {
  const slug = String(market.slug || "");
  if (!slug || officialAnchorRefreshInFlight.has(slug)) return;
  const cached = priceTargetCache.get(slug);
  if (toNumber(cached?.price, 0) > 0 && String(cached?.source || "").startsWith("polymarket_")) return;
  const request = fetchPriceToBeat(slug, 0)
    .catch(() => ({ price: 0, source: "target_unavailable" }))
    .finally(() => officialAnchorRefreshInFlight.delete(slug));
  officialAnchorRefreshInFlight.set(slug, request);
}

function getExternalOneSecondLogReturns(symbol, now = Date.now(), lookbackMs = 120_000) {
  const cached = externalPriceCache.get(normalizeExternalPriceSymbol(symbol));
  const history = Array.isArray(cached?.history) ? cached.history : [];
  const buckets = new Map();
  for (const point of history) {
    const timestamp = toNumber(point.updatedAtMs, 0);
    const price = toNumber(point.price, 0);
    if (timestamp <= 0 || price <= 0 || now - timestamp > lookbackMs) continue;
    buckets.set(Math.floor(timestamp / 1_000), { timestamp, price });
  }
  const points = [...buckets.values()].sort((left, right) => left.timestamp - right.timestamp);
  const returns = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const elapsedSec = Math.max(1, (current.timestamp - previous.timestamp) / 1_000);
    if (elapsedSec > 5) continue;
    returns.push(Math.log(current.price / previous.price) / Math.sqrt(elapsedSec));
  }
  return returns;
}

function getOrCreateExternalWindowAnchor(market = {}, snapshot = {}, now = Date.now()) {
  pruneExternalWindowAnchors(now);
  const key = externalAnchorKey(market);
  if (!key) return { price: 0, source: "external_anchor_unavailable", status: "unavailable" };
  const existing = externalWindowAnchors.get(key);
  if (existing?.price > 0) return existing;
  const declaredPrice = declaredMarketPriceToBeat(market);
  const cachedOfficialTarget = priceTargetCache.get(String(market.slug || ""));
  const cachedPrice = String(cachedOfficialTarget?.source || "").startsWith("polymarket_")
    ? toNumber(cachedOfficialTarget?.price, 0)
    : 0;
  const officialPrice = declaredPrice || cachedPrice;
  if (officialPrice > 0) {
    const anchor = {
      price: officialPrice,
      source: declaredPrice ? "polymarket_market_event_metadata" : cachedOfficialTarget.source,
      status: "official_market_anchor",
      capturedAt: new Date(now).toISOString(),
      capturedAtMs: now,
      symbol: normalizeExternalPriceSymbol(market.symbol),
      windowStartMs: toNumber(market.windowStartMs, 0),
    };
    externalWindowAnchors.set(key, anchor);
    return anchor;
  }
  scheduleOfficialPriceToBeatRefresh(market);
  const windowStartMs = toNumber(market.windowStartMs, 0);
  const historyOpen = findExternalWindowOpenFromHistory(snapshot, windowStartMs);
  const captureDelayMs = Math.abs(now - windowStartMs);
  const canCaptureCurrent = snapshot?.available && snapshot.price > 0 && captureDelayMs <= V372_MAX_ANCHOR_CAPTURE_DELAY_MS;
  const anchorPoint = historyOpen || (canCaptureCurrent ? snapshot : null);
  if (!anchorPoint?.price || anchorPoint.price <= 0) {
    return {
      price: 0,
      source: captureDelayMs > V372_MAX_ANCHOR_CAPTURE_DELAY_MS
        ? "external_anchor_late_start_rejected"
        : "external_anchor_missing_fresh_cache",
      status: "unavailable",
    };
  }
  const anchor = {
    price: anchorPoint.price,
    source: `${anchorPoint.source || snapshot.source || "polymarket_chainlink_rtds"}_window_open_bounded`,
    status: "official_chainlink_window_anchor",
    capturedAt: new Date(now).toISOString(),
    capturedAtMs: now,
    symbol: normalizeExternalPriceSymbol(market.symbol),
    windowStartMs,
  };
  externalWindowAnchors.set(key, anchor);
  return anchor;
}

function buildExternalPriceAnchorForMarket(market = {}, now = Date.now()) {
  if (!EXTERNAL_PRICE_ANCHOR_ENABLED) {
    return { enabled: false, referencePriceStatus: "disabled", currentPrice: 0, priceToBeat: 0 };
  }
  const snapshot = getExternalPriceSnapshot(market.symbol, now);
  const binanceContext = getBinanceContextSnapshot(market.symbol, now);
  const anchor = getOrCreateExternalWindowAnchor(market, snapshot, now);
  const currentPrice = snapshot.price || 0;
  const priceToBeat = anchor.price || 0;
  const priceDelta = currentPrice > 0 && priceToBeat > 0 ? currentPrice - priceToBeat : 0;
  const priceDeltaPercent = currentPrice > 0 && priceToBeat > 0 ? (priceDelta / priceToBeat) * 100 : 0;
  const distanceBps = Math.abs(priceDeltaPercent) * 100;
  const momentum = getExternalMomentumFeatures(market.symbol, currentPrice, now);
  const status = snapshot.available && priceToBeat > 0 ? "official_chainlink_ready" : snapshot.status || "unavailable";
  const binanceContextDivergenceBps = snapshot.price > 0 && toNumber(binanceContext.price, 0) > 0
    ? ((binanceContext.price / snapshot.price) - 1) * 10_000
    : null;
  return {
    enabled: true,
    referencePriceStatus: status,
    currentPrice,
    currentSource: snapshot.source || "external_price_ws_cache",
    currentPriceAgeMs: Number.isFinite(snapshot.ageMs) ? snapshot.ageMs : null,
    priceToBeat,
    targetSource: anchor.source || "external_price_window_anchor",
    priceDelta,
    priceDeltaPercent,
    distanceBps,
    requiredDistanceBps: 0,
    binanceContextPrice: binanceContext.available ? binanceContext.price : null,
    binanceContextAgeMs: binanceContext.available ? binanceContext.ageMs : null,
    binanceContextSource: binanceContext.source || "binance_context_missing",
    binanceContextDivergenceBps,
    ...momentum,
  };
}

function configuredChainlinkSymbols() {
  return EXTERNAL_PRICE_SYMBOLS.filter((symbol) => CHAINLINK_SUPPORTED_SYMBOLS.has(symbol));
}

function externalPriceSocketState(socket = externalPriceWs) {
  if (!socket) return "closed";
  if (socket.readyState === WebSocket.CONNECTING) return "connecting";
  if (socket.readyState === WebSocket.OPEN) return "open";
  if (socket.readyState === WebSocket.CLOSING) return "closing";
  return "closed";
}

function evaluateCurrentExternalPriceFeedLiveness(now = Date.now()) {
  const latestEventBySymbol = new Map(configuredChainlinkSymbols().map((symbol) => [
    symbol,
    toNumber(externalPriceCache.get(symbol)?.updatedAtMs, 0),
  ]));
  return evaluateExternalPriceFeedLiveness({
    enabled: EXTERNAL_PRICE_WATCHDOG_ENABLED && EXTERNAL_PRICE_ANCHOR_ENABLED && EXTERNAL_PRICE_WS_ENABLED,
    now,
    socketState: externalPriceSocketState(),
    connectedAtMs: externalPriceConnectedAtMs,
    requiredSymbols: configuredChainlinkSymbols(),
    lastArrivalBySymbol: externalPriceLastArrivalBySymbol,
    latestEventBySymbol,
    lastEventProgressBySymbol: externalPriceLastEventProgressBySymbol,
    lastTransportActivityAtMs: externalPriceLastTransportActivityAtMs,
    lastValidPublisherAtMs: externalPriceLastValidChainlinkAtMs,
    staleAfterMs: EXTERNAL_PRICE_WATCHDOG_STALE_AFTER_MS,
    startupGraceMs: EXTERNAL_PRICE_WATCHDOG_STARTUP_GRACE_MS,
    futureToleranceMs: EXTERNAL_PRICE_WATCHDOG_FUTURE_TOLERANCE_MS,
    transportStaleAfterMs: EXTERNAL_PRICE_WATCHDOG_TRANSPORT_STALE_AFTER_MS,
    publisherStaleAfterMs: EXTERNAL_PRICE_WATCHDOG_PUBLISHER_STALE_AFTER_MS,
  });
}

function buildExternalPriceFeedTelemetry(now = Date.now()) {
  const liveness = evaluateCurrentExternalPriceFeedLiveness(now);
  externalPriceLastLiveness = liveness;
  return {
    status: liveness.healthy ? "live" : liveness.reason,
    socketState: liveness.socketState,
    healthy: liveness.healthy,
    reconnectRequired: liveness.reconnectRequired,
    connectedAt: externalPriceConnectedAtMs > 0 ? new Date(externalPriceConnectedAtMs).toISOString() : null,
    connectStartedAt: externalPriceConnectStartedAtMs > 0 ? new Date(externalPriceConnectStartedAtMs).toISOString() : null,
    reconnects: externalPriceReconnects,
    watchdogReconnects: externalPriceWatchdogReconnects,
    lastReconnectAt: externalPriceLastReconnectAtMs > 0 ? new Date(externalPriceLastReconnectAtMs).toISOString() : null,
    lastReconnectReason: externalPriceLastReconnectReason || null,
    staleAfterMs: EXTERNAL_PRICE_WATCHDOG_STALE_AFTER_MS,
    transportStaleAfterMs: EXTERNAL_PRICE_WATCHDOG_TRANSPORT_STALE_AFTER_MS,
    publisherStaleAfterMs: EXTERNAL_PRICE_WATCHDOG_PUBLISHER_STALE_AFTER_MS,
    lastTransportActivityAt: externalPriceLastTransportActivityAtMs > 0 ? new Date(externalPriceLastTransportActivityAtMs).toISOString() : null,
    lastValidChainlinkAt: externalPriceLastValidChainlinkAtMs > 0 ? new Date(externalPriceLastValidChainlinkAtMs).toISOString() : null,
    consecutiveWatchdogRecoveries: externalPriceConsecutiveWatchdogRecoveries,
    parseErrors: externalPriceParseErrors,
    invalidFrames: externalPriceInvalidFrames,
    futureTimestampPurges: externalPriceFutureTimestampPurges,
    symbols: liveness.symbols,
  };
}

function startExternalPriceAnchorFeeds() {
  if (!EXTERNAL_PRICE_ANCHOR_ENABLED || !EXTERNAL_PRICE_WS_ENABLED || externalPriceWsStarted) return;
  externalPriceWsStarted = true;
  const chainlinkSymbols = configuredChainlinkSymbols();
  if (!chainlinkSymbols.length) return;

  let connectionGeneration = 0;

  const scheduleReconnect = (delayMs, reason) => {
    clearTimeout(externalPriceReconnectTimer);
    externalPriceReconnectTimer = setTimeout(() => {
      externalPriceReconnectTimer = null;
      connect(reason);
    }, Math.max(0, delayMs));
    externalPriceReconnectTimer.unref?.();
  };

  const disconnectForRecovery = (reason, liveness = externalPriceLastLiveness) => {
    const now = Date.now();
    if (now - externalPriceLastReconnectAtMs < Math.max(250, EXTERNAL_PRICE_WATCHDOG_RECONNECT_DELAY_MS)) return;
    externalPriceLastReconnectAtMs = now;
    externalPriceLastReconnectReason = reason || "external_price_watchdog_reconnect";
    externalPriceWatchdogReconnects += 1;
    externalPriceConsecutiveWatchdogRecoveries += 1;
    externalPriceHealthySinceMs = 0;
    for (const item of liveness?.symbols || []) {
      if (item.eventFromFuture) externalPriceCache.delete(item.symbol);
    }
    auditLogger.event({
      time: new Date(now).toISOString(),
      type: "external_price_watchdog_reconnect",
      reason: externalPriceLastReconnectReason,
      liveness,
      entryPathBlockedByRest: false,
    });
    const socket = externalPriceWs;
    externalPriceWs = null;
    externalPriceConnectedAtMs = 0;
    clearInterval(externalPriceHeartbeatTimer);
    externalPriceHeartbeatTimer = null;
    try {
      if (typeof socket?.terminate === "function") socket.terminate();
      else socket?.close();
    } catch {}
    const exponentialDelay = Math.min(
      EXTERNAL_PRICE_WATCHDOG_MAX_BACKOFF_MS,
      EXTERNAL_PRICE_WATCHDOG_RECONNECT_DELAY_MS * (2 ** Math.min(6, Math.max(0, externalPriceConsecutiveWatchdogRecoveries - 1))),
    );
    const jitteredDelay = Math.round(exponentialDelay * (0.85 + Math.random() * 0.30));
    scheduleReconnect(jitteredDelay, externalPriceLastReconnectReason);
  };

  const connect = (reason = "initial_connect") => {
    const currentState = externalPriceSocketState();
    if (currentState === "open" || currentState === "connecting") return;
    externalPriceConnectStartedAtMs = Date.now();
    for (const symbol of chainlinkSymbols) externalPriceLastArrivalBySymbol.delete(symbol);
    for (const symbol of chainlinkSymbols) externalPriceLastEventProgressBySymbol.delete(symbol);
    externalPriceLastTransportActivityAtMs = 0;
    externalPriceLastValidChainlinkAtMs = 0;
    try {
      const generation = ++connectionGeneration;
      const socket = new WebSocket(EXTERNAL_PRICE_WS_URL, { handshakeTimeout: 10_000 });
      externalPriceWs = socket;
      socket.on("open", () => {
        if (externalPriceWs !== socket || generation !== connectionGeneration) {
          try { socket.terminate(); } catch {}
          return;
        }
        externalPriceConnectedAtMs = Date.now();
        externalPriceLastTransportActivityAtMs = externalPriceConnectedAtMs;
        externalPriceConnectStartedAtMs = 0;
        if (reason !== "initial_connect") externalPriceReconnects += 1;
        const subscriptions = [{ topic: "crypto_prices_chainlink", type: "*", filters: "" }];
        if (BINANCE_CONTEXT_FEATURE_ENABLED) {
          subscriptions.push({
            topic: "crypto_prices",
            type: "update",
            filters: chainlinkSymbols.map(binanceSymbolFor).join(","),
          });
        }
        socket.send(JSON.stringify({ action: "subscribe", subscriptions }));
        auditLogger.event({
          time: new Date(externalPriceConnectedAtMs).toISOString(),
          type: "external_price_feed_connected",
          reason,
          generation,
          symbols: chainlinkSymbols,
        });
        clearInterval(externalPriceHeartbeatTimer);
        externalPriceHeartbeatTimer = setInterval(() => {
          if (externalPriceWs === socket && socket.readyState === WebSocket.OPEN) socket.send("PING");
        }, 5_000);
        externalPriceHeartbeatTimer.unref?.();
      });
      socket.on("message", (raw) => {
        if (externalPriceWs !== socket || generation !== connectionGeneration) return;
        const arrivalAtMs = Date.now();
        externalPriceLastTransportActivityAtMs = arrivalAtMs;
        try {
          const text = String(raw).trim();
          if (text === "PING") {
            socket.send("PONG");
            return;
          }
          if (text === "PONG") return;
          const message = JSON.parse(text);
          const points = parseRtdsCryptoMessage(message, EXTERNAL_PRICE_SYMBOLS);
          if (!points.length) externalPriceInvalidFrames += 1;
          for (const point of points) {
            if (point.source === "polymarket_chainlink_rtds") {
              const previousEventAtMs = toNumber(externalPriceCache.get(point.symbol)?.updatedAtMs, 0);
              updateExternalPriceCache(point.symbol, point.price, point.source, point.timestamp);
              externalPriceLastArrivalBySymbol.set(point.symbol, arrivalAtMs);
              externalPriceLastValidChainlinkAtMs = arrivalAtMs;
              if (toNumber(point.timestamp, 0) > previousEventAtMs) {
                externalPriceLastEventProgressBySymbol.set(point.symbol, arrivalAtMs);
              }
            } else if (BINANCE_CONTEXT_FEATURE_ENABLED) {
              updateBinanceContextPriceCache(point.symbol, point.price, point.source, point.timestamp);
            }
          }
        } catch {
          externalPriceParseErrors += 1;
          // Price cache must never affect entry speed.
        }
      });
      socket.on("close", () => {
        if (externalPriceWs !== socket || generation !== connectionGeneration) return;
        clearInterval(externalPriceHeartbeatTimer);
        externalPriceHeartbeatTimer = null;
        externalPriceWs = null;
        externalPriceConnectedAtMs = 0;
        externalPriceConnectStartedAtMs = 0;
        externalPriceLastReconnectReason = "external_price_socket_closed";
        scheduleReconnect(2_000, externalPriceLastReconnectReason);
      });
      socket.on("error", (error) => {
        if (externalPriceWs !== socket || generation !== connectionGeneration) return;
        externalPriceLastReconnectReason = error instanceof Error ? error.message : "external_price_socket_error";
        externalPriceConnectStartedAtMs = 0;
        try { socket.terminate(); } catch {}
      });
    } catch (error) {
      externalPriceWs = null;
      externalPriceConnectedAtMs = 0;
      externalPriceConnectStartedAtMs = 0;
      externalPriceLastReconnectReason = error instanceof Error ? error.message : "external_price_connect_failed";
      scheduleReconnect(3_000, externalPriceLastReconnectReason);
    }
  };

  connect("initial_connect");
  if (EXTERNAL_PRICE_WATCHDOG_ENABLED) {
    clearInterval(externalPriceWatchdogTimer);
    externalPriceWatchdogTimer = setInterval(() => {
      const liveness = evaluateCurrentExternalPriceFeedLiveness(Date.now());
      externalPriceLastLiveness = liveness;
      for (const item of liveness.symbols || []) {
        if (!item.eventFromFuture) continue;
        externalPriceCache.delete(item.symbol);
        externalPriceLastEventProgressBySymbol.delete(item.symbol);
        externalPriceFutureTimestampPurges += 1;
        auditLogger.event({
          time: new Date().toISOString(),
          type: "external_price_future_timestamp_purged",
          symbol: item.symbol,
          latestEventAtMs: item.latestEventAtMs,
          entryPathBlockedByRest: false,
        });
      }
      if (liveness.healthy) {
        if (!externalPriceHealthySinceMs) externalPriceHealthySinceMs = Date.now();
        if (Date.now() - externalPriceHealthySinceMs >= EXTERNAL_PRICE_WATCHDOG_PUBLISHER_STALE_AFTER_MS) {
          externalPriceConsecutiveWatchdogRecoveries = 0;
        }
      } else {
        externalPriceHealthySinceMs = 0;
      }
      if (liveness.reconnectRequired) disconnectForRecovery(liveness.reason, liveness);
    }, Math.max(250, EXTERNAL_PRICE_WATCHDOG_INTERVAL_MS));
    externalPriceWatchdogTimer.unref?.();
  }
}

function parseEventMetadata(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractEventMetadataChunkFromHtml(html, slug) {
  const target = `"slug":"${slug}"`;
  const slugIndex = html.indexOf(target);
  if (slugIndex < 0) return "";

  const start = Math.max(0, slugIndex - 2000);
  const end = Math.min(html.length, slugIndex + 2000);
  return html.slice(start, end);
}

function extractEventMetadataNumberFromHtml(html, slug, field) {
  const chunk = extractEventMetadataChunkFromHtml(html, slug);
  const pattern = new RegExp(`"eventMetadata":\\{[^}]*"${escapeRegExp(field)}":("?)([0-9.]+)\\1`);
  const chunkMatch = chunk ? chunk.match(pattern) : null;
  return chunkMatch ? toNumber(chunkMatch[2], 0) : 0;
}

function readMetadataNumber(metadata, field) {
  if (!metadata || typeof metadata !== "object") return 0;
  return toNumber(metadata[field], 0);
}

function collectMetadataObjects(value, output = [], depth = 0) {
  if (!value || depth > 5) return output;
  const parsed = parseEventMetadata(value);
  if (parsed && parsed !== value) {
    collectMetadataObjects(parsed, output, depth + 1);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMetadataObjects(item, output, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;

  if (Object.prototype.hasOwnProperty.call(value, "finalPrice") || Object.prototype.hasOwnProperty.call(value, "priceToBeat")) {
    output.push(value);
  }

  for (const key of ["eventMetadata", "metadata", "markets", "children", "series"]) {
    if (value[key] !== undefined) collectMetadataObjects(value[key], output, depth + 1);
  }
  return output;
}

function buildOfficialSettlement(signal = {}, metadata = {}, source = "polymarket_event_metadata") {
  const finalPrice = readMetadataNumber(metadata, "finalPrice");
  const priceToBeat = readMetadataNumber(metadata, "priceToBeat") || toNumber(signal.priceToBeat, 0);
  if (finalPrice <= 0 || priceToBeat <= 0) return null;

  const direction = String(signal.direction || signal.side || "").toUpperCase();
  if (direction !== "UP" && direction !== "DOWN") return null;
  const won = direction === "UP" ? finalPrice >= priceToBeat : finalPrice < priceToBeat;
  return {
    finalPrice,
    priceToBeat,
    won,
    source,
  };
}

function normalizeOutcomeName(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "up" || text.includes(" up")) return "Up";
  if (text === "down" || text.includes(" down")) return "Down";
  return "";
}

function buildOfficialOutcomeSettlement(signal = {}, market = {}, source = "polymarket_gamma_outcome_prices") {
  const outcomes = parseArrayField(market.outcomes || market.shortOutcomes || market.outcomeNames);
  const prices = parseArrayField(market.outcomePrices || market.outcome_prices || market.prices)
    .map((value) => toNumber(value, Number.NaN));
  if (!outcomes.length || outcomes.length !== prices.length) return null;

  const winnerIndex = prices.findIndex((price) => Number.isFinite(price) && price >= 0.99);
  if (winnerIndex < 0) return null;

  const winningOutcome = normalizeOutcomeName(outcomes[winnerIndex]);
  if (!winningOutcome) return null;

  return {
    finalPrice: null,
    priceToBeat: toNumber(signal.priceToBeat, 0),
    won: String(signal.direction || signal.side || "").trim().toUpperCase() === winningOutcome.toUpperCase(),
    source,
    officialOutcome: winningOutcome,
  };
}

async function fetchPolymarketGammaSettlement(signal = {}) {
  const slug = signal.slug || "";
  if (!slug) return null;

  const encodedSlug = encodeURIComponent(slug);
  const urls = [
    `${GAMMA_API}/events?slug=${encodedSlug}&closed=true`,
    `${GAMMA_API}/events/slug/${encodedSlug}`,
    `${GAMMA_API}/markets?slug=${encodedSlug}&closed=true`,
    `${GAMMA_API}/markets/slug/${encodedSlug}`,
  ];

  for (const url of urls) {
    try {
      const payload = await fetchJson(url, {
        timeoutMs: POLYMARKET_OFFICIAL_SETTLEMENT_TIMEOUT_MS,
      });
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const row of rows) {
        const outcomeSettlement = buildOfficialOutcomeSettlement(signal, row);
        if (outcomeSettlement) return outcomeSettlement;

        for (const metadata of collectMetadataObjects(row)) {
          const settlement = buildOfficialSettlement(signal, metadata, "polymarket_gamma_event_metadata");
          if (settlement) return settlement;
        }

        const markets = Array.isArray(row?.markets) ? row.markets : [];
        for (const market of markets) {
          const marketOutcomeSettlement = buildOfficialOutcomeSettlement(signal, market);
          if (marketOutcomeSettlement) return marketOutcomeSettlement;
        }
      }
    } catch {
      // Try the next official Gamma endpoint shape.
    }
  }
  return null;
}

async function fetchPolymarketWebSettlement(signal = {}) {
  const slug = signal.slug || "";
  if (!slug) return null;

  const result = await fetchText(`${POLYMARKET_WEB}/event/${slug}`, {
    timeoutMs: POLYMARKET_OFFICIAL_SETTLEMENT_TIMEOUT_MS,
  });
  const html = result.text || "";
  if (!result.ok || !html || html.includes("<title>Internet Baik</title>")) return null;

  const finalPrice = extractEventMetadataNumberFromHtml(html, slug, "finalPrice");
  const priceToBeat = extractEventMetadataNumberFromHtml(html, slug, "priceToBeat") || toNumber(signal.priceToBeat, 0);
  return buildOfficialSettlement(signal, { finalPrice, priceToBeat }, "polymarket_web_event_metadata");
}

function adaptOfficialSettlementToSignal(settlement, signal = {}) {
  if (!settlement) return null;
  const direction = String(signal.direction || signal.side || "").trim().toUpperCase();
  const officialOutcome = String(settlement.officialOutcome || "").trim().toUpperCase();
  let won = Boolean(settlement.won);
  if (officialOutcome === "UP" || officialOutcome === "DOWN") {
    won = direction === officialOutcome;
  } else {
    const finalPrice = toNumber(settlement.finalPrice, 0);
    const priceToBeat = toNumber(settlement.priceToBeat || signal.priceToBeat, 0);
    if (finalPrice > 0 && priceToBeat > 0) won = direction === "UP" ? finalPrice >= priceToBeat : finalPrice < priceToBeat;
  }
  return { ...settlement, won };
}

async function fetchPolymarketOfficialSettlement(signal = {}) {
  if (!POLYMARKET_OFFICIAL_SETTLEMENT_ENABLED) return null;
  const slug = String(signal.slug || "").trim();
  const settlement = await officialSettlementRequestCache.getOrLoad(slug, async () => {
    const attempts = [fetchPolymarketGammaSettlement, fetchPolymarketWebSettlement];
    for (const attempt of attempts) {
      try {
        const result = await attempt(signal);
        if (result) return result;
      } catch {
        // Official settlement can lag after window close; miss TTL controls retries.
      }
    }
    return null;
  });
  return adaptOfficialSettlementToSignal(settlement, signal);
}

function shouldReconcileOfficialSettlement(signal = {}) {
  if (!POLYMARKET_OFFICIAL_RECONCILE_ENABLED || signal.officialSettlementUsed) return false;
  if (signal.status !== "paper_win" && signal.status !== "paper_loss" && !isProxyStatus(signal.status)) return false;
  const source = String(signal.settlementSource || "");
  return /proxy|pending|timeout|binance/i.test(source);
}

async function reconcileOfficialSettlement(signal = {}) {
  const officialSettlement = await fetchPolymarketOfficialSettlement(signal);
  if (!officialSettlement) return signal;

  const won = officialSettlement.won;
  const reconciled = {
    ...signal,
    status: won ? "paper_win" : "paper_loss",
    finalPrice: toNumber(officialSettlement.finalPrice, 0) > 0 ? officialSettlement.finalPrice : null,
    priceToBeat: officialSettlement.priceToBeat || signal.priceToBeat,
    paperPnlUsd: won
      ? toNumber(signal.potentialProfitUsd, 0)
      : -(toNumber(signal.paperStakeUsd, 0) + toNumber(signal.takerFeeUsd, 0)),
    settlementSource: "official_poly_reconciled",
    settlementSourceDetail: officialSettlement.source || signal.settlementSourceDetail || null,
    settlementFinality: "official_poly_reconciled",
    settlementLabel: "Official Poly reconciled",
    officialSettlementUsed: true,
    officialOutcome: officialSettlement.officialOutcome || null,
    settlementRetryCount: toNumber(signal.settlementRetryCount, 0) + 1,
    reconciledAt: new Date().toISOString(),
  };
  auditLogger.settlement(reconciled);
  return reconciled;
}

function extractPriceToBeatFromHtml(html, slug) {
  const chunk = extractEventMetadataChunkFromHtml(html, slug);
  const metadataMatch = chunk ? chunk.match(/"eventMetadata":\{[^}]*"priceToBeat":([0-9.]+)/) : null;
  return metadataMatch ? toNumber(metadataMatch[1], 0) : 0;
}

async function fetchPriceToBeat(slug, _fallbackPrice = 0) {
  const cached = priceTargetCache.get(slug);
  if (toNumber(cached?.price, 0) > 0 && String(cached?.source || "").startsWith("polymarket_")) return cached;

  const encodedSlug = encodeURIComponent(slug);
  const gammaUrls = [
    `${GAMMA_API}/events?slug=${encodedSlug}`,
    `${GAMMA_API}/events/slug/${encodedSlug}`,
    `${GAMMA_API}/markets?slug=${encodedSlug}`,
    `${GAMMA_API}/markets/slug/${encodedSlug}`,
  ];
  for (const url of gammaUrls) {
    try {
      const payload = await fetchJson(url, { timeoutMs: POLYMARKET_OFFICIAL_SETTLEMENT_TIMEOUT_MS });
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const row of rows) {
        const direct = declaredMarketPriceToBeat(row);
        if (direct > 0) {
          const target = { price: direct, source: "polymarket_gamma_event_metadata" };
          priceTargetCache.set(slug, target);
          return target;
        }
      }
    } catch {
      // Continue to the next official endpoint shape.
    }
  }

  try {
    const result = await fetchText(`${POLYMARKET_WEB}/event/${slug}`);
    const html = result.text || "";
    if (result.ok && html && !html.includes("<title>Internet Baik</title>")) {
      const price = extractPriceToBeatFromHtml(html, slug);
      if (price > 0) {
        const target = { price, source: "polymarket_event_metadata" };
        priceTargetCache.set(slug, target);
        return target;
      }
    }
  } catch {
    // No proxy or local fallback is allowed in the V373 entry path.
  }

  // Do not cache misses. Official metadata may appear after a transient network failure.
  return { price: 0, source: "target_unavailable" };
}

function createReferenceScanError(previousReference, error, prediction) {
  const reference = createEmptyReference({
    ...previousReference,
    status: "error",
    stats: summarizeReferenceStats(previousReference?.trades || [], previousReference?.positions || [], 0),
    updatedAt: new Date().toISOString(),
    lastError: error instanceof Error ? error.message : "reference_wallet_scan_failed",
  });
  return attachReferenceAgreement(reference, prediction);
}

async function fetchReferenceEndpoint(pathname, params) {
  const search = new URLSearchParams(params);
  return fetchJson(`${DATA_API}${pathname}?${search.toString()}`);
}

async function scanReferenceWallet(previousReference = createEmptyReference(), prediction = null) {
  if (!REFERENCE_WALLET_ENABLED) {
    return attachReferenceAgreement(
      createEmptyReference({
        ...previousReference,
        status: "disabled",
        stats: summarizeReferenceStats(previousReference.trades || [], previousReference.positions || [], 0),
        updatedAt: new Date().toISOString(),
      }),
      prediction,
    );
  }
  if (referencePollState.inFlight) {
    return attachReferenceAgreement(
      createEmptyReference({
        ...previousReference,
        status: previousReference?.status || "poll_busy",
        stats: summarizeReferenceStats(previousReference.trades || [], previousReference.positions || [], 0),
        updatedAt: previousReference?.updatedAt || new Date().toISOString(),
        lastError: "reference_poll_in_flight",
      }),
      prediction,
    );
  }

  referencePollState.inFlight = true;
  const startedAt = Date.now();

  try {
    const params = {
      user: REFERENCE_WALLET_ADDRESS,
      limit: String(REFERENCE_TRADE_LIMIT),
    };
    const [activityResult, tradesResult, positionsResult] = await Promise.allSettled([
      fetchReferenceEndpoint("/activity", params),
      fetchReferenceEndpoint("/trades", params),
      fetchReferenceEndpoint("/positions", params),
    ]);

    const rawTrades = [];
    if (activityResult.status === "fulfilled" && Array.isArray(activityResult.value)) rawTrades.push(...activityResult.value);
    if (tradesResult.status === "fulfilled" && Array.isArray(tradesResult.value)) rawTrades.push(...tradesResult.value);

    const normalizedTrades = rawTrades.map(normalizeReferenceTrade).filter(Boolean);
    const mergedTrades = new Map();
    for (const trade of [...normalizedTrades, ...(previousReference.trades || [])]) {
      const key = getReferenceTradeKey(trade);
      if (key && !mergedTrades.has(key)) mergedTrades.set(key, { ...trade, key });
    }

    const trades = [...mergedTrades.values()]
      .sort((left, right) => toNumber(right.timestamp, 0) - toNumber(left.timestamp, 0))
      .slice(0, 500);

    let newTradeCount = 0;
    for (const trade of normalizedTrades) {
      const key = getReferenceTradeKey(trade);
      if (!key) continue;
      if (referencePollState.warmedUp && !seenReferenceTradeKeys.has(key)) newTradeCount += 1;
      seenReferenceTradeKeys.add(key);
    }
    referencePollState.warmedUp = true;

    const positions = positionsResult.status === "fulfilled" && Array.isArray(positionsResult.value)
      ? positionsResult.value.map(normalizeReferencePosition).filter((position) => position.symbol !== "OTHER").slice(0, 100)
      : previousReference.positions || [];
    const stats = {
      ...summarizeReferenceStats(trades, positions, newTradeCount),
      pollLatencyMs: Date.now() - startedAt,
    };
    referencePollState.lastLatencyMs = stats.pollLatencyMs;
    const failedEndpoints = [
      activityResult.status === "rejected" ? "activity" : "",
      tradesResult.status === "rejected" ? "trades" : "",
      positionsResult.status === "rejected" ? "positions" : "",
    ].filter(Boolean);
    const status = failedEndpoints.length === 3 ? "error" : stats.active ? "active" : "idle";
    const reference = attachReferenceAgreement(
      createEmptyReference({
        status,
        trades,
        positions,
        stats,
        updatedAt: new Date().toISOString(),
        lastError: failedEndpoints.length ? `partial_reference_fetch_failed:${failedEndpoints.join(",")}` : "",
      }),
      prediction,
    );

    savePersistedReference(reference);
    return reference;
  } finally {
    referencePollState.inFlight = false;
  }
}

async function settlePredictionSignals(signals, now = Date.now()) {
  let reconcileBudget = POLYMARKET_OFFICIAL_RECONCILE_MAX_PER_SCAN;
  return Promise.all((signals || []).map(async (signal) => {
    const windowEndMs = Date.parse(signal.windowEnd);
    if (shouldReconcileOfficialSettlement(signal) && reconcileBudget > 0) {
      reconcileBudget -= 1;
      return reconcileOfficialSettlement(signal);
    }
    if (signal.status !== "paper_open" || !Number.isFinite(windowEndMs) || windowEndMs > now) return signal;

    const officialSettlement = await fetchPolymarketOfficialSettlement(signal);
    if (!officialSettlement) {
      return {
        ...signal,
        settlementSource: "pending_official_poly_required",
        settlementFinality: "pending_official",
        settlementLabel: "Pending official",
        settlementPendingSince: signal.settlementPendingSince || new Date(now).toISOString(),
        settlementRetryCount: toNumber(signal.settlementRetryCount, 0) + 1,
      };
    }

    const finalPrice = toNumber(officialSettlement.finalPrice, 0) > 0 ? officialSettlement.finalPrice : null;
    const priceToBeat = toNumber(officialSettlement.priceToBeat, 0) > 0
      ? officialSettlement.priceToBeat
      : signal.priceToBeat;
    const won = Boolean(officialSettlement.won);
    const settledSignal = {
      ...signal,
      status: won ? "paper_win" : "paper_loss",
      settledAt: new Date(now).toISOString(),
      finalPrice,
      priceToBeat,
      paperPnlUsd: won
        ? toNumber(signal.potentialProfitUsd, 0)
        : -(toNumber(signal.paperStakeUsd, 0) + toNumber(signal.takerFeeUsd, 0)),
      settlementSource: "official_poly",
      settlementSourceDetail: officialSettlement.source || null,
      settlementFinality: "official_poly",
      settlementLabel: "Official Poly",
      settlementPendingSince: signal.settlementPendingSince || null,
      settlementRetryCount: toNumber(signal.settlementRetryCount, 0) + 1,
      officialSettlementUsed: true,
      officialOutcome: officialSettlement.officialOutcome || null,
      learningEligible: signal.learningEligible !== false && toNumber(signal.filledStakeUsd ?? signal.paperStakeUsd, 0) > 0,
    };
    auditLogger.settlement(settledSignal);
    return settledSignal;
  }));
}

function summarizePredictionSignals(signals) {
  const safeSignals = Array.isArray(signals) ? signals.filter(Boolean) : [];
  const settled = uniqueOfficialFinalSettled(safeSignals);
  const headline5m = summarizeOfficialFilledUnique(safeSignals, { timeframe: "5M" });
  const separate15m = summarizeOfficialFilledUnique(safeSignals, { timeframe: "15M" });
  const paperPnl = settled.reduce((total, signal) => total + toNumber(signal.paperPnlUsd, 0), 0);
  const totalStakeSettled = settled.reduce((total, signal) => total + toNumber(signal.paperStakeUsd, 0), 0);
  const avgConfidence = settled.length
    ? settled.reduce((total, signal) => total + toNumber(signal.confidence, 0), 0) / settled.length
    : 0;
  const avgBuyPrice = settled.length
    ? settled.reduce((total, signal) => total + toNumber(signal.buyPrice, 0), 0) / settled.length
    : 0;
  const buckets = buildConfidenceBuckets(settled);
  const minReliableSamples = Math.min(100, BTC_SAMPLE_TARGET);

  return {
    signals: safeSignals.length,
    settled: headline5m.uniqueOutcomes,
    wins: headline5m.wins,
    losses: headline5m.losses,
    winRate: headline5m.winRate,
    metricDefinition: headline5m.definition,
    officialFilledUnique5m: headline5m,
    officialFilledUnique15m: separate15m,
    rawOfficialFilledSettledTrades: settled.length,
    paperPnl,
    paperRoi: totalStakeSettled ? (paperPnl / totalStakeSettled) * 100 : 0,
    totalStakeSettled,
    avgConfidence,
    avgBuyPrice,
    breakEvenAccuracy: avgBuyPrice * 100,
    sampleTarget: BTC_SAMPLE_TARGET,
    sampleProgress: Math.min(100, (headline5m.uniqueOutcomes / BTC_SAMPLE_TARGET) * 100),
    minReliableSamples,
    reliable: headline5m.uniqueOutcomes >= minReliableSamples,
    buckets,
  };
}

function summarizePredictionStats(signals) {
  const allStats = summarizePredictionSignals(signals);
  const activeSignals = signals.filter((signal) => signal.strategyVersion === BTC_PREDICTION_STRATEGY_VERSION);
  return {
    ...allStats,
    strategyVersion: BTC_PREDICTION_STRATEGY_VERSION,
    riskProfile: RISK_PROFILE,
    aggressiveLearningMode: AGGRESSIVE_LEARNING_MODE,
    activeStats: summarizePredictionSignals(activeSignals),
  };
}

function getBankrollFromStats(stats = {}) {
  const totalPnl = toNumber(stats?.paperPnl, NaN);
  const activePnl = toNumber(stats?.activeStats?.paperPnl, NaN);
  const pnl = Number.isFinite(totalPnl)
    ? totalPnl
    : Number.isFinite(activePnl)
      ? activePnl
      : 0;
  return getSizingEquity(PAPER_START_BALANCE + pnl);
}

function getSizingEquity(value, fallback = PAPER_START_BALANCE) {
  return Math.max(V333_MIN_SIZING_EQUITY_USD, toNumber(value, fallback));
}

function buildAntiPlateauTelemetry(signals = [], now = Date.now()) {
  const settled = uniqueOfficialFinalSettled(signals)
    .filter((signal) => signal.strategyVersion === BTC_PREDICTION_STRATEGY_VERSION)
    .sort((left, right) => Date.parse(left.settledAt || left.time || 0) - Date.parse(right.settledAt || right.time || 0));
  let currentEquityUsd = PAPER_START_BALANCE;
  let allTimeHighEquityUsd = PAPER_START_BALANCE;
  let allTimeHighAt = null;
  let allTimeHighSettlementIndex = -1;
  let newHighCount = 0;
  for (let index = 0; index < settled.length; index += 1) {
    currentEquityUsd += toNumber(settled[index].paperPnlUsd, 0);
    if (currentEquityUsd > allTimeHighEquityUsd + 1e-9) {
      allTimeHighEquityUsd = currentEquityUsd;
      allTimeHighAt = settled[index].settledAt || settled[index].time || null;
      allTimeHighSettlementIndex = index;
      newHighCount += 1;
    }
  }
  const currentDynamicCapUsd = getDynamicMaxTradeUsd(currentEquityUsd, "S", {
    lane: "S",
    calibratedLane: "S",
    bookSource: "ws_delta+ws_delta",
    profitLockMode: "normal",
  });
  const settlementsSinceAllTimeHigh = allTimeHighSettlementIndex >= 0
    ? settled.length - allTimeHighSettlementIndex - 1
    : settled.length;
  const allTimeHighAtMs = Date.parse(allTimeHighAt || "");
  const drawdownFromAllTimeHighUsd = Math.max(0, allTimeHighEquityUsd - currentEquityUsd);
  const rolling = (count) => {
    const rows = settled.slice(-count);
    const pnlUsd = rows.reduce((sum, signal) => sum + toNumber(signal.paperPnlUsd, 0), 0);
    const stakeUsd = rows.reduce((sum, signal) => sum + toNumber(signal.filledStakeUsd ?? signal.paperStakeUsd, 0), 0);
    const wins = rows.filter((signal) => signal.status === "paper_win").length;
    return {
      samples: rows.length,
      wins,
      losses: rows.length - wins,
      winRate: rows.length ? (wins / rows.length) * 100 : 0,
      pnlUsd,
      roiPct: stakeUsd > 0 ? (pnlUsd / stakeUsd) * 100 : 0,
      afterFeeExpectancyUsd: rows.length ? pnlUsd / rows.length : 0,
    };
  };
  const rolling20 = rolling(20);
  const rolling50 = rolling(50);
  const stagnationDetected = settlementsSinceAllTimeHigh >= 20 && rolling20.afterFeeExpectancyUsd <= 0;
  return {
    enabled: FAST_GROW_EV_POLICY_ENABLED && DYNAMIC_EQUITY_SCALING_ENABLED,
    executionEffect: "telemetry_only_no_ath_chasing",
    martingale: false,
    sizingBasis: "current_realized_equity_not_peak_equity",
    currentEquityUsd,
    allTimeHighEquityUsd,
    allTimeHighAt,
    newHighCount,
    settlementsSinceAllTimeHigh,
    hoursSinceAllTimeHigh: Number.isFinite(allTimeHighAtMs) ? Math.max(0, (now - allTimeHighAtMs) / 3_600_000) : null,
    drawdownFromAllTimeHighUsd,
    drawdownFromAllTimeHighPct: allTimeHighEquityUsd > 0 ? (drawdownFromAllTimeHighUsd / allTimeHighEquityUsd) * 100 : 0,
    legacyFixedCapUsd: PAPER_MAX_TRADE_USD,
    legacyFixedCapToEquityPct: currentEquityUsd > 0 ? (PAPER_MAX_TRADE_USD / currentEquityUsd) * 100 : 0,
    currentDynamicCapUsd,
    currentDynamicCapToEquityPct: currentEquityUsd > 0 ? (currentDynamicCapUsd / currentEquityUsd) * 100 : 0,
    hardCapUsd: MAX_TRADE_USD_HARD_CAP,
    staticUsdHardCapEnabled: MAX_TRADE_USD_HARD_CAP > 0,
    structuralPlateauGuard: MAX_TRADE_USD_HARD_CAP > 0
      ? "fixed_usd_cap_enabled"
      : "no_fixed_usd_cap_current_equity_fraction_only",
    maxTradeEquityFraction: MAX_TRADE_EQUITY_FRACTION,
    capitalDeadlockBug: false,
    artificialFixedMinimumStakeUsd: 0,
    rolling20,
    rolling50,
    stagnationDetected,
    stagnationAction: stagnationDetected
      ? "telemetry_and_cohort_local_lane_downgrade_only"
      : "none",
    globalEntryFreeze: false,
  };
}

function summarizeCurrentVersionSettled(signals = []) {
  const settled = uniqueOfficialFinalSettled(signals)
    .filter((signal) => signal.strategyVersion === BTC_PREDICTION_STRATEGY_VERSION)
    .sort((left, right) => Date.parse(right.settledAt || right.time || 0) - Date.parse(left.settledAt || left.time || 0));
  const wins = settled.filter((signal) => signal.status === "paper_win").length;
  const pnl = settled.reduce((sum, signal) => sum + toNumber(signal.paperPnlUsd, 0), 0);
  const stake = settled.reduce((sum, signal) => sum + toNumber(signal.paperStakeUsd ?? signal.stakeUsd, 0), 0);
  return {
    settled: settled.length,
    wins,
    losses: settled.length - wins,
    winRate: settled.length ? (wins / settled.length) * 100 : 0,
    pnl,
    stake,
    roi: stake ? (pnl / stake) * 100 : 0,
    recent: settled.slice(0, Math.min(5, settled.length)),
  };
}

function buildV333DrawdownGuardState({ signals = [], selected = {}, accountEquity = PAPER_START_BALANCE, calibratedLane = "", profitLockState = {} } = {}) {
  if (!V333_DRAWDOWN_GUARD_ENABLED) return { enabled: false, blockEntry: false, reasons: [] };
  const stats = summarizeCurrentVersionSettled(signals);
  const recentPnl = stats.recent.reduce((sum, signal) => sum + toNumber(signal.paperPnlUsd, 0), 0);
  const recentLosses = stats.recent.filter((signal) => signal.status === "paper_loss").length;
  const sizingEquity = getSizingEquity(accountEquity);
  const side = String(selected.side || selected.predictedOutcome || selected.direction || "").toUpperCase();
  const lane = String(calibratedLane || selected.executionQuality?.calibratedLane || selected.calibratedLane || "").toUpperCase();
  const inRealizedDrawdown = sizingEquity < PAPER_START_BALANCE || stats.pnl < 0;
  const recentRecovery = stats.recent.length >= 3 && recentPnl < 0 && recentLosses >= Math.ceil(stats.recent.length / 2);
  const hardRecovery = String(profitLockState.mode || "").toLowerCase() === "hard_recovery";
  const coldStart = stats.settled < V333_COLD_START_SETTLED_REQUIRED;
  const recoveryActive = inRealizedDrawdown || recentRecovery || hardRecovery;
  const reasons = [];
  if (coldStart) reasons.push("v333_cold_start");
  if (inRealizedDrawdown) reasons.push("v333_realized_drawdown");
  if (recentRecovery) reasons.push("v333_recent_loss_recovery");
  if (hardRecovery) reasons.push("v333_profit_lock_hard_recovery");
  const blockEntry = Boolean(V333_BLOCK_UP_IN_DRAWDOWN && recoveryActive && side === "UP");
  if (blockEntry) reasons.push("v333_block_up_in_drawdown");
  return {
    enabled: true,
    blockEntry,
    reasons,
    side,
    lane,
    coldStart,
    recoveryActive,
    sizingEquity,
    settled: stats.settled,
    pnl: stats.pnl,
    roi: stats.roi,
    winRate: stats.winRate,
    recentPnl,
    recentLosses,
  };
}

function buildV334StrictEntryGuard({ signals = [], selected = {}, market = {} } = {}) {
  if (!V334_STRICT_ENTRY_GUARD_ENABLED) return { enabled: false, approved: true, reasons: [] };
  const symbol = String(selected.symbol || market.symbol || detectCryptoSymbol(`${market.title || ""} ${market.slug || ""}`)).toUpperCase();
  const timeframe = String(selected.timeframe || market.timeframe || detectReferenceTimeframe(`${market.title || ""} ${market.slug || ""}`)).toUpperCase();
  const side = sideKey(selected.side || selected.predictedOutcome || selected.direction);
  const entryPrice = toNumber(selected.entryPrice ?? selected.selectedBuyPrice ?? selected.buyPrice, 0);
  const bookSource = String(selected.bookSource || "unknown").toLowerCase().trim();
  const runtimeDecision = selected.runtimeRuleCache || selected.runtimeRuleCacheDecision || {};
  const runtimeReason = String(selected.runtimeRuleReason || runtimeDecision.reason || "").toLowerCase();
  const matchedBuckets = Array.isArray(selected.runtimeMatchedBuckets)
    ? selected.runtimeMatchedBuckets
    : Array.isArray(runtimeDecision.matchedBuckets)
      ? runtimeDecision.matchedBuckets
      : [];
  const replayReason = String(selected.replayOptimizerDecision?.reason || selected.replayOptimizer?.reason || selected.replayOptimizerReason || "").toLowerCase();
  const replayRules = Array.isArray(selected.replayOptimizerDecision?.matchedRules)
    ? selected.replayOptimizerDecision.matchedRules
    : Array.isArray(selected.replayOptimizer?.matchedRules)
      ? selected.replayOptimizer.matchedRules
      : [];
  const replayBad = replayReason.includes("replay_block") || replayRules.some((rule) => String(rule?.id || rule).toLowerCase().includes("bad"));
  const runtimeToxic = /toxic/.test(runtimeReason) || matchedBuckets.some((bucket) => bucket && (bucket.toxic || bucket.action === "probe_only_toxic"));
  const settled = uniqueOfficialFinalSettled(signals)
    .filter((signal) => signal.strategyVersion === BTC_PREDICTION_STRATEGY_VERSION)
    .sort((left, right) => Date.parse(right.settledAt || right.time || 0) - Date.parse(left.settledAt || left.time || 0));
  let consecutiveLosses = 0;
  for (const signal of settled) {
    if (signal.status === "paper_loss") consecutiveLosses += 1;
    else break;
  }
  const open = (Array.isArray(signals) ? signals : []).filter((signal) => signal.status === "paper_open");
  const reasons = [];
  if (V334_ALLOWED_SYMBOLS.size && !V334_ALLOWED_SYMBOLS.has(symbol)) reasons.push("v334_symbol_not_allowed");
  if (V334_ALLOWED_TIMEFRAMES.size && !V334_ALLOWED_TIMEFRAMES.has(timeframe)) reasons.push("v334_timeframe_not_allowed");
  if (V334_ALLOWED_SIDES.size && !V334_ALLOWED_SIDES.has(side)) reasons.push("v334_side_not_allowed");
  if (entryPrice <= 0 || entryPrice > V334_MAX_ENTRY_PRICE) reasons.push("v334_entry_price_block");
  if (V334_BLOCK_RUNTIME_TOXIC && runtimeToxic) reasons.push("v334_runtime_toxic_block");
  if (V334_BLOCK_REPLAY_BAD && replayBad) reasons.push("v334_replay_bad_block");
  if (V334_BLOCK_REST_BOOK && bookSource === "rest+rest") reasons.push("v334_rest_book_block");
  if (open.length >= V334_MAX_OPEN_POSITIONS) reasons.push("v334_max_open_positions");
  if (V334_BLOCK_AFTER_LOSS_STREAK > 0 && consecutiveLosses >= V334_BLOCK_AFTER_LOSS_STREAK) reasons.push("v334_loss_streak_circuit");
  return {
    enabled: true,
    approved: reasons.length === 0,
    reasons,
    symbol,
    timeframe,
    side,
    entryPrice,
    runtimeToxic,
    replayBad,
    bookSource,
    openPositions: open.length,
    consecutiveLosses,
  };
}

function legacyLaneFromRank(rank = "") {
  const normalizedRank = String(rank || "").toUpperCase();
  if (normalizedRank === "A+") return "S";
  if (normalizedRank === "A") return "A";
  return "B";
}

function buildConfidenceBuckets(settled) {
  return CONFIDENCE_BUCKET_RANGES.map((range) => {
    const rows = settled.filter((signal) => {
      const confidence = toNumber(signal.confidence, 0);
      return confidence >= range.min && confidence < range.max;
    });
    const wins = rows.filter((signal) => signal.status === "paper_win").length;
    const pnl = rows.reduce((total, signal) => total + toNumber(signal.paperPnlUsd, 0), 0);
    const stake = rows.reduce((total, signal) => total + toNumber(signal.paperStakeUsd, 0), 0);
    const avgBuyPrice = rows.length
      ? rows.reduce((total, signal) => total + toNumber(signal.buyPrice, 0), 0) / rows.length
      : 0;
    return {
      label: range.label,
      min: range.min,
      max: range.max,
      count: rows.length,
      wins,
      winRate: rows.length ? (wins / rows.length) * 100 : 0,
      avgBuyPrice,
      breakEvenAccuracy: avgBuyPrice * 100,
      pnl,
      roi: stake ? (pnl / stake) * 100 : 0,
    };
  });
}

function getConfidenceBucket(stats, confidence) {
  const range = CONFIDENCE_BUCKET_RANGES.find((bucket) => confidence >= bucket.min && confidence < bucket.max);
  if (!range) return null;
  return (stats?.buckets || []).find((bucket) => bucket.label === range.label) || {
    ...range,
    count: 0,
    wins: 0,
    winRate: 0,
    avgBuyPrice: 0,
    breakEvenAccuracy: 0,
    pnl: 0,
    roi: 0,
  };
}

function evaluateLearnedPredictionGate(stats, confidence) {
  const bucket = getConfidenceBucket(stats, confidence);
  if (!BTC_PREDICTION_LEARNED_FILTER_ENABLED || !stats?.reliable || !bucket) {
    return { allowed: true, bucket, reason: "" };
  }
  if (bucket.count < BTC_PREDICTION_MIN_BUCKET_SAMPLES) {
    return { allowed: true, bucket, reason: "" };
  }
  if (bucket.roi < BTC_PREDICTION_MIN_BUCKET_ROI) {
    return { allowed: false, bucket, reason: "negative_confidence_bucket" };
  }
  if (bucket.breakEvenAccuracy > 0 && bucket.winRate < bucket.breakEvenAccuracy) {
    return { allowed: false, bucket, reason: "bucket_below_break_even" };
  }
  return { allowed: true, bucket, reason: "" };
}

function evaluatePredictionLossCircuit(signals, now) {
  const recentSettled = (signals || [])
    .filter((signal) => {
      if (signal.strategyVersion !== BTC_PREDICTION_STRATEGY_VERSION) return false;
      if (signal.status !== "paper_win" && signal.status !== "paper_loss") return false;
      const timestamp = Date.parse(signal.settledAt || signal.windowEnd || signal.time);
      return Number.isFinite(timestamp) && now - timestamp <= BTC_PREDICTION_LOSS_CIRCUIT_WINDOW_MS;
    })
    .sort((left, right) => Date.parse(right.settledAt || right.windowEnd || right.time) - Date.parse(left.settledAt || left.windowEnd || left.time));

  const last = recentSettled.slice(0, BTC_PREDICTION_LOSS_CIRCUIT_COUNT);
  const blocked =
    BTC_PREDICTION_LOSS_CIRCUIT_COUNT > 0 &&
    last.length >= BTC_PREDICTION_LOSS_CIRCUIT_COUNT &&
    last.every((signal) => signal.status === "paper_loss");

  return {
    blocked,
    lossCount: last.filter((signal) => signal.status === "paper_loss").length,
    sampleCount: last.length,
    windowMs: BTC_PREDICTION_LOSS_CIRCUIT_WINDOW_MS,
  };
}

function buildAdaptiveConfig() {
  return {
    enabled: ADAPTIVE_LEARNING_ENABLED,
    mode: ADAPTIVE_MODE,
    minSamples: ADAPTIVE_LOSS_PATTERN_MIN_SAMPLES,
    lookback: ADAPTIVE_LOSS_PATTERN_LOOKBACK,
    autoBlock: ADAPTIVE_PATTERN_AUTO_BLOCK,
    blockAfterLosses: ADAPTIVE_BLOCK_AFTER_LOSSES,
    minLossRatePercent: ADAPTIVE_MIN_LOSS_RATE_PERCENT,
    minPatternRoi: ADAPTIVE_MIN_PATTERN_ROI,
    earlyWindowSeconds: ADAPTIVE_EARLY_WINDOW_SECONDS,
    lateWindowSeconds: ADAPTIVE_LATE_WINDOW_SECONDS,
    highEntryPrice: ADAPTIVE_HIGH_ENTRY_PRICE,
    wideSpreadCents: ADAPTIVE_WIDE_SPREAD_CENTS,
    reduceStakeMultiplier: NO_STAKE_REDUCTION_MODE ? 1 : ADAPTIVE_REDUCE_STAKE_MULTIPLIER,
    patternBlockMinutes: ADAPTIVE_PATTERN_BLOCK_MINUTES,
    sameSideRuntimeLimit: ADAPTIVE_SAME_SIDE_RUNTIME_LIMIT,
    recoveryLossStreak: ADAPTIVE_RECOVERY_LOSS_STREAK,
    recoveryStakeMultiplier: NO_STAKE_REDUCTION_MODE ? 1 : ADAPTIVE_RECOVERY_STAKE_MULTIPLIER,
    hardStopLossStreak: ADAPTIVE_HARD_STOP_LOSS_STREAK,
    globalCooldownMs: ADAPTIVE_GLOBAL_COOLDOWN_MS,
    earlyWindowAction: NO_ENTRY_REDUCTION_MODE ? "observe" : (process.env.ADAPTIVE_EARLY_WINDOW_ACTION || "observe"),
    lateWindowAction: NO_ENTRY_REDUCTION_MODE ? "observe" : (process.env.ADAPTIVE_LATE_WINDOW_ACTION || "observe"),
    highEntryPriceAction: NO_ENTRY_REDUCTION_MODE ? "observe" : (process.env.ADAPTIVE_HIGH_ENTRY_PRICE_ACTION || "observe"),
    wideSpreadAction: NO_ENTRY_REDUCTION_MODE ? "observe" : (process.env.ADAPTIVE_WIDE_SPREAD_ACTION || "observe"),
    sameSideClusterAction: NO_ENTRY_REDUCTION_MODE ? "observe" : (process.env.ADAPTIVE_SAME_SIDE_CLUSTER_ACTION || "observe"),
    symbolLossAction: NO_ENTRY_REDUCTION_MODE ? "observe" : (process.env.ADAPTIVE_SYMBOL_LOSS_ACTION || "observe"),
    timeframeLossAction: NO_ENTRY_REDUCTION_MODE ? "observe" : (process.env.ADAPTIVE_TIMEFRAME_LOSS_ACTION || "observe"),
    sideLossAction: NO_ENTRY_REDUCTION_MODE ? "observe" : (process.env.ADAPTIVE_SIDE_LOSS_ACTION || "observe"),
    symbolBlockAfterLosses: Number(process.env.ADAPTIVE_SYMBOL_BLOCK_AFTER_LOSSES || 3),
    timeframeBlockAfterLosses: Number(process.env.ADAPTIVE_TIMEFRAME_BLOCK_AFTER_LOSSES || 4),
    sideBlockAfterLosses: Number(process.env.ADAPTIVE_SIDE_BLOCK_AFTER_LOSSES || 4),
    noStakeReductionMode: NO_STAKE_REDUCTION_MODE,
    noEntryReductionMode: NO_ENTRY_REDUCTION_MODE,
  };
}

function compactAdaptiveDecision(decision = {}) {
  return {
    approved: decision.approved !== false,
    reason: decision.reason || "adaptive_clear",
    mode: decision.mode || ADAPTIVE_MODE,
    stakeMultiplier: toNumber(decision.stakeMultiplier, 1),
    shadowStakeMultiplier: decision.shadowStakeMultiplier,
    matchedRules: (decision.matchedRules || []).map((rule) => ({
      id: rule.id,
      action: rule.action,
      condition: rule.condition,
      stakeMultiplier: rule.stakeMultiplier,
      losses: rule.losses,
      roi: rule.roi,
    })),
  };
}

function applyAdaptiveAvoidanceToPrediction(prediction, adaptiveState, accountRisk) {
  if (!ADAPTIVE_LEARNING_ENABLED || !prediction) {
    return {
      ...prediction,
      adaptiveLearning: adaptiveState || createEmptyAdaptiveLearningState(),
      adaptiveDecision: compactAdaptiveDecision({ approved: true, reason: "adaptive_disabled", stakeMultiplier: 1 }),
      adaptiveStakeMultiplier: 1,
    };
  }

  const signal = {
    title: prediction.title,
    slug: prediction.slug,
    side: prediction.predictedOutcome,
    direction: prediction.predictedOutcome,
    rank: prediction.rank,
    buyPrice: prediction.selectedBuyPrice,
    entryPrice: prediction.selectedBuyPrice,
    selectedSpreadCents: prediction.selectedSpreadCents,
    spreadCents: prediction.selectedSpreadCents,
    secondsIntoWindow: prediction.secondsIntoWindow,
    timeframe: prediction.timeframe,
  };
  const decision = evaluateAdaptiveAvoidance({
    signal,
    accountRisk,
    state: adaptiveState,
    config: buildAdaptiveConfig(),
  });
  const compactDecision = compactAdaptiveDecision(decision);

  if (!decision.approved) {
    return {
      ...prediction,
      tradeable: false,
      riskApproved: false,
      reason: decision.reason,
      riskReason: decision.reason,
      adaptiveLearning: adaptiveState,
      adaptiveDecision: compactDecision,
      adaptiveStakeMultiplier: 0,
      recommendedStakeUsd: 0,
    };
  }

  const multiplier = clamp(toNumber(decision.stakeMultiplier, 1), 0.05, 1);
  return {
    ...prediction,
    recommendedStakeUsd: Math.max(0.01, toNumber(prediction.recommendedStakeUsd, 0) * multiplier),
    adaptiveLearning: adaptiveState,
    adaptiveDecision: compactDecision,
    adaptiveStakeMultiplier: multiplier,
  };
}

function classifyAggressiveLearningRank({ confidence, edge, entryPrice, spreadCents }) {
  if (confidence >= 82 && edge >= 0.09 && entryPrice <= 0.72 && spreadCents <= 3) return "A+";
  if (confidence >= 78 && edge >= 0.07 && entryPrice <= 0.78 && spreadCents <= 4) return "A";
  if (confidence >= 72 && edge >= 0.04 && entryPrice <= 0.85 && spreadCents <= 6) return "B";
  if (confidence >= 68 && edge >= 0.025 && entryPrice <= 0.92 && spreadCents <= 8) return "C";
  return "SKIP";
}

function calculateBtcPrediction({ market, target, spot, prices, previousHistory, previousStats, previousSignals, lossCircuit, now }) {
  const priceDelta = spot.price - target.price;
  const priceDeltaPercent = target.price > 0 ? (priceDelta / target.price) * 100 : 0;
  const predictedOutcome = priceDelta >= 0 ? "Up" : "Down";
  const selectedBuyPrice = predictedOutcome === "Up" ? prices.upBuyPrice : prices.downBuyPrice;
  const selectedBidPrice = predictedOutcome === "Up" ? prices.upBidPrice : prices.downBidPrice;
  const oppositeBuyPrice = predictedOutcome === "Up" ? prices.downBuyPrice : prices.upBuyPrice;
  const selectedDepthShares = predictedOutcome === "Up" ? prices.upDepthShares : prices.downDepthShares;
  const requiredShares = selectedBuyPrice > 0 ? PAPER_MAX_TRADE_USD / selectedBuyPrice : 0;
  const requiredDepthShares = AGGRESSIVE_LEARNING_MODE
    ? Math.max(MIN_DEPTH_SHARES, requiredShares * 0.55)
    : Math.max(MIN_DEPTH_SHARES, requiredShares);
  const bookAgeMs = toNumber(prices.bookAgeMs, 0);
  const previousPoint = previousHistory.findLast((point) => point.slug === market.slug && point.currentPrice > 0);
  const momentum = previousPoint ? spot.price - previousPoint.currentPrice : 0;
  const distanceBps = target.price > 0 ? Math.abs(priceDelta / target.price) * 10_000 : 0;
  const timeLeftSec = Math.max(0, Math.round((market.windowEndMs - now) / 1_000));
  const secondsIntoWindow = Math.max(0, Math.round((now - market.windowStartMs) / 1_000));
  const selectedSpreadCents = selectedBuyPrice > 0 && selectedBidPrice > 0 ? (selectedBuyPrice - selectedBidPrice) * 100 : 0;
  const requiredDistanceBps = AGGRESSIVE_LEARNING_MODE
    ? ACTIVE_BTC_PREDICTION_MIN_DISTANCE_BPS
    : timeLeftSec > 180
      ? ACTIVE_BTC_PREDICTION_MIN_DISTANCE_BPS + 6
      : timeLeftSec > 120
        ? ACTIVE_BTC_PREDICTION_MIN_DISTANCE_BPS + 4
        : timeLeftSec > 60
          ? ACTIVE_BTC_PREDICTION_MIN_DISTANCE_BPS + 2
          : ACTIVE_BTC_PREDICTION_MIN_DISTANCE_BPS;
  const features = extractBtcFeatures({ market, target, spot, prices, previousHistory, now });
  const probability = predictProbability(features);
  const ev = evaluateEv({
    selectedProbability: probability.selectedProbability,
    selectedBuyPrice,
  });
  const confidence = clamp(probability.confidence, 1, 99);
  const selectedEdgePercent = ev.feeAdjustedEdge * 100;
  const selectedProbability = probability.selectedProbability;
  const feeAdjustedEdge = ev.feeAdjustedEdge;
  const grossEdge = ev.grossEdge;
  const feeEstimate = ev.feeEstimate;
  const strictRank = classifyRank({
    confidence,
    edge: feeAdjustedEdge,
    entryPrice: selectedBuyPrice,
    spreadCents: selectedSpreadCents,
  });
  const aggressiveRank = classifyAggressiveLearningRank({
    confidence,
    edge: feeAdjustedEdge,
    entryPrice: selectedBuyPrice,
    spreadCents: selectedSpreadCents,
  });
  const rank = AGGRESSIVE_LEARNING_MODE ? aggressiveRank : strictRank;
  const requiredConfidence = Math.max(
    ACTIVE_BTC_PREDICTION_MIN_CONFIDENCE,
    ACTIVE_BTC_PREDICTION_TARGET_WIN_RATE,
    selectedBuyPrice > 0 ? selectedBuyPrice * (100 + ACTIVE_BTC_PREDICTION_MIN_EDGE_PERCENT) : 0,
    ACTIVE_BTC_PREDICTION_MIN_SELECTED_PROBABILITY * 100,
  );
  const learnedGate = evaluateLearnedPredictionGate(previousStats, confidence);
  const momentumGate = evaluateMomentumAlignment(features);
  const stableTicks = [...(previousHistory || [])]
    .reverse()
    .filter((point) => point.slug === market.slug)
    .slice(0, 5)
    .reduce((count, point) => count + (point.predictedOutcome === predictedOutcome ? 1 : 0), 1);
  const accountRisk = accountRiskFromSignals(
    previousSignals || [],
    getBankrollFromStats(previousStats),
    PAPER_START_BALANCE,
    { activeWindowKey: market.slug },
  );
  const riskSignal = {
    feeAdjustedEdge,
    edge: feeAdjustedEdge,
    entryPrice: selectedBuyPrice,
    spreadCents: selectedSpreadCents,
    bookAgeMs,
    depthShares: selectedDepthShares,
    yesNoAskCost: features.yesNoAskCost,
    stableTicks,
    side: predictedOutcome.toUpperCase(),
    strategy: "current_prediction",
    secondsIntoWindow,
    timeLeftSec,
  };
  const riskDecision = evaluateRisk(riskSignal, accountRisk, {
    minEdge: ACTIVE_BTC_PREDICTION_MIN_FEE_ADJUSTED_EDGE,
    maxEntryPrice: AGGRESSIVE_LEARNING_MODE
      ? ACTIVE_BTC_PREDICTION_MAX_ENTRY_PRICE
      : Math.min(ACTIVE_BTC_PREDICTION_MAX_ENTRY_PRICE, FAST_GROWTH_MODE ? 0.78 : ACTIVE_BTC_PREDICTION_MAX_ENTRY_PRICE),
    maxSpreadCents: AGGRESSIVE_LEARNING_MODE
      ? ACTIVE_BTC_PREDICTION_MAX_SPREAD_CENTS
      : Math.min(ACTIVE_BTC_PREDICTION_MAX_SPREAD_CENTS, FAST_GROWTH_MODE ? 3 : ACTIVE_BTC_PREDICTION_MAX_SPREAD_CENTS),
    maxBookAgeMs: ACTIVE_BTC_PREDICTION_MAX_BOOK_AGE_MS,
    minDepthShares: requiredDepthShares,
    maxYesNoAskCost: ACTIVE_BTC_PREDICTION_MAX_YES_NO_ASK_COST,
    maxConsecutiveLosses: EFFECTIVE_MAX_CONSECUTIVE_LOSSES,
    maxDailyLossFraction: ACTIVE_MAX_DAILY_LOSS_FRACTION,
    maxActivePositions: MAX_ACTIVE_POSITIONS,
    maxPositionsPerWindow: MAX_POSITIONS_PER_WINDOW,
    maxSameSidePerWindow: MAX_SAME_SIDE_PER_WINDOW,
    maxStrategyPositionsPerWindow: MAX_STRATEGY_POSITIONS_PER_WINDOW,
    minValidEntryPrice: MIN_VALID_ENTRY_PRICE,
    minYesNoAskCost: MIN_YES_NO_ASK_COST,
    signalStableTicks: ACTIVE_BTC_PREDICTION_SIGNAL_STABLE_TICKS,
  });
  const accountEquity = getSizingEquity(accountRisk.balance || PAPER_START_BALANCE);
  const calibratedLane = legacyLaneFromRank(rank);
  const legacySizingCandidate = {
    lane: calibratedLane,
    calibratedLane,
    bookSource: prices.bookSource || "unknown",
    softQualityStakeMultiplier: 1,
    runtimeStakeMultiplier: 1,
  };
  const dynamicMaxTradeUsd = getDynamicMaxTradeUsd(accountEquity, calibratedLane, legacySizingCandidate);
  const equityStakeScale = getEquityStakeScale(accountEquity, legacySizingCandidate);
  const recommendedStakeUsd = sizeStake(accountEquity, { rank }, {
    maxStakeFractionAPlus: ACTIVE_MAX_STAKE_FRACTION_A_PLUS,
    maxStakeFractionA: ACTIVE_MAX_STAKE_FRACTION_A,
    maxStakeFractionB: ACTIVE_MAX_STAKE_FRACTION_B,
    maxStakeFractionC: ACTIVE_MAX_STAKE_FRACTION_C,
    maxTradeUsd: dynamicMaxTradeUsd,
    kellySizingEnabled: KELLY_SIZING_ENABLED,
    kellyFractionMultiplier: KELLY_FRACTION,
    kellyMaxFraction: KELLY_MAX_FRACTION,
    kellyMinFraction: KELLY_MIN_FRACTION,
  });

  let reason = "paper_signal_ready";
  if (!target.price || !spot.price) reason = "missing_price";
  else if (!String(target.source || "").startsWith("polymarket_")) reason = "weak_target_source";
  else if (bookAgeMs > ACTIVE_BTC_PREDICTION_MAX_BOOK_AGE_MS) reason = "stale_orderbook";
  else if (secondsIntoWindow < ACTIVE_BTC_PREDICTION_MIN_SECONDS_INTO_WINDOW) reason = "window_too_early";
  else if (secondsIntoWindow > ACTIVE_BTC_PREDICTION_MAX_SECONDS_INTO_WINDOW) reason = "window_too_late";
  else if (timeLeftSec <= ACTIVE_BTC_PREDICTION_MIN_SECONDS_LEFT) reason = "window_almost_closed";
  else if (!selectedBuyPrice) reason = "missing_clob_buy_price";
  else if (!selectedBidPrice) reason = "missing_clob_bid_price";
  else if (selectedBuyPrice > ACTIVE_BTC_PREDICTION_MAX_ENTRY_PRICE) reason = "entry_price_too_high";
  else if (selectedSpreadCents > ACTIVE_BTC_PREDICTION_MAX_SPREAD_CENTS) reason = "spread_too_wide";
  else if (selectedDepthShares < requiredDepthShares) reason = "insufficient_directional_depth";
  else if (features.yesNoAskCost > ACTIVE_BTC_PREDICTION_MAX_YES_NO_ASK_COST) reason = "bad_complete_set_cost";
  else if (distanceBps < requiredDistanceBps) reason = "price_too_close_to_target";
  else if (features.volatilityAdjustedDistance < ACTIVE_BTC_PREDICTION_MIN_VOL_ADJ_DISTANCE) reason = "distance_not_significant_vs_volatility";
  else if (!momentumGate.allowed) reason = momentumGate.reason;
  else if (confidence < requiredConfidence) reason = "confidence_below_threshold";
  else if (selectedProbability < ACTIVE_BTC_PREDICTION_MIN_SELECTED_PROBABILITY) reason = "probability_below_threshold";
  else if (feeAdjustedEdge < ACTIVE_BTC_PREDICTION_MIN_FEE_ADJUSTED_EDGE) reason = "fee_adjusted_ev_below_threshold";
  else if (selectedEdgePercent < ACTIVE_BTC_PREDICTION_MIN_EDGE_PERCENT) reason = "paper_ev_below_threshold";
  else if (rank === "SKIP") reason = "signal_rank_too_low";
  else if (!learnedGate.allowed) reason = learnedGate.reason;
  else if (!riskDecision.approved) reason = riskDecision.reason;
  else if (lossCircuit?.blocked) reason = "paper_loss_circuit";

  return {
    timeLeftSec,
    secondsIntoWindow,
    priceDelta,
    priceDeltaPercent,
    predictedOutcome,
    selectedBuyPrice,
    selectedBidPrice,
    selectedSpreadCents,
    paperFillShares: Math.min(selectedDepthShares || 0, requiredShares || 0),
    selectedEdgePercent,
    distanceBps,
    requiredDistanceBps,
    requiredConfidence,
    learnedBucket: learnedGate.bucket?.label || "",
    learnedBucketRoi: learnedGate.bucket?.roi || 0,
    learnedBucketWinRate: learnedGate.bucket?.winRate || 0,
    learnedBucketBreakEven: learnedGate.bucket?.breakEvenAccuracy || 0,
    lossCircuitLosses: lossCircuit?.lossCount || 0,
    lossCircuitSamples: lossCircuit?.sampleCount || 0,
    probabilityUp: probability.probabilityUp,
    probabilityDown: probability.probabilityDown,
    selectedProbability,
    feeAdjustedEdge,
    grossEdge,
    feeEstimate,
    rank,
    strictRank,
    aggressiveRank,
    momentum15Bps: features.momentum15Bps,
    momentum30Bps: features.momentum30Bps,
    momentum60Bps: features.momentum60Bps,
    volatility60Bps: features.volatility60Bps,
    volatilityAdjustedDistance: features.volatilityAdjustedDistance,
    selectedBookImbalance: features.selectedBookImbalance,
    selectedDepthPressure: features.selectedDepthPressure,
    sideDepthAdvantage: features.sideDepthAdvantage,
    selectedMicropriceEdgeCents: features.selectedMicropriceEdgeCents,
    selectedAskSlopeCents: features.selectedAskSlopeCents,
    upDepthPressure: features.upDepthPressure,
    downDepthPressure: features.downDepthPressure,
    upAskDepth5: features.upAskDepth5,
    downAskDepth5: features.downAskDepth5,
    upBidDepth5: features.upBidDepth5,
    downBidDepth5: features.downBidDepth5,
    upMicropriceEdgeCents: features.upMicropriceEdgeCents,
    downMicropriceEdgeCents: features.downMicropriceEdgeCents,
    upAskSlopeCents: features.upAskSlopeCents,
    downAskSlopeCents: features.downAskSlopeCents,
    micropriceConfirmation: features.micropriceConfirmation,
    yesNoAskCost: features.yesNoAskCost,
    bidCost: features.bidCost,
    stableTicks,
    riskApproved: riskDecision.approved,
    riskReason: riskDecision.reason,
    riskProfile: RISK_PROFILE,
    aggressiveLearningMode: AGGRESSIVE_LEARNING_MODE,
    recommendedStakeUsd,
    paperMaxTradeUsd: dynamicMaxTradeUsd,
    dynamicMaxTradeUsd,
    accountEquity,
    equityStakeScale,
    equityScaledLaneCapUsd: calibratedLane === "S"
      ? scaleStakeCapForEquity(EDGE_ENGINE_LANE_S_MAX_STAKE_USD, accountEquity, legacySizingCandidate)
      : calibratedLane === "A"
        ? scaleStakeCapForEquity(EDGE_ENGINE_LANE_A_MAX_STAKE_USD, accountEquity, legacySizingCandidate)
        : EDGE_ENGINE_LANE_B_MAX_STAKE_USD,
    calibratedLane,
    activePositions: accountRisk.activePositions,
    positionsThisWindow: accountRisk.positionsThisWindow,
    sameSideUpThisWindow: accountRisk.sameSideUpThisWindow,
    sameSideDownThisWindow: accountRisk.sameSideDownThisWindow,
    confidence,
    reason,
    tradeable: reason === "paper_signal_ready",
  };
}

function classifyDirectionalPredictionRank({ confidence, edge, entryPrice, spreadCents }) {
  return classifyAggressiveLearningRank({ confidence, edge, entryPrice, spreadCents });
}

function calculateDirectionalMarketPrediction({ market, prices, externalAnchor = {}, previousHistory, previousStats, previousSignals, lossCircuit, now }) {
  const bookAgeMs = toNumber(prices.bookAgeMs, 0);
  const upDepthDiagnostics = prices.upDepthDiagnostics || {};
  const downDepthDiagnostics = prices.downDepthDiagnostics || {};
  const timeLeftSec = Math.max(0, Math.round((market.windowEndMs - now) / 1_000));
  const secondsIntoWindow = Math.max(0, Math.round((now - market.windowStartMs) / 1_000));
  const independentModel = calculateIndependentDigitalProbability({
    currentPrice: externalAnchor.currentPrice,
    strikePrice: externalAnchor.priceToBeat,
    timeLeftSec,
    oneSecondLogReturns: getExternalOneSecondLogReturns(market.symbol, now),
    minReturnSamples: V372_EXTERNAL_MIN_RETURN_SAMPLES,
    prices,
  });
  const probabilityUp = independentModel.available ? independentModel.probabilityUp : 0.50;
  const probabilityDown = independentModel.available ? independentModel.probabilityDown : 0.50;
  const predictedOutcome = probabilityUp >= probabilityDown ? "Up" : "Down";
  const selectedBuyPrice = predictedOutcome === "Up" ? prices.upBuyPrice : prices.downBuyPrice;
  const selectedBidPrice = predictedOutcome === "Up" ? prices.upBidPrice : prices.downBidPrice;
  const selectedDepthShares = predictedOutcome === "Up" ? prices.upDepthShares : prices.downDepthShares;
  const selectedProbability = predictedOutcome === "Up" ? probabilityUp : probabilityDown;
  const ev = evaluateEv({
    selectedProbability,
    selectedBuyPrice,
    feeRate: toNumber(market.takerFeeRate, PAPER_CRYPTO_TAKER_FEE_RATE),
    slippageBuffer: PAPER_MAX_SLIPPAGE_CENTS / 100,
  });
  const selectedSpreadCents = selectedBuyPrice > 0 && selectedBidPrice > 0 ? (selectedBuyPrice - selectedBidPrice) * 100 : 0;
  const confidence = clamp(selectedProbability * 100, 1, 99);
  const feeAdjustedEdge = ev.feeAdjustedEdge;
  const rank = classifyDirectionalPredictionRank({
    confidence,
    edge: feeAdjustedEdge,
    entryPrice: selectedBuyPrice,
    spreadCents: selectedSpreadCents,
  });
  const stableTicks = [...(previousHistory || [])]
    .reverse()
    .filter((point) => point.slug === market.slug)
    .slice(0, 5)
    .reduce((count, point) => count + (point.predictedOutcome === predictedOutcome ? 1 : 0), 1);
  const upSpreadCents = Math.max(0, (toNumber(prices.upBuyPrice) - toNumber(prices.upBidPrice)) * 100);
  const downSpreadCents = Math.max(0, (toNumber(prices.downBuyPrice) - toNumber(prices.downBidPrice)) * 100);
  const yesNoAskCost = toNumber(prices.upBuyPrice) + toNumber(prices.downBuyPrice);
  const bidCost = toNumber(prices.upBidPrice) + toNumber(prices.downBidPrice);
  const upDepthPressure = toNumber(upDepthDiagnostics.bidAskPressure);
  const downDepthPressure = toNumber(downDepthDiagnostics.bidAskPressure);
  const selectedDepthPressure = predictedOutcome === "Up" ? upDepthPressure : downDepthPressure;
  const oppositeDepthPressure = predictedOutcome === "Up" ? downDepthPressure : upDepthPressure;
  const sideDepthAdvantage = selectedDepthPressure - oppositeDepthPressure;
  const selectedMicropriceEdgeCents = predictedOutcome === "Up"
    ? toNumber(upDepthDiagnostics.micropriceEdgeCents)
    : toNumber(downDepthDiagnostics.micropriceEdgeCents);
  const selectedAskSlopeCents = predictedOutcome === "Up"
    ? toNumber(upDepthDiagnostics.askSlopeCents)
    : toNumber(downDepthDiagnostics.askSlopeCents);
  const distanceBps = externalAnchor.currentPrice > 0 && externalAnchor.priceToBeat > 0
    ? Math.abs(Math.log(externalAnchor.currentPrice / externalAnchor.priceToBeat)) * 10_000
    : 0;
  const volatility60Bps = toNumber(independentModel.volatilityPerSecondBps, 0);
  const accountRisk = accountRiskFromSignals(
    previousSignals || [],
    getBankrollFromStats(previousStats),
    PAPER_START_BALANCE,
    { activeWindowKey: market.slug },
  );
  const riskDecision = evaluateRisk({
    feeAdjustedEdge,
    edge: feeAdjustedEdge,
    entryPrice: selectedBuyPrice,
    spreadCents: selectedSpreadCents,
    bookAgeMs,
    depthShares: selectedDepthShares,
    yesNoAskCost,
    stableTicks,
    side: predictedOutcome.toUpperCase(),
    strategy: "dual_side_ev",
    secondsIntoWindow,
    timeLeftSec,
  }, accountRisk, {
    minEdge: ACTIVE_BTC_PREDICTION_MIN_FEE_ADJUSTED_EDGE,
    maxEntryPrice: ACTIVE_BTC_PREDICTION_MAX_ENTRY_PRICE,
    maxSpreadCents: ACTIVE_BTC_PREDICTION_MAX_SPREAD_CENTS,
    maxBookAgeMs: ACTIVE_BTC_PREDICTION_MAX_BOOK_AGE_MS,
    minDepthShares: MIN_DEPTH_SHARES,
    maxYesNoAskCost: ACTIVE_BTC_PREDICTION_MAX_YES_NO_ASK_COST,
    maxConsecutiveLosses: EFFECTIVE_MAX_CONSECUTIVE_LOSSES,
    maxDailyLossFraction: ACTIVE_MAX_DAILY_LOSS_FRACTION,
    maxActivePositions: MAX_ACTIVE_POSITIONS,
    maxPositionsPerWindow: MAX_POSITIONS_PER_WINDOW,
    maxSameSidePerWindow: MAX_SAME_SIDE_PER_WINDOW,
    maxStrategyPositionsPerWindow: MAX_STRATEGY_POSITIONS_PER_WINDOW,
    minValidEntryPrice: MIN_VALID_ENTRY_PRICE,
    minYesNoAskCost: MIN_YES_NO_ASK_COST,
    signalStableTicks: ACTIVE_BTC_PREDICTION_SIGNAL_STABLE_TICKS,
  });
  const accountEquity = getSizingEquity(accountRisk.balance || PAPER_START_BALANCE);
  const calibratedLane = legacyLaneFromRank(rank);
  const legacySizingCandidate = {
    lane: calibratedLane,
    calibratedLane,
    bookSource: prices.bookSource || "unknown",
    softQualityStakeMultiplier: 1,
    runtimeStakeMultiplier: 1,
  };
  const dynamicMaxTradeUsd = getDynamicMaxTradeUsd(accountEquity, calibratedLane, legacySizingCandidate);
  const equityStakeScale = getEquityStakeScale(accountEquity, legacySizingCandidate);
  const recommendedStakeUsd = sizeStake(accountEquity, { rank }, {
    maxStakeFractionAPlus: ACTIVE_MAX_STAKE_FRACTION_A_PLUS,
    maxStakeFractionA: ACTIVE_MAX_STAKE_FRACTION_A,
    maxStakeFractionB: ACTIVE_MAX_STAKE_FRACTION_B,
    maxStakeFractionC: ACTIVE_MAX_STAKE_FRACTION_C,
    maxTradeUsd: dynamicMaxTradeUsd,
    kellySizingEnabled: KELLY_SIZING_ENABLED,
    kellyFractionMultiplier: KELLY_FRACTION,
    kellyMaxFraction: KELLY_MAX_FRACTION,
    kellyMinFraction: KELLY_MIN_FRACTION,
  });
  const learnedGate = evaluateLearnedPredictionGate(previousStats, confidence);

  let reason = "paper_signal_ready";
  if (V372_REQUIRE_EXTERNAL_ANCHOR && !independentModel.available) reason = independentModel.reason || "missing_external_price_anchor";
  else if (!selectedBuyPrice) reason = "missing_clob_buy_price";
  else if (!selectedBidPrice) reason = "missing_clob_bid_price";
  else if (ENTRY_DROP_STALE_RESULT && bookAgeMs > ENTRY_MAX_BOOK_AGE_MS) reason = "stale_entry_book_after_refresh";
  else if (bookAgeMs > ACTIVE_BTC_PREDICTION_MAX_BOOK_AGE_MS) reason = "stale_orderbook";
  else if (secondsIntoWindow < ACTIVE_BTC_PREDICTION_MIN_SECONDS_INTO_WINDOW) reason = "window_too_early";
  else if (secondsIntoWindow > ACTIVE_BTC_PREDICTION_MAX_SECONDS_INTO_WINDOW) reason = "window_too_late";
  else if (timeLeftSec <= ACTIVE_BTC_PREDICTION_MIN_SECONDS_LEFT) reason = "window_almost_closed";
  else if (selectedBuyPrice > ACTIVE_BTC_PREDICTION_MAX_ENTRY_PRICE) reason = "entry_price_too_high";
  else if (selectedSpreadCents > ACTIVE_BTC_PREDICTION_MAX_SPREAD_CENTS) reason = "spread_too_wide";
  else if (selectedDepthShares < MIN_DEPTH_SHARES) reason = "insufficient_directional_depth";
  else if (yesNoAskCost > ACTIVE_BTC_PREDICTION_MAX_YES_NO_ASK_COST) reason = "bad_complete_set_cost";
  else if (confidence < Math.max(ACTIVE_BTC_PREDICTION_MIN_CONFIDENCE, ACTIVE_BTC_PREDICTION_MIN_SELECTED_PROBABILITY * 100)) reason = "confidence_below_threshold";
  else if (selectedProbability < ACTIVE_BTC_PREDICTION_MIN_SELECTED_PROBABILITY) reason = "probability_below_threshold";
  else if (feeAdjustedEdge < ACTIVE_BTC_PREDICTION_MIN_FEE_ADJUSTED_EDGE) reason = "fee_adjusted_ev_below_threshold";
  else if (rank === "SKIP") reason = "signal_rank_too_low";
  else if (!learnedGate.allowed) reason = learnedGate.reason;
  else if (!riskDecision.approved) reason = riskDecision.reason;
  else if (lossCircuit?.blocked) reason = "paper_loss_circuit";

  return {
    symbol: market.symbol,
    timeframe: market.timeframe,
    marketFamily: market.marketFamily,
    scannerScore: market.scannerScore,
    scannerEdgePercent: market.scannerEdgePercent,
    scannerStatus: market.scannerStatus,
    predictionEngine: "v3745_regime_core_independent_asset_probability",
    timeLeftSec,
    secondsIntoWindow,
    currentPrice: toNumber(externalAnchor.currentPrice, 0),
    priceToBeat: toNumber(externalAnchor.priceToBeat, 0),
    referencePriceStatus: externalAnchor.referencePriceStatus || "unavailable",
    currentPriceAgeMs: externalAnchor.currentPriceAgeMs ?? null,
    priceDelta: toNumber(externalAnchor.priceDelta, 0),
    priceDeltaPercent: toNumber(externalAnchor.priceDeltaPercent, 0),
    predictedOutcome,
    selectedBuyPrice,
    selectedBidPrice,
    selectedSpreadCents,
    paperFillShares: selectedBuyPrice > 0 ? Math.min(selectedDepthShares || 0, dynamicMaxTradeUsd / selectedBuyPrice) : 0,
    selectedEdgePercent: feeAdjustedEdge * 100,
    distanceBps,
    requiredDistanceBps: 0,
    requiredConfidence: Math.max(ACTIVE_BTC_PREDICTION_MIN_CONFIDENCE, ACTIVE_BTC_PREDICTION_MIN_SELECTED_PROBABILITY * 100),
    learnedBucket: learnedGate.bucket?.label || "",
    learnedBucketRoi: learnedGate.bucket?.roi || 0,
    learnedBucketWinRate: learnedGate.bucket?.winRate || 0,
    learnedBucketBreakEven: learnedGate.bucket?.breakEvenAccuracy || 0,
    lossCircuitLosses: lossCircuit?.lossCount || 0,
    lossCircuitSamples: lossCircuit?.sampleCount || 0,
    probabilityUp,
    probabilityDown,
    pAssetUp: independentModel.probabilityUp ?? null,
    pMarketUp: prices.upMidPrice > 0 && prices.downMidPrice > 0
      ? prices.upMidPrice / (prices.upMidPrice + prices.downMidPrice)
      : null,
    pFinalUp: independentModel.probabilityUp ?? null,
    calibrationStatus: "legacy_dual_transform_conservative_cap_pending_asset_forward_calibration",
    selectedProbability,
    feeAdjustedEdge,
    grossEdge: ev.grossEdge,
    feeEstimate: ev.feeEstimate,
    rank,
    strictRank: rank,
    aggressiveRank: rank,
    momentum15Bps: toNumber(externalAnchor.momentum15Bps, 0),
    momentum30Bps: toNumber(externalAnchor.momentum30Bps, 0),
    momentum60Bps: toNumber(externalAnchor.momentum60Bps, 0),
    volatility60Bps,
    volatilityAdjustedDistance: Math.abs(toNumber(independentModel.zScore, 0)),
    independentProbabilityModel: independentModel,
    selectedBookImbalance: sideDepthAdvantage,
    selectedDepthPressure,
    sideDepthAdvantage,
    selectedMicropriceEdgeCents,
    selectedAskSlopeCents,
    upDepthPressure,
    downDepthPressure,
    upAskDepth5: toNumber(upDepthDiagnostics.askDepth5),
    downAskDepth5: toNumber(downDepthDiagnostics.askDepth5),
    upBidDepth5: toNumber(upDepthDiagnostics.bidDepth5),
    downBidDepth5: toNumber(downDepthDiagnostics.bidDepth5),
    upMicropriceEdgeCents: toNumber(upDepthDiagnostics.micropriceEdgeCents),
    downMicropriceEdgeCents: toNumber(downDepthDiagnostics.micropriceEdgeCents),
    upAskSlopeCents: toNumber(upDepthDiagnostics.askSlopeCents),
    downAskSlopeCents: toNumber(downDepthDiagnostics.askSlopeCents),
    micropriceConfirmation: selectedMicropriceEdgeCents,
    yesNoAskCost,
    bidCost,
    stableTicks,
    riskApproved: riskDecision.approved,
    riskReason: riskDecision.reason,
    riskProfile: RISK_PROFILE,
    aggressiveLearningMode: AGGRESSIVE_LEARNING_MODE,
    recommendedStakeUsd,
    paperMaxTradeUsd: dynamicMaxTradeUsd,
    dynamicMaxTradeUsd,
    accountEquity,
    equityStakeScale,
    equityScaledLaneCapUsd: calibratedLane === "S"
      ? scaleStakeCapForEquity(EDGE_ENGINE_LANE_S_MAX_STAKE_USD, accountEquity, legacySizingCandidate)
      : calibratedLane === "A"
        ? scaleStakeCapForEquity(EDGE_ENGINE_LANE_A_MAX_STAKE_USD, accountEquity, legacySizingCandidate)
        : EDGE_ENGINE_LANE_B_MAX_STAKE_USD,
    calibratedLane,
    activePositions: accountRisk.activePositions,
    positionsThisWindow: accountRisk.positionsThisWindow,
    sameSideUpThisWindow: accountRisk.sameSideUpThisWindow,
    sameSideDownThisWindow: accountRisk.sameSideDownThisWindow,
    confidence,
    reason,
    tradeable: reason === "paper_signal_ready",
  };
}

function getDirectionalPredictionCandidates(scanResult = {}, now = Date.now()) {
  if (!MULTI_ASSET_PREDICTION_ENABLED) return [];
  const ranked = rankOpportunities(scanResult.evaluatedMarkets || []);
  const baseCandidates = ranked
    .map((market) => normalizeDirectionalPredictionMarket(market, now))
    .filter(Boolean)
    .filter((market) => MULTI_ASSET_PREDICTION_SYMBOLS.includes(String(market.symbol || "").toUpperCase()))
    .filter((market) => MULTI_ASSET_PREDICTION_TIMEFRAMES.includes(String(market.timeframe || "").toUpperCase()))
    .filter((market) => market.marketFamily === "DIRECTIONAL")
    .filter((market) => market.windowStartMs <= now && now < market.windowEndMs - ACTIVE_BTC_PREDICTION_MIN_SECONDS_LEFT * 1_000)
    .filter((market) => {
      const secondsIntoWindow = Math.round((now - market.windowStartMs) / 1_000);
      return secondsIntoWindow >= MULTI_ASSET_MIN_SECONDS_INTO_WINDOW &&
        secondsIntoWindow <= MULTI_ASSET_MAX_SECONDS_INTO_WINDOW;
    })
    .filter((market) => market.scannerScore >= MULTI_ASSET_MIN_SCANNER_SCORE)
    .filter((market) => market.scannerEdgePercent >= MULTI_ASSET_MIN_EDGE_PERCENT);

  if (!baseCandidates.length) return [];

  const strictCandidates = baseCandidates.filter((market) => market.scannerStatus === "opportunity");
  const fallbackMinScore = Math.max(MULTI_ASSET_MIN_SCANNER_SCORE, 55);
  const fallbackCandidates = baseCandidates.filter((market) => market.scannerScore >= fallbackMinScore);
  const candidateMap = new Map();
  for (const market of [...strictCandidates, ...fallbackCandidates]) {
    const key = market.conditionId || market.slug || `${market.symbol}:${market.timeframe}:${market.windowStartMs}`;
    if (!candidateMap.has(key)) candidateMap.set(key, market);
  }
  const candidates = candidateMap.size ? [...candidateMap.values()] : baseCandidates;

  return candidates.sort((left, right) => {
    const leftOpportunity = left.scannerStatus === "opportunity" ? 1 : 0;
    const rightOpportunity = right.scannerStatus === "opportunity" ? 1 : 0;
    const leftOpportunityBonus = MULTI_ASSET_ROUTE_OPPORTUNITY_FIRST ? leftOpportunity * 40 : 0;
    const rightOpportunityBonus = MULTI_ASSET_ROUTE_OPPORTUNITY_FIRST ? rightOpportunity * 40 : 0;
    const leftScore = toNumber(left.scannerScore, 0) + Math.max(0, toNumber(left.scannerEdgePercent, 0)) * 2 + leftOpportunityBonus;
    const rightScore = toNumber(right.scannerScore, 0) + Math.max(0, toNumber(right.scannerEdgePercent, 0)) * 2 + rightOpportunityBonus;
    if (rightScore !== leftScore) return rightScore - leftScore;
    if (right.scannerScore !== left.scannerScore) return right.scannerScore - left.scannerScore;
    return right.scannerEdgePercent - left.scannerEdgePercent;
  });
}

function selectDirectionalPredictionMarket(scanResult = {}, now = Date.now()) {
  return getDirectionalPredictionCandidates(scanResult, now)[0] || null;
}

function directionalPreviewQualityScore(prediction = {}) {
  const depthPressure = toNumber(prediction.selectedDepthPressure, 0);
  const depthAdvantage = toNumber(prediction.sideDepthAdvantage, 0);
  const micropriceEdgeCents = toNumber(prediction.selectedMicropriceEdgeCents, 0);
  const spreadCents = toNumber(prediction.selectedSpreadCents, 0);
  const selectedBuyPrice = toNumber(prediction.selectedBuyPrice, 0);
  const edge = toNumber(prediction.feeAdjustedEdge, 0);
  const edgePercent = toNumber(prediction.selectedEdgePercent, edge * 100);
  const secondsIntoWindow = toNumber(prediction.secondsIntoWindow, 0);
  const confidence = toNumber(prediction.confidence, 0);
  const bookAgeMs = toNumber(prediction.bookAgeMs, 0);
  const positiveConfirmations = [
    depthPressure >= 0,
    depthAdvantage >= 0.10,
    micropriceEdgeCents >= 0.02,
  ].filter(Boolean).length;
  const adverseConfirmations = [
    depthPressure < -0.05,
    depthAdvantage < -0.10,
    micropriceEdgeCents < -0.02,
  ].filter(Boolean).length;

  let score = 0;
  score += confidence * 0.30;
  score += Math.max(0, edgePercent) * 1.2;
  score += positiveConfirmations * 18;
  score -= adverseConfirmations * 30;
  score += Math.max(0, depthPressure) * 16;
  score += Math.max(0, depthAdvantage) * 22;
  score += Math.max(0, micropriceEdgeCents) * 4;
  score -= Math.max(0, spreadCents - 2) * 3;
  score -= bookAgeMs / 750;
  if (edgePercent >= QUALITY_INFLATED_EDGE_PERCENT && positiveConfirmations < 2) score -= 35;
  if (secondsIntoWindow >= QUALITY_LATE_WEAK_BOOK_SECONDS && selectedBuyPrice >= QUALITY_LATE_WEAK_BOOK_ENTRY_PRICE && depthAdvantage < 0.35) score -= 25;
  return score;
}

function normalizedPredictionSide(value = "") {
  const side = String(value || "").trim().toUpperCase();
  if (side === "UP" || side === "YES" || side === "HIGHER" || side === "ABOVE") return "UP";
  if (side === "DOWN" || side === "NO" || side === "LOWER" || side === "BELOW") return "DOWN";
  return side;
}

function scoreAccuracyBucket(input = {}) {
  if (!ACCURACY_RERANKER_ENABLED) return { score: 0, reasons: ["accuracy_reranker_disabled"] };
  const side = normalizedPredictionSide(input.side || input.predictedOutcome);
  const strategy = String(input.strategy || input.selectedStrategy || "dual_side_ev");
  const price = toNumber(input.entryPrice ?? input.selectedBuyPrice, 0);
  const seconds = toNumber(input.secondsIntoWindow, 0);
  const bookAgeMs = toNumber(input.bookAgeMs, 0);
  const spreadCents = toNumber(input.spreadCents ?? input.selectedSpreadCents, 0);
  const depthAdvantage = toNumber(input.depthAdvantage ?? input.sideDepthAdvantage, 0);
  const microEdge = toNumber(input.micropriceEdgeCents ?? input.selectedMicropriceEdgeCents, 0);
  const reasons = [];
  let score = 0;

  if (strategy === "dual_side_ev") { score += 24; reasons.push("acc_dual_side_ev_positive"); }
  else if (strategy) { score -= 18; reasons.push("acc_non_dual_side_lower_priority"); }

  if (seconds >= 45 && seconds < 60) { score += 24; reasons.push("acc_window_45_60_boost"); }
  else if (side === "UP" && seconds >= 60 && seconds < 75) { score += 18; reasons.push("acc_up_60_75_boost"); }
  else if (seconds >= 75 && seconds < 90) { score -= 20; reasons.push("acc_window_75_90_penalty"); }
  else if (seconds >= 180) { score -= 28; reasons.push("acc_window_180_plus_penalty"); }

  if (side === "UP" && price >= 0.70 && price < 0.76) { score += 22; reasons.push("acc_up_price_070_076_boost"); }
  if (side === "UP" && price >= 0.50 && price < 0.55) { score += 14; reasons.push("acc_up_price_050_054_boost"); }
  if (side === "DOWN" && price >= 0.66 && price < 0.70) { score += 18; reasons.push("acc_down_price_066_070_boost"); }
  if (side === "DOWN" && price >= 0.58 && price < 0.62) { score -= 24; reasons.push("acc_down_price_058_062_penalty"); }
  if (side === "UP" && price >= 0.66 && price < 0.70) { score -= 22; reasons.push("acc_up_price_066_070_penalty"); }

  if (bookAgeMs > ENTRY_MAX_BOOK_AGE_MS) { score -= 18; reasons.push("acc_stale_entry_book_penalty"); }
  if (spreadCents > 5) { score -= 10; reasons.push("acc_wide_spread_penalty"); }
  if (depthAdvantage >= 0) score += 6;
  else { score -= 10; reasons.push("acc_adverse_depth_penalty"); }
  if (microEdge >= 0) score += 5;
  else { score -= 8; reasons.push("acc_adverse_microprice_penalty"); }

  return {
    score: clamp(score, -ACCURACY_RERANKER_MAX_ADJUSTMENT, ACCURACY_RERANKER_MAX_ADJUSTMENT),
    reasons,
  };
}

let cachedBootstrapRuleCache = null;
function getCrossRunStableScore(candidate) {
  if (process.env.BOOTSTRAP_LEARNING_ENABLED !== "1") return 0;
  if (!cachedBootstrapRuleCache) {
    try {
      const cachePath = path.join(process.cwd(), "server", "learning", "bootstrapRuntimeRuleCache.json");
      if (fs.existsSync(cachePath)) {
        cachedBootstrapRuleCache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      }
    } catch (err) {
      return 0;
    }
  }
  if (!cachedBootstrapRuleCache || !cachedBootstrapRuleCache.buckets) return 0;
  
  let scoreAdj = 0;
  const price = toNumber(candidate.entryPrice ?? candidate.selectedBuyPrice ?? candidate.price, 0);
  const confidence = toNumber(candidate.confidence, 0);
  
  for (const [key, bucket] of Object.entries(cachedBootstrapRuleCache.buckets)) {
    const [type, value] = key.split(":");
    if (!type || !value) continue;
    
    let matched = false;
    if (type === "side" && String(candidate.side || "").toUpperCase() === value.toUpperCase()) matched = true;
    if (type === "symbol" && String(candidate.symbol || "").toUpperCase() === value.toUpperCase()) matched = true;
    if (type === "timeframe" && String(candidate.timeframe || "").toUpperCase() === value.toUpperCase()) matched = true;
    if (type === "strategy" && String(candidate.strategy || "").toUpperCase() === value.toUpperCase()) matched = true;
    if (type === "price") {
      const [min, max] = value.split("_").map(Number);
      if (price >= min && price <= max) matched = true;
    }
    if (type === "confidence") {
      const [min, max] = value.split("_").map(Number);
      if (confidence >= min && confidence <= max) matched = true;
    }
    
    if (matched) {
      scoreAdj += toNumber(bucket.scoreAdjustment, 0);
    }
  }
  return clamp(scoreAdj, -30, 30);
}

function calculateRecencyScore(candidate, signals = []) {
  if (!Array.isArray(signals) || signals.length < 40) return 0;
  
  const symbol = String(candidate.symbol || "").toUpperCase();
  const timeframe = String(candidate.timeframe || "").toUpperCase();
  
  const symbolSignals = signals.filter(s => String(s.symbol || "").toUpperCase() === symbol);
  const timeframeSignals = signals.filter(s => String(s.timeframe || "").toUpperCase() === timeframe);
  
  let recencyScore = 0;
  
  const evaluateBucket = (bucketSignals) => {
    if (bucketSignals.length < 40) return 0;
    const wins = bucketSignals.filter(s => s.status === "paper_win").length;
    const settled = bucketSignals.length;
    const winRate = (wins / settled) * 100;
    const pnl = bucketSignals.reduce((sum, s) => sum + toNumber(s.paperPnlUsd, 0), 0);
    
    if (winRate >= 60 && pnl > 0) {
      return Math.min(25, (winRate - 55) * 2);
    }
    if (winRate <= 48 && pnl < 0) {
      return -Math.min(35, (50 - winRate) * 2.5);
    }
    return 0;
  };
  
  recencyScore += evaluateBucket(symbolSignals);
  recencyScore += evaluateBucket(timeframeSignals);
  
  return clamp(recencyScore, -35, 25);
}

function calculateRegimePenalty(candidate, signals = []) {
  if (!Array.isArray(signals) || signals.length < 20) return 0;
  const wins = signals.filter(s => s.status === "paper_win").length;
  const settled = signals.length;
  const winRate = (wins / settled) * 100;
  
  if (winRate < 50) {
    const price = toNumber(candidate.entryPrice ?? candidate.selectedBuyPrice ?? candidate.price, 0);
    const confidence = toNumber(candidate.confidence, 0);
    const isHighProb = (price >= 0.55 && price <= 0.59) || (confidence >= 80);
    if (!isHighProb) {
      return -20;
    }
  }
  return 0;
}

function scoreV361Capped(candidate = {}, context = {}) {
  const strategy = candidate.strategy || context.strategy || "dual_side_ev";
  const side = String(candidate.side || candidate.direction || context.predictedOutcome || "").toUpperCase();
  const price = toNumber(candidate.entryPrice ?? candidate.selectedBuyPrice ?? candidate.price, 0);
  const confidence = toNumber(candidate.confidence ?? context.confidence, 0);
  const seconds = toNumber(candidate.secondsIntoWindow ?? context.secondsIntoWindow, 0);
  const depth = toNumber(candidate.depthShares ?? candidate.selectedDepthShares, 0);
  const symbol = String(candidate.symbol || context.symbol || "").toUpperCase();
  const timeframe = String(candidate.timeframe || context.timeframe || "").toUpperCase();

  let score = 0;
  let reasons = [];

  // Boost rules
  const microEdge = toNumber(candidate.micropriceEdgeCents ?? candidate.selectedMicropriceEdgeCents ?? context.micropriceEdgeCents, 0);
  if (price >= 0.55 && price <= 0.59 && microEdge >= 0 && microEdge <= 0.09) {
    score += 95;
    reasons.push("v361_boost_price_micro");
  }
  if (timeframe === "15M" && price >= 0.55 && price <= 0.59 && strategy === "dual_side_ev") {
    score += 90;
    reasons.push("v361_boost_15m_price_ev");
  }
  if (depth >= 500 && side === "DOWN" && timeframe === "5M") {
    score += 85;
    reasons.push("v361_boost_depth_down_5m");
  }
  if (price >= 0.55 && price <= 0.59 && confidence >= 80 && confidence <= 84) {
    score += 70;
    reasons.push("v361_boost_price_confidence");
  }
  if (symbol === "BNB" && timeframe === "15M") {
    score += 55;
    reasons.push("v361_boost_bnb_15m");
  }
  if (confidence >= 90 && confidence <= 94 && side === "UP" && strategy === "dual_side_ev") {
    score += 45;
    reasons.push("v361_boost_confidence_up_ev");
  }
  if (price >= 0.55 && price <= 0.59) {
    score += 35;
    reasons.push("v361_boost_base_price");
  }
  const rank = String(candidate.rank || "SKIP").toUpperCase();
  if (microEdge < -0.25 && rank === "B") {
    score += 25;
    reasons.push("v361_boost_micro_rank_b");
  }
  if (price >= 0.55 && price <= 0.59 && seconds >= 15 && seconds <= 29 && strategy === "dual_side_ev") {
    score += 15;
    reasons.push("v361_boost_seconds_price_ev");
  }

  // Penalty rules
  const pressure = toNumber(candidate.depthPressure ?? candidate.selectedDepthPressure ?? context.depthPressure, 0);
  if (rank === "C" && side === "DOWN" && pressure < 0.10) {
    score -= 90;
    reasons.push("v361_penalty_rank_c_down_low_pressure");
  }
  if (price >= 0.50 && price <= 0.54 && side === "DOWN") {
    score -= 85;
    reasons.push("v361_penalty_price_down");
  }
  if (symbol === "DOGE" && timeframe === "15M") {
    score -= 80;
    reasons.push("v361_penalty_doge_15m");
  }
  if (timeframe === "15M" && depth >= 100 && depth < 500 && !(price >= 0.55 && price <= 0.59)) {
    score -= 75;
    reasons.push("v361_penalty_15m_depth_non_price");
  }
  if (confidence >= 80 && confidence <= 84 && price >= 0.50 && price <= 0.54 && seconds >= 0 && seconds <= 14) {
    score -= 70;
    reasons.push("v361_penalty_confidence_price_seconds");
  }
  if (depth < 20 && price >= 0.50 && price <= 0.54 && rank === "A") {
    score -= 60;
    reasons.push("v361_penalty_low_depth_price_rank_a");
  }
  if (symbol === "BNB" && depth < 20 && timeframe === "5M") {
    score -= 55;
    reasons.push("v361_penalty_bnb_depth_5m");
  }
  if (symbol === "SOL" && timeframe === "5M" && seconds >= 0 && seconds <= 14) {
    score -= 50;
    reasons.push("v361_penalty_sol_5m_seconds");
  }

  // Dynamic layers: Cross-run, Recency, and Regime
  const crossRunStable = getCrossRunStableScore(candidate);
  if (crossRunStable !== 0) {
    score += crossRunStable;
    reasons.push(`v361_cross_run_stable_${crossRunStable > 0 ? "boost" : "penalty"}`);
  }

  const settledSignals = context.signals || [];
  const currentRunRecency = calculateRecencyScore(candidate, settledSignals);
  if (currentRunRecency !== 0) {
    score += currentRunRecency;
    reasons.push(`v361_recency_${currentRunRecency > 0 ? "boost" : "penalty"}`);
  }

  const regimePenalty = calculateRegimePenalty(candidate, settledSignals);
  if (regimePenalty !== 0) {
    score += regimePenalty;
    reasons.push("v361_regime_drawdown_penalty");
  }

  // Capping
  let finalScore = score;
  if (score > 0) {
    finalScore = Math.min(120, score);
  } else if (score < 0) {
    finalScore = Math.max(-120, score);
  }

  return {
    score: finalScore,
    reasons
  };
}

function applyAccuracyReranker(candidates = [], context = {}) {
  if (!ACCURACY_RERANKER_ENABLED || !Array.isArray(candidates) || candidates.length <= 1) return candidates;
  return candidates
    .map((candidate, index) => {
      const accuracy = scoreAccuracyBucket({ ...context, ...candidate, side: candidate.side || context.predictedOutcome });
      let extraScore = 0;
      let extraReasons = [];
      
      if (V361_APPLY_TO_LIVE_SELECTION) {
        const v361 = scoreV361Capped(candidate, context);
        extraScore = v361.score;
        extraReasons = v361.reasons;
      }

      // Demote tick-bound spread-manipulated assets like XRP that produce fake edges
      const symbol = String(candidate.symbol || "").toUpperCase();
      if (symbol === "XRP") {
        extraScore -= 500;
        extraReasons.push("demote_xrp_tick_noise_protection");
      }
      
      // Demote OBSERVE lane candidates to the absolute bottom of the pool
      const lane = String(candidate.lane || candidate.calibratedLane || "").toUpperCase();
      if (lane === "OBSERVE") {
        extraScore -= 1000;
        extraReasons.push("demote_observe_lane_protection");
      }

      return {
        ...candidate,
        originalRankIndex: index,
        accuracyScore: accuracy.score + extraScore,
        accuracyReasons: [...accuracy.reasons, ...extraReasons],
        score: toNumber(candidate.score, 0) + accuracy.score + extraScore,
      };
    })
    .sort((left, right) => {
      if (right.approved !== left.approved) return Number(right.approved) - Number(left.approved);
      if (right.score !== left.score) return right.score - left.score;
      return left.originalRankIndex - right.originalRankIndex;
    });
}

function logV361ShadowCandidate(candidate = {}, market = {}, now = Date.now()) {
  try {
    if (!V361_SHADOW_ONLY && !SHADOW_OBSERVER_ENABLED) return;
    const priceToBeat = toNumber(candidate.priceToBeat ?? market.priceToBeat, 0);
    if (priceToBeat <= 0) {
      auditLogger.decision({
        time: new Date(now).toISOString(),
        reason: "v372_shadow_missing_real_strike_not_logged",
        slug: market.slug || "",
      });
      return;
    }
    const v361 = scoreV361Capped(candidate, market);
    const shadowSignal = {
      id: `shadow_${market.slug || "btc"}_${candidate.strategy || "ev"}_${now}`,
      time: new Date(now).toISOString(),
      slug: market.slug,
      symbol: market.symbol,
      timeframe: market.timeframe,
      side: candidate.side || candidate.direction || market.predictedOutcome || "UNKNOWN",
      direction: String(candidate.direction || candidate.side || "").toUpperCase() === "UP" ? "Up" : "Down",
      strategy: candidate.strategy,
      originalScore: candidate.score,
      v361Score: v361.score,
      v361Reasons: v361.reasons,
      price: candidate.entryPrice ?? candidate.selectedBuyPrice ?? candidate.price,
      depthShares: candidate.depthShares ?? candidate.selectedDepthShares,
      confidence: candidate.confidence ?? market.confidence,
      status: "paper_open",
      priceToBeat,
      windowEnd: market.windowEnd || new Date(now + 15 * 60 * 1000).toISOString(),
    };
    
    const dir = path.dirname(V361_SHADOW_SIGNALS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(V361_SHADOW_SIGNALS_PATH, `${JSON.stringify(shadowSignal)}\n`);
    console.log(`[V361 SHADOW CANDIDATE LOGGED]: ${shadowSignal.id} for ${market.slug}`);
  } catch (error) {
    console.error("Failed to log V361 shadow candidate:", error);
  }
}

async function settleShadowSignals(now = Date.now()) {
  try {
    if (!fs.existsSync(V361_SHADOW_SIGNALS_PATH)) return;
    const raw = fs.readFileSync(V361_SHADOW_SIGNALS_PATH, "utf8");
    const openSignals = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((sig) => sig.status === "paper_open");
      
    if (openSignals.length === 0) return;

    const remainingOpen = [];
    const newlySettled = [];

    for (const signal of openSignals) {
      const windowEndMs = Date.parse(signal.windowEnd);
      if (windowEndMs > now) {
        remainingOpen.push(signal);
        continue;
      }

      // Settle the shadow signal
      const officialSettlement = await fetchPolymarketOfficialSettlement(signal);
      if (!officialSettlement) {
        remainingOpen.push({
          ...signal,
          settlementRetryCount: (signal.settlementRetryCount || 0) + 1,
        });
        continue;
      }

      const finalPrice = toNumber(officialSettlement.finalPrice, 0) > 0 ? officialSettlement.finalPrice : null;
      const priceToBeat = officialSettlement.priceToBeat || signal.priceToBeat;
      const won = Boolean(officialSettlement.won);

      const settled = {
        ...signal,
        status: won ? "paper_win" : "paper_loss",
        settledAt: new Date(now).toISOString(),
        finalPrice,
        priceToBeat,
        won,
        officialOutcome: officialSettlement.officialOutcome || null,
        officialSettlementUsed: true,
        settlementSource: "official_poly_shadow",
      };
      newlySettled.push(settled);
      console.log(`[V361 SHADOW SETTLED]: ${settled.id} for ${settled.slug} resolved as ${settled.status}`);
    }

    const allLines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    const updatedLines = allLines.map((sig) => {
      const settled = newlySettled.find((s) => s.id === sig.id);
      if (settled) return settled;
      return sig;
    });

    const dir = path.dirname(V361_SHADOW_SIGNALS_PATH);
    fs.writeFileSync(V361_SHADOW_SIGNALS_PATH, updatedLines.map((l) => JSON.stringify(l)).join("\n") + "\n");

    if (newlySettled.length > 0) {
      fs.appendFileSync(V361_SHADOW_SETTLED_PATH, newlySettled.map((s) => JSON.stringify(s)).join("\n") + "\n");
    }
  } catch (error) {
    console.error("Failed to settle shadow signals:", error);
  }
}

async function buildDirectionalPredictionPreview(previousPrediction = createEmptyPrediction(), selectedMarket = null, now = Date.now()) {
  const market = normalizeDirectionalPredictionMarket(selectedMarket, now);
  if (!market) return null;

  const [upBookSnapshot, downBookSnapshot] = await fetchEntryBookPair(market.upTokenId, market.downTokenId);
  const upAsk = upBookSnapshot ? getBestAsk(upBookSnapshot.book) : null;
  const downAsk = downBookSnapshot ? getBestAsk(downBookSnapshot.book) : null;
  const upBid = upBookSnapshot ? getBestBid(upBookSnapshot.book) : null;
  const downBid = downBookSnapshot ? getBestBid(downBookSnapshot.book) : null;
  const upSellPrice = upBid?.price || 0;
  const downSellPrice = downBid?.price || 0;
  const upMidPrice = upAsk && upBid ? (upAsk.price + upBid.price) / 2 : 0;
  const downMidPrice = downAsk && downBid ? (downAsk.price + downBid.price) / 2 : 0;
  const bookSource = [upBookSnapshot?.source || "none", downBookSnapshot?.source || "none"].join("+");
  const settledPreviousSignals = previousPrediction.signals || [];
  const previousHistory = previousPrediction.history || [];
  const previousStats = summarizePredictionStats(settledPreviousSignals);
  const lossCircuit = evaluatePredictionLossCircuit(settledPreviousSignals, now);
  const externalAnchor = buildExternalPriceAnchorForMarket(market, now);
  const calculated = calculateDirectionalMarketPrediction({
    market,
    externalAnchor,
    prices: {
      upBuyPrice: upAsk?.price || 0,
      downBuyPrice: downAsk?.price || 0,
      upBidPrice: upBid?.price || 0,
      downBidPrice: downBid?.price || 0,
      upSellPrice,
      downSellPrice,
      upMidPrice,
      downMidPrice,
      upDepthShares: upAsk?.size || 0,
      downDepthShares: downAsk?.size || 0,
      bookAgeMs: Math.max(toNumber(upBookSnapshot?.ageMs, 0), toNumber(downBookSnapshot?.ageMs, 0)),
      upDepthDiagnostics: upBookSnapshot ? getBookDepthDiagnostics(upBookSnapshot.book) : {},
      downDepthDiagnostics: downBookSnapshot ? getBookDepthDiagnostics(downBookSnapshot.book) : {},
    },
    previousHistory,
    previousStats,
    previousSignals: settledPreviousSignals,
    lossCircuit,
    now,
  });

  const realBookAllowed = !REAL_MARKET_DATA_ONLY || hasLiveBookSource(bookSource);
  const v337Priority = buildV337PriorityProfile({
    ...market,
    side: calculated.predictedOutcome,
    predictedOutcome: calculated.predictedOutcome,
    entryPrice: calculated.selectedBuyPrice,
    selectedBuyPrice: calculated.selectedBuyPrice,
    bookSource,
    bookAgeMs: calculated.bookAgeMs,
    secondsIntoWindow: calculated.secondsIntoWindow,
  });
  const accuracyBucket = scoreAccuracyBucket({
    ...calculated,
    strategy: "dual_side_ev",
    side: calculated.predictedOutcome,
    entryPrice: calculated.selectedBuyPrice,
    bookSource,
  });
  const baseQualityScore = directionalPreviewQualityScore(calculated) + toNumber(v337Priority.score, 0);
  return {
    market,
    bookSource,
    tradeable: realBookAllowed && calculated.tradeable,
    reason: realBookAllowed ? calculated.reason : "blocked_non_live_orderbook_real_data_only",
    feeAdjustedEdge: toNumber(calculated.feeAdjustedEdge, -999),
    selectedProbability: toNumber(calculated.selectedProbability, 0),
    confidence: toNumber(calculated.confidence, 0),
    qualityScore: baseQualityScore + accuracyBucket.score,
    baseQualityScore,
    accuracyScore: accuracyBucket.score,
    accuracyReasons: accuracyBucket.reasons,
    v337Priority,
    v337PriorityScore: v337Priority.score,
    selectedBuyPrice: toNumber(calculated.selectedBuyPrice, 0),
    selectedSpreadCents: toNumber(calculated.selectedSpreadCents, 0),
    selectedDepthPressure: toNumber(calculated.selectedDepthPressure, 0),
    sideDepthAdvantage: toNumber(calculated.sideDepthAdvantage, 0),
    selectedMicropriceEdgeCents: toNumber(calculated.selectedMicropriceEdgeCents, 0),
    scannerScore: toNumber(market.scannerScore, 0),
    scannerEdgePercent: toNumber(market.scannerEdgePercent, 0),
    predictedOutcome: calculated.predictedOutcome,
  };
}

function compareDirectionalPreviews(left, right) {
  const leftApproved = left.tradeable ? 1 : 0;
  const rightApproved = right.tradeable ? 1 : 0;
  if (leftApproved !== rightApproved) return rightApproved - leftApproved;
  if (right.qualityScore !== left.qualityScore) return right.qualityScore - left.qualityScore;
  if (right.accuracyScore !== left.accuracyScore) return right.accuracyScore - left.accuracyScore;
  if (right.feeAdjustedEdge !== left.feeAdjustedEdge) return right.feeAdjustedEdge - left.feeAdjustedEdge;
  if (right.selectedProbability !== left.selectedProbability) return right.selectedProbability - left.selectedProbability;
  if (right.confidence !== left.confidence) return right.confidence - left.confidence;
  if (right.v337PriorityScore !== left.v337PriorityScore) return right.v337PriorityScore - left.v337PriorityScore;
  if (right.scannerScore !== left.scannerScore) return right.scannerScore - left.scannerScore;
  return right.scannerEdgePercent - left.scannerEdgePercent;
}

async function selectBestDirectionalPredictionMarkets(scanResult = {}, previousPrediction = createEmptyPrediction(), now = Date.now()) {
  const candidates = getDirectionalPredictionCandidates(scanResult, now);
  if (!candidates.length) return [];

  const pool = candidates.slice(0, MULTI_ASSET_SELECTION_POOL_SIZE);
  const previews = (await Promise.all(
    pool.map((market) => buildDirectionalPredictionPreview(previousPrediction, market, now).catch(() => null)),
  )).filter(Boolean);
  if (!previews.length) return [candidates[0]];

  previews.sort(compareDirectionalPreviews);
  const selectedPreviews = previews.some((preview) => preview.tradeable)
    ? previews.filter((preview) => preview.tradeable).slice(0, MULTI_ASSET_COMMIT_MARKETS_PER_TICK)
    : previews.slice(0, 1);
  const selected = selectedPreviews[0];
  auditLogger.decision({
    time: new Date(now).toISOString(),
    reason: "multi_asset_best_directional_selected",
    market: selected.market.slug,
    symbol: selected.market.symbol,
    timeframe: selected.market.timeframe,
    tradeable: selected.tradeable,
    selectedOutcome: selected.predictedOutcome,
    feeAdjustedEdge: selected.feeAdjustedEdge,
    confidence: selected.confidence,
    scannerScore: selected.scannerScore,
    v337PriorityScore: selected.v337PriorityScore,
    v337PriorityReasons: selected.v337Priority?.reasons || [],
    previewedCandidates: previews.length,
    selectedMarkets: selectedPreviews.length,
    tradeablePreviewCandidates: previews.filter((preview) => preview.tradeable).length,
    blockedPreviewCandidates: previews.filter((preview) => !preview.tradeable).length,
    topCandidates: previews.slice(0, 5).map((preview) => ({
      slug: preview.market.slug,
      symbol: preview.market.symbol,
      timeframe: preview.market.timeframe,
      outcome: preview.predictedOutcome,
      tradeable: preview.tradeable,
      reason: preview.reason,
      feeAdjustedEdge: preview.feeAdjustedEdge,
      confidence: preview.confidence,
      scannerScore: preview.scannerScore,
      v337PriorityScore: preview.v337PriorityScore,
      qualityScore: preview.qualityScore,
      accuracyScore: preview.accuracyScore,
      accuracyReasons: preview.accuracyReasons,
      selectedDepthPressure: preview.selectedDepthPressure,
      sideDepthAdvantage: preview.sideDepthAdvantage,
      selectedMicropriceEdgeCents: preview.selectedMicropriceEdgeCents,
    })),
  });
  return selectedPreviews.map((preview) => preview.market);
}

async function selectBestDirectionalPredictionMarket(scanResult = {}, previousPrediction = createEmptyPrediction(), now = Date.now()) {
  return (await selectBestDirectionalPredictionMarkets(scanResult, previousPrediction, now))[0] || null;
}


function isTechnicallyExecutableCandidate(candidate = {}) {
  const maxTechnicalEntryPrice = BOT_ROLE === "main_test" ? MAIN_ACCURACY_MAX_ENTRY_PRICE : (AGGRESSIVE_LEARNING_MODE ? 0.98 : 0.95);
  return isCandidateTechnicallyExecutable(candidate, { maxEntryPrice: maxTechnicalEntryPrice });
}

function buildNoDowngradeEntryCandidatePool(candidates = [], prediction = {}) {
  const reranked = applyAccuracyReranker(Array.isArray(candidates) ? candidates : [], prediction);
  const seen = new Set();
  const output = [];
  const pushCandidate = (candidate, lane) => {
    if (!candidate || !isTechnicallyExecutableCandidate(candidate)) return;
    const directionalPolicy = isExecutableDirectionalCandidate(candidate, prediction, STRATEGY_EXECUTABLE_STRATEGIES);
    if (!directionalPolicy.executable) return;
    const key = [candidate.strategy, candidate.side, candidate.entryPrice, candidate.market || candidate.slug || ""].join(":");
    if (seen.has(key)) return;
    seen.add(key);
    output.push({
      ...candidate,
      approved: true,
      noDowngradeFillLane: lane,
      blockedReason: "",
      noDowngradeOriginalBlockedReason: candidate.blockedReason || candidate.preBlockReason || candidate.gates?.reason || "",
      directionalExecutionPolicy: directionalPolicy,
      stakeMultiplier: NO_STAKE_REDUCTION_MODE ? Math.max(1, toNumber(candidate.stakeMultiplier, 1)) : candidate.stakeMultiplier,
    });
  };
  for (const candidate of reranked.filter((item) => item.approved)) pushCandidate(candidate, "approved");
  if (NO_ENTRY_REDUCTION_MODE) {
    for (const candidate of reranked.filter((item) => !item.approved)) pushCandidate(candidate, "quality_penalized_fill");
  }
  return output;
}

async function scanDirectionalPredictionBatch(previousPrediction = createEmptyPrediction(), selectedMarkets = []) {
  await settleShadowSignals(Date.now()).catch(() => {});
  const markets = selectedMarkets.filter(Boolean).slice(0, MULTI_ASSET_COMMIT_MARKETS_PER_TICK);
  if (!markets.length) return previousPrediction;

  let currentPrediction = previousPrediction;
  const entryBudget = createEntryBudget(PAPER_MAX_ENTRIES_PER_TICK);
  for (const market of markets) {
    if (entryBudget.remaining <= 0) break;
    currentPrediction = await scanDirectionalPrediction(currentPrediction, market, entryBudget);
  }
  return currentPrediction;
}

async function scanDirectionalPrediction(previousPrediction = createEmptyPrediction(), selectedMarket = null, entryBudget = createEntryBudget(PAPER_MAX_ENTRIES_PER_TICK)) {
  if (!MULTI_ASSET_PREDICTION_ENABLED || !selectedMarket) return previousPrediction;
  const now = Date.now();
  const paperGenerationAtStart = paperLedgerGeneration;

  try {
    const market = normalizeDirectionalPredictionMarket(selectedMarket, now);
    if (!market) return previousPrediction;

    const entryBookPair = await fetchEntryBookPair(market.upTokenId, market.downTokenId);
    const [upBookSnapshot, downBookSnapshot] = entryBookPair;
    const upAsk = upBookSnapshot ? getBestAsk(upBookSnapshot.book) : null;
    const downAsk = downBookSnapshot ? getBestAsk(downBookSnapshot.book) : null;
    const upBid = upBookSnapshot ? getBestBid(upBookSnapshot.book) : null;
    const downBid = downBookSnapshot ? getBestBid(downBookSnapshot.book) : null;
    const upBuyPrice = upAsk?.price || 0;
    const downBuyPrice = downAsk?.price || 0;
    const upBidPrice = upBid?.price || 0;
    const downBidPrice = downBid?.price || 0;
    const upSellPrice = upBidPrice;
    const downSellPrice = downBidPrice;
    const upMidPrice = upBuyPrice > 0 && upBidPrice > 0 ? (upBuyPrice + upBidPrice) / 2 : 0;
    const downMidPrice = downBuyPrice > 0 && downBidPrice > 0 ? (downBuyPrice + downBidPrice) / 2 : 0;
    const upDepthShares = upAsk?.size || 0;
    const downDepthShares = downAsk?.size || 0;
    const upDepthDiagnostics = upBookSnapshot ? getBookDepthDiagnostics(upBookSnapshot.book) : {};
    const downDepthDiagnostics = downBookSnapshot ? getBookDepthDiagnostics(downBookSnapshot.book) : {};
    const bookSource = [upBookSnapshot?.source || "none", downBookSnapshot?.source || "none"].join("+");
    const bookAgeMs = Math.max(toNumber(upBookSnapshot?.ageMs, 0), toNumber(downBookSnapshot?.ageMs, 0));
    // The top-level scan settles once before market discovery. Do not repeat
    // network settlement requests after entry-book capture, because doing so
    // can age otherwise fresh Chainlink/book evidence before commit.
    const settledPreviousSignals = previousPrediction.signals || [];
    const previousHistory = previousPrediction.history || [];
    const previousStats = summarizePredictionStats(settledPreviousSignals);
    const lossCircuit = evaluatePredictionLossCircuit(settledPreviousSignals, now);
    const prices = {
      upBuyPrice,
      downBuyPrice,
      upBidPrice,
      downBidPrice,
      upSellPrice,
      downSellPrice,
      upMidPrice,
      downMidPrice,
      upDepthShares,
      downDepthShares,
      bookAgeMs,
      upDepthDiagnostics,
      downDepthDiagnostics,
    };
    const externalAnchor = buildExternalPriceAnchorForMarket(market, now);
    const calculated = calculateDirectionalMarketPrediction({
      market,
      prices,
      externalAnchor,
      previousHistory,
      previousStats,
      previousSignals: settledPreviousSignals,
      lossCircuit,
      now,
    });
    let basePrediction = {
      ...createEmptyPrediction(),
      status: "live",
      title: market.title,
      slug: market.slug,
      symbol: market.symbol,
      timeframe: market.timeframe,
      marketFamily: market.marketFamily,
      marketUrl: market.marketUrl,
      windowStart: market.windowStart,
      windowEnd: market.windowEnd,
      priceToBeat: externalAnchor.priceToBeat || 0,
      targetSource: externalAnchor.targetSource || "external_price_window_anchor",
      currentPrice: externalAnchor.currentPrice || 0,
      currentSource: externalAnchor.currentSource || "external_price_ws_cache",
      referencePriceStatus: externalAnchor.referencePriceStatus || "unavailable",
      currentPriceAgeMs: externalAnchor.currentPriceAgeMs ?? null,
      binanceContextPrice: externalAnchor.binanceContextPrice ?? null,
      binanceContextAgeMs: externalAnchor.binanceContextAgeMs ?? null,
      binanceContextSource: externalAnchor.binanceContextSource || "binance_context_missing",
      binanceContextDivergenceBps: externalAnchor.binanceContextDivergenceBps ?? null,
      upBuyPrice,
      downBuyPrice,
      upSellPrice,
      downSellPrice,
      upMidPrice,
      downMidPrice,
      upDepthShares,
      downDepthShares,
      upBidPrice,
      downBidPrice,
      bookSource,
      bookAgeMs,
      takerFeeRate: market.takerFeeRate ?? PAPER_CRYPTO_TAKER_FEE_RATE,
      minOrderSize: resolveMarketMinimumShares(
        market.minOrderSize,
        market.min_order_size,
        market.mos,
        upBookSnapshot?.book?.min_order_size,
        upBookSnapshot?.book?.minimum_order_size,
        downBookSnapshot?.book?.min_order_size,
        downBookSnapshot?.book?.minimum_order_size,
      ),
      upExecutionAsks: normalizeBookLevels(upBookSnapshot?.book?.asks, "ask"),
      downExecutionAsks: normalizeBookLevels(downBookSnapshot?.book?.asks, "ask"),
      upBookIntegrity: upBookSnapshot?.book?.integrityReason || "missing",
      downBookIntegrity: downBookSnapshot?.book?.integrityReason || "missing",
      upBookReceivedAtMs: toNumber(upBookSnapshot?.book?.receivedAt, 0) || null,
      downBookReceivedAtMs: toNumber(downBookSnapshot?.book?.receivedAt, 0) || null,
      upBookEventTimestampMs: toNumber(upBookSnapshot?.book?.lastEventTimestamp, 0) || null,
      downBookEventTimestampMs: toNumber(downBookSnapshot?.book?.lastEventTimestamp, 0) || null,
      upBookEconomicRevision: toNumber(upBookSnapshot?.book?.economicRevision, 0) || null,
      downBookEconomicRevision: toNumber(downBookSnapshot?.book?.economicRevision, 0) || null,
      upBookEconomicGeneration: upBookSnapshot?.book?.economicGeneration || null,
      downBookEconomicGeneration: downBookSnapshot?.book?.economicGeneration || null,
      upTickSize: toNumber(upBookSnapshot?.book?.minimum_tick_size ?? upBookSnapshot?.book?.tick_size, market.tickSize || 0.01),
      downTickSize: toNumber(downBookSnapshot?.book?.minimum_tick_size ?? downBookSnapshot?.book?.tick_size, market.tickSize || 0.01),
      bookSnapshotReceivedAtMs: Math.min(
        toNumber(upBookSnapshot?.book?.receivedAt, now),
        toNumber(downBookSnapshot?.book?.receivedAt, now),
      ),
      upOutcomePrice: market.upOutcomePrice,
      downOutcomePrice: market.downOutcomePrice,
      signals: settledPreviousSignals,
      history: previousHistory,
      updatedAt: new Date(now).toISOString(),
      lastError: "",
      ...calculated,
      priceToBeat: externalAnchor.priceToBeat || 0,
      targetSource: externalAnchor.targetSource || "external_price_window_anchor",
      currentPrice: externalAnchor.currentPrice || 0,
      currentSource: externalAnchor.currentSource || "external_price_ws_cache",
      referencePriceStatus: externalAnchor.referencePriceStatus || "unavailable",
      currentPriceAgeMs: externalAnchor.currentPriceAgeMs ?? null,
      binanceContextPrice: externalAnchor.binanceContextPrice ?? null,
      binanceContextAgeMs: externalAnchor.binanceContextAgeMs ?? null,
      binanceContextSource: externalAnchor.binanceContextSource || "binance_context_missing",
      binanceContextDivergenceBps: externalAnchor.binanceContextDivergenceBps ?? null,
      priceDelta: externalAnchor.priceDelta ?? calculated.priceDelta ?? 0,
      priceDeltaPercent: externalAnchor.priceDeltaPercent ?? calculated.priceDeltaPercent ?? 0,
      distanceBps: externalAnchor.distanceBps ?? calculated.distanceBps ?? 0,
      requiredDistanceBps: externalAnchor.requiredDistanceBps ?? calculated.requiredDistanceBps ?? 0,
      momentum15Bps: externalAnchor.momentum15Bps ?? calculated.momentum15Bps ?? 0,
      momentum30Bps: externalAnchor.momentum30Bps ?? calculated.momentum30Bps ?? 0,
      momentum60Bps: externalAnchor.momentum60Bps ?? calculated.momentum60Bps ?? 0,
      predictionEngine: calculated.predictionEngine,
    };

    if (REAL_MARKET_DATA_ONLY && !hasLiveBookSource(bookSource)) {
      basePrediction = {
        ...basePrediction,
        tradeable: false,
        riskApproved: false,
        reason: "blocked_non_live_orderbook_real_data_only",
        riskReason: "blocked_non_live_orderbook_real_data_only",
      };
    }

    const adaptiveLearningSignals = ADAPTIVE_USE_IMPORTED_LEARNING
      ? [...(IMPORTED_LEARNING_BRAIN?.adaptiveSignals || []), ...settledPreviousSignals]
      : settledPreviousSignals;
    let adaptiveState = buildAdaptiveLearningState(adaptiveLearningSignals, now, buildAdaptiveConfig());
    if (ADAPTIVE_USE_IMPORTED_LEARNING && IMPORTED_LEARNING_BRAIN?.adaptiveSignals?.length) {
      const runtimeAdaptiveState = buildAdaptiveLearningState(settledPreviousSignals, now, buildAdaptiveConfig());
      adaptiveState = {
        ...adaptiveState,
        summary: {
          ...adaptiveState.summary,
          consecutiveLosses: runtimeAdaptiveState.summary.consecutiveLosses,
          recoveryActive: runtimeAdaptiveState.summary.recoveryActive,
          hardStopActive: runtimeAdaptiveState.summary.hardStopActive,
        },
        recovery: runtimeAdaptiveState.recovery,
      };
    }
    persistAdaptiveLearningState(DATA_DIR, adaptiveState);

    const strategyAccountRisk = accountRiskFromSignals(
      settledPreviousSignals,
      getBankrollFromStats(previousStats),
      PAPER_START_BALANCE,
      { activeWindowKey: market.slug },
    );
    const strategyRouterDecision = evaluateStrategyRouter({
      prediction: basePrediction,
      accountRisk: strategyAccountRisk,
      config: buildStrategyRouterConfig(buildStrategyPerformanceReport(settledPreviousSignals), settledPreviousSignals),
    });
    for (const candidate of strategyRouterDecision.candidates || []) {
      auditLogger.strategy({
        time: new Date(now).toISOString(),
        ...candidate,
        market: market.slug,
        symbol: market.symbol,
        timeframe: market.timeframe,
        gates: undefined,
        consensus: undefined,
        gateSummary: candidate.gates?.gateSummary,
        blockedAt: candidate.blockedAt,
      });
      auditLogger.gate({
        time: new Date(now).toISOString(),
        strategy: candidate.strategy,
        side: candidate.side,
        market: market.slug,
        approved: candidate.approved,
        reason: candidate.blockedReason || candidate.gates?.reason || "approved",
        blockedAt: candidate.blockedAt || null,
        gateSummary: candidate.gates?.gateSummary || null,
      });
    }
    basePrediction = applyStrategySelectionToPrediction(basePrediction, strategyRouterDecision, strategyAccountRisk);
    basePrediction = applyAdaptiveAvoidanceToPrediction(basePrediction, adaptiveState, strategyAccountRisk);

    // V361 Shadow selection logging
    if ((V361_SHADOW_ONLY || SHADOW_OBSERVER_ENABLED) && Array.isArray(strategyRouterDecision.candidates)) {
      const shadowReranked = strategyRouterDecision.candidates
        .map((cand) => {
          const v361 = scoreV361Capped(cand, basePrediction);
          return {
            ...cand,
            v361Score: v361.score,
            totalV361Score: toNumber(cand.score, 0) + v361.score,
          };
        })
        .filter((cand) => cand.approved !== false)
        .sort((left, right) => right.totalV361Score - left.totalV361Score);

      const topShadow = shadowReranked[0];
      if (topShadow) {
        logV361ShadowCandidate(topShadow, market, now);
      }
    }

    if (paperGenerationAtStart !== paperLedgerGeneration) {
      return state.prediction || createEmptyPrediction({
        status: "reset",
        reason: "paper_equity_reset_ignored_stale_scan",
        updatedAt: new Date(now).toISOString(),
      });
    }

    const approvedCandidates = buildNoDowngradeEntryCandidatePool(
      strategyRouterDecision.candidates || [],
      basePrediction,
    ).slice(0, Math.max(0, entryBudget.remaining));
    let signals = settledPreviousSignals;
    const newSignals = [];
    for (const candidate of approvedCandidates) {
      const stats = summarizePredictionStats(signals);
      const dynamicAccountRisk = accountRiskFromSignals(
        signals,
        getBankrollFromStats(stats),
        PAPER_START_BALANCE,
        { activeWindowKey: market.slug },
      );
      const candidatePrediction = applyAdaptiveAvoidanceToPrediction(
        applyStrategySelectionToPrediction(basePrediction, { ...strategyRouterDecision, selected: candidate }, dynamicAccountRisk),
        adaptiveState,
        dynamicAccountRisk,
      );
      const signal = maybeCreatePredictionSignal({ ...candidatePrediction, signals }, market, now);
      if (signal) {
        if (!consumeEntryBudget(entryBudget)) break;
        newSignals.push(signal);
        signals = [signal, ...signals].slice(0, 500);
      }
    }

    const historyPoint = {
      time: new Date(now).toISOString(),
      slug: market.slug,
      symbol: market.symbol,
      timeframe: market.timeframe,
      currentPrice: calculated.currentPrice,
      priceToBeat: calculated.priceToBeat,
      currentSource: basePrediction.currentSource || null,
      currentPriceAgeMs: basePrediction.currentPriceAgeMs ?? null,
      targetSource: basePrediction.targetSource || null,
      referencePriceStatus: basePrediction.referencePriceStatus || null,
      externalPriceFeed: buildExternalPriceFeedTelemetry(now),
      priceDelta: calculated.priceDelta,
      confidence: calculated.confidence,
      predictedOutcome: calculated.predictedOutcome,
      selectedEdgePercent: calculated.selectedEdgePercent,
      selectedSpreadCents: calculated.selectedSpreadCents,
      selectedBidPrice: calculated.selectedBidPrice,
      probabilityUp: calculated.probabilityUp,
      probabilityDown: calculated.probabilityDown,
      selectedProbability: calculated.selectedProbability,
      feeAdjustedEdge: calculated.feeAdjustedEdge,
      rank: calculated.rank,
      volatility60Bps: calculated.volatility60Bps,
      volatilityAdjustedDistance: calculated.volatilityAdjustedDistance,
      yesNoAskCost: calculated.yesNoAskCost,
      selectedDepthPressure: calculated.selectedDepthPressure,
      sideDepthAdvantage: calculated.sideDepthAdvantage,
      selectedMicropriceEdgeCents: calculated.selectedMicropriceEdgeCents,
      selectedAskSlopeCents: calculated.selectedAskSlopeCents,
      riskReason: calculated.riskReason,
      secondsIntoWindow: calculated.secondsIntoWindow,
      distanceBps: calculated.distanceBps,
      strategyVersion: BTC_PREDICTION_STRATEGY_VERSION,
      selectedStrategy: basePrediction.selectedStrategy || "dual_side_ev",
      candidateCount: basePrediction.candidateCount || 0,
      approvedCandidateCount: basePrediction.approvedCandidateCount || 0,
      gateSummary: basePrediction.gateProtocol?.gateSummary || null,
      finalSelectionTradeable: Boolean(basePrediction.tradeable),
      finalSelectionReason: basePrediction.reason || basePrediction.riskReason || "unknown",
      calibratedLane: basePrediction.calibratedLane || null,
      calibratedWinProbability: basePrediction.calibratedWinProbability ?? null,
      calibratedNetEdge: basePrediction.preliminaryCalibratedNetEv?.netEdge ?? null,
      fastGrowEvPolicy: basePrediction.fastGrowEvPolicy || null,
      fastGrowSizing: basePrediction.fastGrowSizing || null,
      antiPlateauCompounding: basePrediction.antiPlateauCompounding || null,
      recommendedStakeUsd: basePrediction.recommendedStakeUsd ?? null,
      dynamicMaxTradeUsd: basePrediction.dynamicMaxTradeUsd ?? null,
      riskProfile: RISK_PROFILE,
      aggressiveLearningMode: AGGRESSIVE_LEARNING_MODE,
      upBuyPrice,
      downBuyPrice,
      upDepthShares,
      downDepthShares,
      bookSource,
      predictionEngine: calculated.predictionEngine,
    };
    recordPredictionSnapshot({
      ...historyPoint,
      status: basePrediction.status,
      reason: basePrediction.reason,
      tradeable: basePrediction.tradeable,
      newSignals: newSignals.length,
    });

    const prediction = {
      ...createEmptyPrediction(),
      ...basePrediction,
      lastSignal: newSignals[0] || signals[0] || null,
      signals,
      history: [...previousHistory, historyPoint].slice(-500),
      stats: summarizePredictionStats(signals),
    };
    if (paperGenerationAtStart === paperLedgerGeneration) savePersistedPrediction(prediction);
    return paperGenerationAtStart === paperLedgerGeneration ? prediction : (state.prediction || prediction);
  } catch (error) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "multi_asset_prediction_error_no_fallback_entry",
      detail: error instanceof Error ? error.message : "multi_asset_prediction_failed",
    });
    const prediction = {
      ...previousPrediction,
      status: "degraded",
      reason: "multi_asset_prediction_error_no_fallback_entry",
      lastError: error instanceof Error ? error.message : "multi_asset_prediction_failed",
      updatedAt: new Date().toISOString(),
    };
    if (paperGenerationAtStart === paperLedgerGeneration) savePersistedPrediction(prediction);
    return prediction;
  }
}



function normalizeRuntimeSide(signal = {}) {
  const raw = String(signal.side || signal.direction || signal.predictedOutcome || "").toUpperCase();
  if (raw.startsWith("UP")) return "UP";
  if (raw.startsWith("DOWN")) return "DOWN";
  return "UNKNOWN";
}

function runtimePriceBucket(price) {
  const value = toNumber(price, 0);
  if (value < 0.50) return "lt_0.50";
  if (value < 0.55) return "0.50_0.54";
  if (value < 0.60) return "0.55_0.59";
  if (value < 0.65) return "0.60_0.64";
  if (value < 0.70) return "0.65_0.69";
  if (value <= 0.82) return "0.70_0.82";
  return "gt_0.82";
}

function runtimeWindowBucket(seconds) {
  const value = toNumber(seconds, 0);
  if (value < 15) return "0_15";
  if (value < 30) return "15_30";
  if (value < 60) return "30_60";
  if (value < 75) return "60_75";
  if (value < 105) return "75_105";
  if (value < 135) return "105_135";
  return "135_plus";
}

function runtimeSignalPnl(signal = {}) {
  const explicit = toNumber(signal.paperPnlUsd ?? signal.pnlUsd ?? signal.pnl, NaN);
  if (Number.isFinite(explicit)) return explicit;
  const stake = toNumber(signal.paperStakeUsd ?? signal.stakeUsd, 0);
  if (signal.status === "paper_win") return Math.max(0, toNumber(signal.potentialProfitUsd, 0) || stake * (1 / Math.max(0.01, toNumber(signal.buyPrice, 1)) - 1));
  if (signal.status === "paper_loss") return -stake;
  return 0;
}

function addRuntimeBucket(buckets, key, signal, weight) {
  if (!key) return;
  const bucket = buckets[key] || {
    key,
    trades: 0,
    wins: 0,
    losses: 0,
    stakeUsd: 0,
    pnlUsd: 0,
    weight: 0,
    weightedWins: 0,
    weightedPnlUsd: 0,
    weightedStakeUsd: 0,
  };
  const stake = Math.max(0, toNumber(signal.paperStakeUsd ?? signal.stakeUsd, 0));
  const pnl = runtimeSignalPnl(signal);
  const win = signal.status === "paper_win";
  bucket.trades += 1;
  bucket.wins += win ? 1 : 0;
  bucket.losses += win ? 0 : 1;
  bucket.stakeUsd += stake;
  bucket.pnlUsd += pnl;
  bucket.weight += weight;
  bucket.weightedWins += win ? weight : 0;
  bucket.weightedPnlUsd += pnl * weight;
  bucket.weightedStakeUsd += stake * weight;
  buckets[key] = bucket;
}

function finalizeRuntimeBucket(bucket, config = {}) {
  const minSamples = Math.max(1, toNumber(config.minBucketSamples, RUNTIME_RULE_CACHE_MIN_BUCKET_SAMPLES));
  const trades = toNumber(bucket.trades, 0);
  const weightedTrades = Math.max(0, toNumber(bucket.weight, 0));
  const stake = Math.max(0.01, toNumber(bucket.stakeUsd, 0));
  const weightedStake = Math.max(0.01, toNumber(bucket.weightedStakeUsd, 0));
  const winRate = trades > 0 ? (bucket.wins / trades) * 100 : 0;
  const weightedWinRate = weightedTrades > 0 ? (bucket.weightedWins / weightedTrades) * 100 : winRate;
  const roi = (toNumber(bucket.pnlUsd, 0) / stake) * 100;
  const weightedRoi = (toNumber(bucket.weightedPnlUsd, 0) / weightedStake) * 100;
  const confidenceWeight = Math.min(1.35, Math.max(0.20, trades / Math.max(1, minSamples)));
  const performanceScore = ((weightedWinRate - 55) * 0.72 + weightedRoi * 0.42) * confidenceWeight;
  const maxScore = Math.max(1, RUNTIME_RULE_CACHE_MAX_SCORE_ADJUSTMENT);
  const minStake = Math.max(0.05, Math.min(1, RUNTIME_RULE_CACHE_MIN_STAKE_MULTIPLIER));
  const maxStake = Math.max(1, RUNTIME_RULE_CACHE_MAX_STAKE_MULTIPLIER);
  const isToxic = trades >= Math.max(minSamples, RUNTIME_RULE_CACHE_TOXIC_MIN_TRADES) && (
    weightedWinRate < RUNTIME_RULE_CACHE_TOXIC_MAX_WIN_RATE ||
    weightedRoi < RUNTIME_RULE_CACHE_TOXIC_MIN_ROI
  );
  const rawScoreAdjustment = Math.max(-maxScore, Math.min(maxScore, performanceScore));
  const scoreAdjustment = trades < minSamples
    ? 0
    : isToxic
      ? Math.max(-maxScore, Math.min(-1, RUNTIME_RULE_CACHE_TOXIC_SCORE_PENALTY))
      : rawScoreAdjustment;
  const stakeMultiplier = trades < minSamples
    ? 1
    : isToxic
      ? Math.max(minStake, Math.min(0.25, RUNTIME_RULE_CACHE_TOXIC_STAKE_MULTIPLIER))
      : Math.max(minStake, Math.min(maxStake, 1 + scoreAdjustment / 55));
  return {
    ...bucket,
    winRate,
    roi,
    weightedWinRate,
    weightedRoi,
    confidenceWeight,
    toxic: isToxic,
    scoreAdjustment,
    stakeMultiplier,
    action: trades < minSamples ? "observe" : isToxic ? "probe_only_toxic" : scoreAdjustment > 3 ? "soft_boost" : scoreAdjustment < -3 ? "soft_reduce" : "neutral",
  };
}

function loadPersistedRuntimeRuleCache() {
  try {
    if (!fs.existsSync(RUNTIME_RULE_CACHE_PATH)) return null;
    const parsed = JSON.parse(fs.readFileSync(RUNTIME_RULE_CACHE_PATH, "utf8"));
    if (!parsed || !parsed.buckets || !Object.keys(parsed.buckets).length) return null;
    return {
      ...parsed,
      mode: "runtime_adaptive_protected_aggressive",
      source: "persisted_seed_cache",
      seedOnly: true,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}


function loadCalibratedEntryModel() {
  if (!CALIBRATED_ENTRY_MODEL_ENABLED) return null;
  try {
    if (!fs.existsSync(CALIBRATED_ENTRY_MODEL_PATH)) return null;
    const stat = fs.statSync(CALIBRATED_ENTRY_MODEL_PATH);
    if (cachedCalibratedEntryModel && cachedCalibratedEntryModelMtimeMs === stat.mtimeMs) return cachedCalibratedEntryModel;
    const parsed = JSON.parse(fs.readFileSync(CALIBRATED_ENTRY_MODEL_PATH, "utf8"));
    cachedCalibratedEntryModel = parsed && typeof parsed === "object" ? parsed : null;
    cachedCalibratedEntryModelMtimeMs = stat.mtimeMs;
    return cachedCalibratedEntryModel;
  } catch (error) {
    auditLogger.decision({
      time: new Date().toISOString(),
      reason: "calibrated_entry_model_load_failed",
      error: error?.message || String(error),
      path: CALIBRATED_ENTRY_MODEL_PATH,
    });
    return cachedCalibratedEntryModel;
  }
}

function getEquityStakeScale(equity, candidate = {}) {
  if (!DYNAMIC_EQUITY_SCALING_ENABLED || !EQUITY_LANE_SCALING_ENABLED) return 1;
  const numericEquity = getSizingEquity(equity);
  const baseEquity = Math.max(1, toNumber(EQUITY_LANE_SCALING_BASE_EQUITY, PAPER_START_BALANCE));
  const startEquity = Math.max(baseEquity, toNumber(EQUITY_LANE_SCALING_START_EQUITY, DYNAMIC_EQUITY_SCALING_START_EQUITY));
  if (numericEquity < startEquity) return 1;

  const lane = String(
    candidate.lane ||
    candidate.calibratedLane ||
    candidate.executionQuality?.calibratedLane ||
    "A"
  ).toUpperCase();
  if (lane === "B" || lane === "PROBE") return 1;

  const profitLockState = candidate.profitLockState || candidate.executionQuality?.profitLockState || {};
  const profitLockMode = String(candidate.profitLockMode || profitLockState.mode || "normal").toLowerCase();
  if (EQUITY_LANE_SCALING_REQUIRE_NORMAL_PROFIT_LOCK && profitLockMode !== "normal") return 1;

  const bookSource = String(candidate.bookSource || "unknown").toLowerCase().trim();
  if (EQUITY_LANE_SCALING_REQUIRE_WS_BOOK && bookSource === "rest+rest") return 1;

  const runtimeDecision = candidate.runtimeRuleCache || candidate.runtimeRuleCacheDecision || {};
  const runtimeReason = String(candidate.runtimeRuleReason || runtimeDecision.reason || "").toLowerCase();
  const replayReason = String(candidate.replayOptimizerDecision?.reason || candidate.replayOptimizer?.reason || candidate.replayOptimizerReason || "").toLowerCase();
  const replayRules = Array.isArray(candidate.replayOptimizerDecision?.matchedRules)
    ? candidate.replayOptimizerDecision.matchedRules
    : Array.isArray(candidate.replayOptimizer?.matchedRules)
      ? candidate.replayOptimizer.matchedRules
      : [];
  const replayBad = replayReason.includes("replay_block") || replayRules.some((rule) => String(rule?.id || rule).toLowerCase().includes("bad"));
  const softReasons = Array.isArray(candidate.softQualityReasons) ? candidate.softQualityReasons : [];
  if (
    candidate.executionObserveOnly ||
    toNumber(candidate.softQualityStakeMultiplier, 1) < 0.50 ||
    toNumber(candidate.runtimeStakeMultiplier, 1) <= 0.25 ||
    /toxic|probe/i.test(runtimeReason) ||
    replayBad ||
    softReasons.some((reason) => /probe|tiny|rest_rest|overconfidence|late|price_0\.65|price_0\.70/i.test(String(reason)))
  ) {
    return 1;
  }

  const curve = clamp(toNumber(EQUITY_LANE_SCALING_CURVE, 0.50), 0.05, 1);
  const maxMultiplier = Math.max(1, toNumber(EQUITY_LANE_SCALING_MAX_MULTIPLIER, 1.60));
  return clamp(Math.pow(numericEquity / baseEquity, curve), 1, maxMultiplier);
}

function scaleStakeCapForEquity(capUsd, equity, candidate = {}) {
  const numericCap = toNumber(capUsd, 0);
  if (numericCap <= 0) return numericCap;
  return applyOptionalUsdHardCap(
    numericCap * getEquityStakeScale(equity, candidate),
    MAX_TRADE_USD_HARD_CAP,
  );
}

function getDynamicMaxTradeUsd(equity, lane = "", candidate = {}) {
  const baseCap = Math.max(1, PAPER_MAX_TRADE_USD);
  const numericEquity = getSizingEquity(equity);
  const normalizedLane = String(lane || legacyLaneFromRank(candidate?.rank || "B")).toUpperCase();
  const equityLaneCap = scaleStakeCapForEquity(baseCap, numericEquity, {
    ...candidate,
    lane: normalizedLane,
  });
  return computeDynamicEquityTradeCap({
    equity: numericEquity,
    lane: normalizedLane,
    scalingEnabled: DYNAMIC_EQUITY_SCALING_ENABLED,
    scalingStartEquity: DYNAMIC_EQUITY_SCALING_START_EQUITY,
    baseTradeUsd: baseCap,
    maxTradeEquityFraction: MAX_TRADE_EQUITY_FRACTION,
    probeMaxTradeEquityFraction: PROBE_MAX_TRADE_EQUITY_FRACTION,
    laneBMaxTradeUsd: LANE_B_MAX_TRADE_USD,
    minimumExecutableStakeUsd: MIN_EXECUTABLE_STAKE_USD,
    laneScaledBaseCapUsd: equityLaneCap,
    hardCapUsd: MAX_TRADE_USD_HARD_CAP,
  }).capUsd;
}

function buildRuntimeRuleCache(runtimeSignals = [], options = {}) {
  const settled = uniqueOfficialFinalSettled(runtimeSignals)
    .filter((signal) => signal && String(signal.sourceType || "real_market") !== "fallback")
    .sort((left, right) => Date.parse(right.settledAt || right.windowEnd || right.time || "") - Date.parse(left.settledAt || left.windowEnd || left.time || ""))
    .slice(0, Math.max(10, RUNTIME_RULE_CACHE_MAX_SIGNALS));
  if (settled.length === 0) {
    const persisted = loadPersistedRuntimeRuleCache();
    if (persisted) return persisted;
  }
  const buckets = {};
  const halfLife = Math.max(1, RUNTIME_RULE_CACHE_RECENT_HALFLIFE_TRADES);
  settled.forEach((signal, index) => {
    const weight = Math.pow(0.5, index / halfLife);
    const side = normalizeRuntimeSide(signal);
    const symbol = String(signal.symbol || "UNKNOWN").toUpperCase();
    const timeframe = String(signal.timeframe || "UNKNOWN").toUpperCase();
    const priceBucket = runtimePriceBucket(signal.buyPrice ?? signal.selectedBuyPrice ?? signal.entryPrice);
    const windowBucket = runtimeWindowBucket(signal.secondsIntoWindow);
    const rank = String(signal.rank || "SKIP").toUpperCase();
    const keys = [
      `side:${side}`,
      `symbol:${symbol}`,
      `timeframe:${timeframe}`,
      `price:${priceBucket}`,
      `window:${windowBucket}`,
      `rank:${rank}`,
      `book_source:${String(signal.bookSource || "unknown").toLowerCase()}`,
      `side_window:${side}:${windowBucket}`,
      `symbol_side:${symbol}:${side}`,
      `symbol_timeframe:${symbol}:${timeframe}`,
      `side_price:${side}:${priceBucket}`,
      `side_price_window:${side}:${priceBucket}:${windowBucket}`,
    ];
    for (const key of keys) addRuntimeBucket(buckets, key, signal, weight);
  });
  const finalizedBuckets = Object.fromEntries(
    Object.entries(buckets).map(([key, bucket]) => [key, finalizeRuntimeBucket(bucket, {
      minBucketSamples: RUNTIME_RULE_CACHE_MIN_BUCKET_SAMPLES,
    })]),
  );
  const payload = {
    version: 1,
    mode: "runtime_adaptive_protected_aggressive",
    enabled: RUNTIME_RULE_CACHE_ENABLED,
    updatedAt: new Date().toISOString(),
    settled: settled.length,
    minBucketSamples: RUNTIME_RULE_CACHE_MIN_BUCKET_SAMPLES,
    maxSignals: RUNTIME_RULE_CACHE_MAX_SIGNALS,
    softOnly: true,
    hardBlocks: ["strategy_not_dual_side_ev", "entry_price_outside_0.50_0.82", "seconds_into_window_after_135"],
    toxicProbeOnly: true,
    buckets: finalizedBuckets,
  };
  const now = Date.now();
  if (RUNTIME_RULE_CACHE_ENABLED && now - lastRuntimeRuleCachePersistAt >= RUNTIME_RULE_CACHE_PERSIST_MS) {
    try {
      writeJsonFile(RUNTIME_RULE_CACHE_PATH, payload);
      lastRuntimeRuleCachePersistAt = now;
    } catch {
      // Runtime rule cache persistence must not stop live scanning.
    }
  }
  return payload;
}

function buildExecutionRecoveryRegime(runtimeSignals = []) {
  const lookback = Math.max(3, Math.round(RECOVERY_LOOKBACK_TRADES));
  const settled = uniqueOfficialFinalSettled(runtimeSignals)
    .filter((signal) => signal && String(signal.sourceType || "real_market") !== "fallback")
    .sort((left, right) => Date.parse(right.settledAt || right.windowEnd || right.time || "") - Date.parse(left.settledAt || left.windowEnd || left.time || ""))
    .slice(0, lookback);
  const wins = settled.filter((signal) => signal.status === "paper_win").length;
  const stakeUsd = settled.reduce((sum, signal) => sum + toNumber(signal.paperStakeUsd ?? signal.stakeUsd, 0), 0);
  const pnlUsd = settled.reduce((sum, signal) => sum + runtimeSignalPnl(signal), 0);
  const winRate = settled.length ? (wins / settled.length) * 100 : 0;
  const roi = stakeUsd > 0 ? (pnlUsd / stakeUsd) * 100 : 0;
  const active = RECOVERY_MODE_ENABLED && settled.length >= Math.min(lookback, 6) && (
    winRate < RECOVERY_MIN_WIN_RATE ||
    roi < RECOVERY_MIN_ROI
  );
  const exitReady = !active && settled.length >= Math.min(lookback, 6) && winRate >= RECOVERY_EXIT_WIN_RATE && roi >= RECOVERY_EXIT_ROI;
  return {
    enabled: RECOVERY_MODE_ENABLED,
    active,
    exitReady,
    lookback,
    samples: settled.length,
    wins,
    losses: Math.max(0, settled.length - wins),
    winRate,
    roi,
    pnlUsd,
    stakeUsd,
    reason: !RECOVERY_MODE_ENABLED
      ? "recovery_mode_disabled"
      : active
        ? "recent_drawdown_recovery_mode"
        : exitReady
          ? "recent_performance_recovered"
          : "recent_performance_neutral",
    thresholds: {
      minWinRate: RECOVERY_MIN_WIN_RATE,
      minRoi: RECOVERY_MIN_ROI,
      exitWinRate: RECOVERY_EXIT_WIN_RATE,
      exitRoi: RECOVERY_EXIT_ROI,
      downMinScore: RECOVERY_DOWN_MIN_SCORE,
    },
  };
}

function buildStrategyRouterConfig(strategyPerformance = null, runtimeSignals = []) {
  if (postResetState.active) {
    const resetAtMs = Date.parse(postResetState.resetAt || "");
    const settledAfterReset = uniqueOfficialFinalSettled(runtimeSignals).filter((signal) => {
      const ts = Date.parse(signal.settledAt || signal.windowEnd || signal.time || "");
      return Number.isFinite(ts) && (!Number.isFinite(resetAtMs) || ts >= resetAtMs);
    }).length;
    postResetState = {
      ...postResetState,
      settledAfterReset,
      lastGoodLocked: settledAfterReset < POST_RESET_LOCK_LAST_GOOD_SETTLED,
      active: settledAfterReset < POST_RESET_LOCK_LAST_GOOD_SETTLED,
    };
  }
  const runtimeStrategyPerformance = buildStrategyPerformanceReport(runtimeSignals);
  const effectiveStrategyPerformance = selectLearningPerformanceReport(strategyPerformance, IMPORTED_LEARNING_BRAIN, {
    enabled: LEARNING_BRAIN_ENABLED,
    mode: LEARNING_BRAIN_MODE,
    minRuntimeSettled: LEARNING_BRAIN_MIN_RUNTIME_SETTLED,
  });
  const activeReplayOptimizer = buildActiveReplayOptimizerState(runtimeSignals);
  const runtimeRuleCache = buildRuntimeRuleCache(runtimeSignals);
  const executionRecoveryRegime = buildExecutionRecoveryRegime(runtimeSignals);
  const calibratedEntryModel = loadCalibratedEntryModel();
  return {
    enabled: STRATEGY_ROUTER_ENABLED,
    mode: STRATEGY_MODE,
    maxCandidates: STRATEGY_MAX_CANDIDATES_PER_TICK,
    minEdge: ACTIVE_BTC_PREDICTION_MIN_FEE_ADJUSTED_EDGE,
    maxEntryPrice: ACTIVE_BTC_PREDICTION_MAX_ENTRY_PRICE,
    maxSpreadCents: ACTIVE_BTC_PREDICTION_MAX_SPREAD_CENTS,
    maxBookAgeMs: ACTIVE_BTC_PREDICTION_MAX_BOOK_AGE_MS,
    minDepthShares: MIN_DEPTH_SHARES,
    maxYesNoAskCost: ACTIVE_BTC_PREDICTION_MAX_YES_NO_ASK_COST,
    minYesNoAskCost: MIN_YES_NO_ASK_COST,
    minValidEntryPrice: MIN_VALID_ENTRY_PRICE,
    minConfidence: ACTIVE_BTC_PREDICTION_MIN_CONFIDENCE,
    minZScore: GATE_MIN_ZSCORE,
    minPsi: GATE_MIN_PSI,
    minOddsVelocity: GATE_MIN_ODDS_VELOCITY,
    minDislocationScore: GATE_MIN_DISLOCATION_SCORE,
    minTicks: ACTIVE_BTC_PREDICTION_SIGNAL_STABLE_TICKS,
    minOddsTicks: 1,
    minBookTicks: 1,
    minSecondsIntoWindow: ACTIVE_BTC_PREDICTION_MIN_SECONDS_INTO_WINDOW,
    maxSecondsIntoWindow: ACTIVE_BTC_PREDICTION_MAX_SECONDS_INTO_WINDOW,
    minSecondsLeft: ACTIVE_BTC_PREDICTION_MIN_SECONDS_LEFT,
    maxActivePositions: MAX_ACTIVE_POSITIONS,
    maxPositionsPerWindow: MAX_POSITIONS_PER_WINDOW,
    maxSameSidePerWindow: MAX_SAME_SIDE_PER_WINDOW,
    maxStrategyPositionsPerWindow: MAX_STRATEGY_POSITIONS_PER_WINDOW,
    boostedPyramidEnabled: BOOSTED_PYRAMID_ENABLED,
    boostedPyramidMaxSameSidePerWindow: BOOSTED_PYRAMID_MAX_SAME_SIDE_PER_WINDOW,
    boostedPyramidMinReplayBoosts: BOOSTED_PYRAMID_MIN_REPLAY_BOOSTS,
    boostedPyramidMinEdge: BOOSTED_PYRAMID_MIN_EDGE,
    boostedPyramidMaxEntryPrice: BOOSTED_PYRAMID_MAX_ENTRY_PRICE,
    boostedPyramidStrategies: BOOSTED_PYRAMID_STRATEGIES,
    maxConsecutiveLosses: EFFECTIVE_MAX_CONSECUTIVE_LOSSES,
    maxDailyLossFraction: ACTIVE_MAX_DAILY_LOSS_FRACTION,
    minConsensusAgreement: CONSENSUS_ENGINE_ENABLED ? CONSENSUS_MIN_AGENTS_FOR_ENTRY : 0,
    consensusMinAgents: CONSENSUS_MIN_AGENTS_FOR_ENTRY,
    allowSingleAgentTinyEntry: CONSENSUS_ALLOW_SINGLE_AGENT_TINY_ENTRY,
    singleAgentStakeMultiplier: CONSENSUS_SINGLE_AGENT_STAKE_MULTIPLIER,
    currentPredictionEnabled: STRATEGY_CURRENT_PREDICTION_ENABLED,
    priceFieldEnabled: STRATEGY_PRICE_FIELD_ENABLED,
    stickyLagEnabled: STRATEGY_STICKY_LAG_ENABLED,
    dualSideEnabled: STRATEGY_DUAL_SIDE_ENABLED,
    orderbookPressureEnabled: STRATEGY_ORDERBOOK_PRESSURE_ENABLED,
    newMemberBandEnabled: STRATEGY_NEW_MEMBER_BAND_ENABLED,
    endcycleSniperEnabled: STRATEGY_ENDCYCLE_SNIPER_ENABLED,
    completeSetArbEnabled: STRATEGY_COMPLETE_SET_ARB_ENABLED,
    dualLimitHedgeEnabled: STRATEGY_DUAL_LIMIT_HEDGE_ENABLED,
    crossTimeframeEnabled: STRATEGY_CROSS_TIMEFRAME_ENABLED,
    weatherEnabled: STRATEGY_WEATHER_ENABLED,
    requireRealMarketData: GATE_REQUIRE_REAL_MARKET_DATA,
    blockSyntheticBook: GATE_BLOCK_SYNTHETIC_BOOK,
    blockLearningFallback: GATE_BLOCK_LEARNING_FALLBACK,
      profitFocusMode: PROFIT_FOCUS_MODE,
      strategyPerformance: effectiveStrategyPerformance,
      strategyRuntimePerformance: runtimeStrategyPerformance,
      learningBrain: IMPORTED_LEARNING_BRAIN,
      replayOptimizer: activeReplayOptimizer,
      runtimeRuleCacheEnabled: RUNTIME_RULE_CACHE_ENABLED,
      runtimeRuleCache,
      runtimeRuleCacheMinStakeMultiplier: RUNTIME_RULE_CACHE_MIN_STAKE_MULTIPLIER,
      runtimeRuleCacheMaxStakeMultiplier: RUNTIME_RULE_CACHE_MAX_STAKE_MULTIPLIER,
      runtimeRuleCacheMaxScoreAdjustment: RUNTIME_RULE_CACHE_MAX_SCORE_ADJUSTMENT,
      runtimeRuleCacheToxicMinTrades: RUNTIME_RULE_CACHE_TOXIC_MIN_TRADES,
      runtimeRuleCacheToxicMaxWinRate: RUNTIME_RULE_CACHE_TOXIC_MAX_WIN_RATE,
      runtimeRuleCacheToxicMinRoi: RUNTIME_RULE_CACHE_TOXIC_MIN_ROI,
      runtimeRuleCacheToxicStakeMultiplier: RUNTIME_RULE_CACHE_TOXIC_STAKE_MULTIPLIER,
      runtimeRuleCacheToxicScorePenalty: RUNTIME_RULE_CACHE_TOXIC_SCORE_PENALTY,
      softQualityMode: SOFT_QUALITY_MODE,
      calibratedEntryModelEnabled: CALIBRATED_ENTRY_MODEL_ENABLED,
      calibratedEntryModel,
      calibratedTargetWinRate: CALIBRATED_TARGET_WIN_RATE,
      calibratedLaneSMinWinProb: CALIBRATED_LANE_S_MIN_WIN_PROB,
      calibratedLaneAMinWinProb: CALIBRATED_LANE_A_MIN_WIN_PROB,
      calibratedLaneBMinWinProb: CALIBRATED_LANE_B_MIN_WIN_PROB,
      calibratedLaneAMinNetEv: CALIBRATED_LANE_A_MIN_NET_EV,
      calibratedLaneBMinNetEv: CALIBRATED_LANE_B_MIN_NET_EV,
      calibratedLaneBMaxStakeUsd: CALIBRATED_LANE_B_MAX_STAKE_USD,
      calibratedReplayLaneAMaxStakeUsd: CALIBRATED_REPLAY_LANE_A_MAX_STAKE_USD,
      calibratedClearWindowStart: CALIBRATED_CLEAR_WINDOW_START,
      calibratedClearWindowEnd: CALIBRATED_CLEAR_WINDOW_END,
      calibratedProfitWindowStart: CALIBRATED_PROFIT_WINDOW_START,
      calibratedProfitWindowEnd: CALIBRATED_PROFIT_WINDOW_END,
      calibratedHighScoreMin: CALIBRATED_HIGH_SCORE_MIN,
      fastCandidateBridgeEnabled: FAST_CANDIDATE_BRIDGE_ENABLED,
      fastWorthItLaneEnabled: FAST_WORTH_IT_LANE_ENABLED,
      fastWorthItMinEdge: FAST_WORTH_IT_MIN_EDGE,
      fastWorthItMinNetEv: FAST_WORTH_IT_MIN_NET_EV,
      fastWorthItMaxEntryPrice: FAST_WORTH_IT_MAX_ENTRY_PRICE,
      fastWorthItMaxSpreadCents: FAST_WORTH_IT_MAX_SPREAD_CENTS,
      fastWorthItMaxBookAgeMs: FAST_WORTH_IT_MAX_BOOK_AGE_MS,
      fastWorthItMinDepthShares: FAST_WORTH_IT_MIN_DEPTH_SHARES,
      fastWorthItUpMaxStakeUsd: FAST_WORTH_IT_UP_MAX_STAKE_USD,
      fastWorthItDownMaxStakeUsd: FAST_WORTH_IT_DOWN_MAX_STAKE_USD,
      startupProtectionSettledTrades: STARTUP_PROTECTION_SETTLED_TRADES,
      startupLaneAMaxStakeUsd: STARTUP_LANE_A_MAX_STAKE_USD,
      startupAPlusMaxStakeUsd: STARTUP_A_PLUS_MAX_STAKE_USD,
      startup15mMaxStakeUsd: STARTUP_15M_MAX_STAKE_USD,
      entryStarvationFailsafeEnabled: ENTRY_STARVATION_FAILSAFE_ENABLED,
      entryStarvationIdleMs: ENTRY_STARVATION_IDLE_MS,
      entryStarvationMinOpportunities: ENTRY_STARVATION_MIN_OPPORTUNITIES,
      entryStarvationMaxStakeUsd: ENTRY_STARVATION_MAX_STAKE_USD,
      routerEmptyDiagnosticsEnabled: ROUTER_EMPTY_DIAGNOSTICS_ENABLED,
      clusterGuardEnabled: CLUSTER_GUARD_ENABLED,
      startupProtectionRuntimeMs: STARTUP_PROTECTION_RUNTIME_MS,
      startupMaxTotalPositionsPerWindow: STARTUP_MAX_TOTAL_POSITIONS_PER_WINDOW,
      startupMaxFullStakePerWindow: STARTUP_MAX_FULL_STAKE_PER_WINDOW,
      startupMaxSameSideCryptoPerWindow: STARTUP_MAX_SAME_SIDE_CRYPTO_PER_WINDOW,
      clusterMaxTotalPositionsPerWindow: CLUSTER_MAX_TOTAL_POSITIONS_PER_WINDOW,
      clusterMaxNormalPositionsPerWindow: CLUSTER_MAX_NORMAL_POSITIONS_PER_WINDOW,
      maxSameSideCryptoPositionsPerWindow: MAX_SAME_SIDE_CRYPTO_POSITIONS_PER_WINDOW,
      maxFullStakeSameSidePerWindow: MAX_FULL_STAKE_SAME_SIDE_PER_WINDOW,
      price060064MaxStakeUsd: PRICE_060_064_MAX_STAKE_USD,
      price065082MaxStakeUsd: PRICE_065_082_MAX_STAKE_USD,
      bridgeUpMaxStakeUsd: BRIDGE_UP_MAX_STAKE_USD,
      bridgeDownMaxStakeUsd: BRIDGE_DOWN_MAX_STAKE_USD,
      sameWindowLossBrakeEnabled: SAME_WINDOW_LOSS_BRAKE_ENABLED,
      recentLossBrakeEnabled: RECENT_LOSS_BRAKE_ENABLED,
      edgeEngineEnabled: EDGE_ENGINE_ENABLED,
      edgeEngineTargetWinRate: EDGE_ENGINE_TARGET_WIN_RATE,
      edgeEngineLaneSMinWinProb: EDGE_ENGINE_LANE_S_MIN_WIN_PROB,
      edgeEngineLaneAMinWinProb: EDGE_ENGINE_LANE_A_MIN_WIN_PROB,
      edgeEngineLaneBMinWinProb: EDGE_ENGINE_LANE_B_MIN_WIN_PROB,
      edgeEngineLaneSMinNetEv: EDGE_ENGINE_LANE_S_MIN_NET_EV,
      edgeEngineLaneAMinNetEv: EDGE_ENGINE_LANE_A_MIN_NET_EV,
      edgeEngineLaneBMinNetEv: EDGE_ENGINE_LANE_B_MIN_NET_EV,
      edgeEngineMicrostructureWeight: EDGE_ENGINE_MICROSTRUCTURE_WEIGHT,
      edgeEngineDualProbabilityWeight: EDGE_ENGINE_DUAL_PROBABILITY_WEIGHT,
      edgeEngineKellyLiteFraction: EDGE_ENGINE_KELLY_LITE_FRACTION,
      edgeEngineKellyMaxFraction: EDGE_ENGINE_KELLY_MAX_FRACTION,
      edgeEngineLaneAMaxStakeUsd: EDGE_ENGINE_LANE_A_MAX_STAKE_USD,
      edgeEngineLaneBMaxStakeUsd: EDGE_ENGINE_LANE_B_MAX_STAKE_USD,
      edgeEnginePositiveBucketMinProb: EDGE_ENGINE_POSITIVE_BUCKET_MIN_PROB,
      edgeEnginePositiveBucketMinRoi: EDGE_ENGINE_POSITIVE_BUCKET_MIN_ROI,
      edgeEngineBadBucketMaxProb: EDGE_ENGINE_BAD_BUCKET_MAX_PROB,
      edgeEngineBadBucketMinRoi: EDGE_ENGINE_BAD_BUCKET_MIN_ROI,
      edgeEngineMaxBookAgeMs: EDGE_ENGINE_MAX_BOOK_AGE_MS,
      edgeEngineMaxLaneABookAgeMs: EDGE_ENGINE_MAX_LANE_A_BOOK_AGE_MS,
      edgeEnginePremiumBookAgeMs: EDGE_ENGINE_PREMIUM_BOOK_AGE_MS,
      edgeEngineMaxSpreadCents: EDGE_ENGINE_MAX_SPREAD_CENTS,
      edgeEngineMaxLaneASpreadCents: EDGE_ENGINE_MAX_LANE_A_SPREAD_CENTS,
      edgeEnginePremiumSpreadCents: EDGE_ENGINE_PREMIUM_SPREAD_CENTS,
      edgeEngineMinDepthShares: EDGE_ENGINE_MIN_DEPTH_SHARES,
      edgeEngineDepthReferenceShares: EDGE_ENGINE_DEPTH_REFERENCE_SHARES,
      edgeEngineMinDepthAdvantage: EDGE_ENGINE_MIN_DEPTH_ADVANTAGE,
      edgeEngineMinMicropriceEdgeCents: EDGE_ENGINE_MIN_MICROPRICE_EDGE_CENTS,
      edgeEnginePremiumDepthAdvantage: EDGE_ENGINE_PREMIUM_DEPTH_ADVANTAGE,
      edgeEnginePremiumMicropriceEdgeCents: EDGE_ENGINE_PREMIUM_MICROPRICE_EDGE_CENTS,
      edgeEngineSlippageBufferCents: EDGE_ENGINE_SLIPPAGE_BUFFER_CENTS,
      edgeEngineLaneAQualityMinScore: EDGE_ENGINE_LANE_A_QUALITY_MIN_SCORE,
      edgeEngineLaneSQualityMinScore: EDGE_ENGINE_LANE_S_QUALITY_MIN_SCORE,
      edgeEngineLaneBQualityMinScore: EDGE_ENGINE_LANE_B_QUALITY_MIN_SCORE,
      edgeEngineLaneADownQualityMinScore: EDGE_ENGINE_LANE_A_DOWN_QUALITY_MIN_SCORE,
      edgeEngineLaneBDownQualityMinScore: EDGE_ENGINE_LANE_B_DOWN_QUALITY_MIN_SCORE,
      edgeEnginePremiumWindowStart: EDGE_ENGINE_PREMIUM_WINDOW_START,
      edgeEnginePremiumWindowEnd: EDGE_ENGINE_PREMIUM_WINDOW_END,
      edgeEngineClearWindowStart: EDGE_ENGINE_CLEAR_WINDOW_START,
      edgeEngineClearWindowEnd: EDGE_ENGINE_CLEAR_WINDOW_END,
      calibratedFastFallbackScoreMin: CALIBRATED_FAST_FALLBACK_SCORE_MIN,
      calibratedObserveReplayBlock: CALIBRATED_OBSERVE_REPLAY_BLOCK,
      executionQualityEnabled: EXECUTION_QUALITY_ENABLED,
      executionMinQualityScore: EXECUTION_MIN_QUALITY_SCORE,
      executionExceptionalQualityScore: EXECUTION_EXCEPTIONAL_QUALITY_SCORE,
      executionMaxFullStakeBookAgeMs: EXECUTION_MAX_FULL_STAKE_BOOK_AGE_MS,
      executionMaxReducedBookAgeMs: EXECUTION_MAX_REDUCED_BOOK_AGE_MS,
      executionReplayBadPenalty: EXECUTION_REPLAY_BAD_PENALTY,
      executionRuntimeToxicPenalty: EXECUTION_RUNTIME_TOXIC_PENALTY,
      executionSuspiciousEdgePercent: EXECUTION_SUSPICIOUS_EDGE_PERCENT,
      executionSuspiciousEdgePenalty: EXECUTION_SUSPICIOUS_EDGE_PENALTY,
      executionMode: EXECUTION_MODE,
      cleanUpMinScore: CLEAN_UP_MIN_SCORE,
      cleanDownMinScore: CLEAN_DOWN_MIN_SCORE,
      replayBlockUpMinScore: REPLAY_BLOCK_UP_MIN_SCORE,
      replayBlockDownObserveOnly: REPLAY_BLOCK_DOWN_OBSERVE_ONLY,
      replaySoftBlockUpStakeMultiplier: REPLAY_SOFT_BLOCK_UP_STAKE_MULTIPLIER,
      replaySoftBlockDownStakeMultiplier: REPLAY_SOFT_BLOCK_DOWN_STAKE_MULTIPLIER,
      replaySoftBlockScorePenalty: REPLAY_SOFT_BLOCK_SCORE_PENALTY,
      executionLowScoreObserveOnly: EXECUTION_LOW_SCORE_OBSERVE_ONLY,
      executionLowScoreObserveMax: EXECUTION_LOW_SCORE_OBSERVE_MAX,
      recoveryMode: executionRecoveryRegime,
      recoveryDownMinScore: RECOVERY_DOWN_MIN_SCORE,
      recoveryReplayBlockObserveOnly: RECOVERY_REPLAY_BLOCK_OBSERVE_ONLY,
      strategyAutoDisableEnabled: STRATEGY_AUTO_DISABLE_ENABLED,
      strategyAutoDisableMinSamples: STRATEGY_AUTO_DISABLE_MIN_SAMPLES,
      strategyAutoDisableMinRoi: STRATEGY_AUTO_DISABLE_MIN_ROI,
      strategyAutoDisableMinWinRate: STRATEGY_AUTO_DISABLE_MIN_WIN_RATE,
      strategyRuntimeAutoDisableEnabled: STRATEGY_RUNTIME_AUTO_DISABLE_ENABLED,
      strategyRuntimeAutoDisableMinSamples: STRATEGY_RUNTIME_AUTO_DISABLE_MIN_SAMPLES,
      strategyRuntimeAutoDisableMinRoi: STRATEGY_RUNTIME_AUTO_DISABLE_MIN_ROI,
      strategyRuntimeAutoDisableMinWinRate: STRATEGY_RUNTIME_AUTO_DISABLE_MIN_WIN_RATE,
      strategyForceAllow: STRATEGY_FORCE_ALLOW,
    strategyForceBlock: STRATEGY_FORCE_BLOCK,
    executableStrategies: STRATEGY_EXECUTABLE_STRATEGIES,
    noStakeReductionMode: NO_STAKE_REDUCTION_MODE,
    noEntryReductionMode: NO_ENTRY_REDUCTION_MODE,
    noBlockQualityCandidates: NO_BLOCK_QUALITY_CANDIDATES,
    candidateQualityEnabled: CANDIDATE_QUALITY_ENABLED,
    qualityMaxSpreadCents: QUALITY_MAX_SPREAD_CENTS,
    qualityEntryPriceMin: QUALITY_ENTRY_PRICE_MIN,
    qualityEntryPriceMax: QUALITY_ENTRY_PRICE_MAX,
    qualityHighEntryPrice: QUALITY_HIGH_ENTRY_PRICE,
    qualityHighPriceMinEdge: QUALITY_HIGH_PRICE_MIN_EDGE,
    qualityExceptionalEdge: QUALITY_EXCEPTIONAL_EDGE,
    qualityPriceFieldMinEdge: QUALITY_PRICE_FIELD_MIN_EDGE,
    qualityPriceFieldDownMinEdge: QUALITY_PRICE_FIELD_DOWN_MIN_EDGE,
    qualityPriceFieldMinDepthAdvantage: QUALITY_PRICE_FIELD_MIN_DEPTH_ADVANTAGE,
    qualityPriceFieldMinMicroEdgeCents: QUALITY_PRICE_FIELD_MIN_MICRO_EDGE_CENTS,
    qualityDualSideMinEdge: QUALITY_DUAL_SIDE_MIN_EDGE,
    qualityDualSideMinDepthAdvantage: QUALITY_DUAL_SIDE_MIN_DEPTH_ADVANTAGE,
    qualityDualSideMinMicroEdgeCents: QUALITY_DUAL_SIDE_MIN_MICRO_EDGE_CENTS,
    qualityDualSideRestrictAfterSeconds: QUALITY_DUAL_SIDE_RESTRICT_AFTER_SECONDS,
    qualityDualSideAPlusAfterSeconds: QUALITY_DUAL_SIDE_A_PLUS_AFTER_SECONDS,
    qualityDualSideHardBlockAfterSeconds: QUALITY_DUAL_SIDE_HARD_BLOCK_AFTER_SECONDS,
    qualityDualSideRestrictedMinEdge: QUALITY_DUAL_SIDE_RESTRICTED_MIN_EDGE,
    qualityDualSideRestrictedMinDepthAdvantage: QUALITY_DUAL_SIDE_RESTRICTED_MIN_DEPTH_ADVANTAGE,
    qualityDualSideRestrictedMinMicroEdgeCents: QUALITY_DUAL_SIDE_RESTRICTED_MIN_MICRO_EDGE_CENTS,
    qualityDualSideLateAPlusMinEdge: QUALITY_DUAL_SIDE_LATE_A_PLUS_MIN_EDGE,
    qualityDualSideLateAPlusMinDepthAdvantage: QUALITY_DUAL_SIDE_LATE_A_PLUS_MIN_DEPTH_ADVANTAGE,
    qualityDualSideLateAPlusMinMicroEdgeCents: QUALITY_DUAL_SIDE_LATE_A_PLUS_MIN_MICRO_EDGE_CENTS,
    qualityDownProbabilityPenalty: QUALITY_DOWN_PROBABILITY_PENALTY,
    qualityDownEdgePenalty: QUALITY_DOWN_EDGE_PENALTY,
    qualityDownMinEdge: QUALITY_DOWN_MIN_EDGE,
    qualityDownMinDepthAdvantage: QUALITY_DOWN_MIN_DEPTH_ADVANTAGE,
    qualityDownMinMicroEdgeCents: QUALITY_DOWN_MIN_MICRO_EDGE_CENTS,
    qualityOrderbookMinEdge: QUALITY_ORDERBOOK_MIN_EDGE,
    qualityOrderbookMinConfirmations: QUALITY_ORDERBOOK_MIN_CONFIRMATIONS,
    qualityOrderbookMinPressure: QUALITY_ORDERBOOK_MIN_PRESSURE,
    qualityOrderbookMinDepthAdvantage: QUALITY_ORDERBOOK_MIN_DEPTH_ADVANTAGE,
    qualityOrderbookMinMicroEdgeCents: QUALITY_ORDERBOOK_MIN_MICRO_EDGE_CENTS,
    qualityCEntryEnabled: QUALITY_C_ENTRY_ENABLED,
    qualityAPlusRequireBookConfirmation: QUALITY_A_PLUS_REQUIRE_BOOK_CONFIRMATION,
    qualityAPlusMinDepthPressure: QUALITY_A_PLUS_MIN_DEPTH_PRESSURE,
    qualityAPlusMinDepthAdvantage: QUALITY_A_PLUS_MIN_DEPTH_ADVANTAGE,
    qualityAPlusMinMicroEdgeCents: QUALITY_A_PLUS_MIN_MICRO_EDGE_CENTS,
    qualityLateWindowSeconds: QUALITY_LATE_WINDOW_SECONDS,
    qualityLateEntryPrice: QUALITY_LATE_ENTRY_PRICE,
    qualityLateEntryMinEdge: QUALITY_LATE_ENTRY_MIN_EDGE,
    qualityLateEntryMinDepthAdvantage: QUALITY_LATE_ENTRY_MIN_DEPTH_ADVANTAGE,
    qualityLateEntryMinMicroEdgeCents: QUALITY_LATE_ENTRY_MIN_MICRO_EDGE_CENTS,
    qualityMomentumAgainstMaxBps: QUALITY_MOMENTUM_AGAINST_MAX_BPS,
    sampleQualityGuardEnabled: QUALITY_SAMPLE_GUARD_ENABLED,
    qualityInflatedEdgePercent: QUALITY_INFLATED_EDGE_PERCENT,
    qualityLateWeakBookSeconds: QUALITY_LATE_WEAK_BOOK_SECONDS,
    qualityLateWeakBookEntryPrice: QUALITY_LATE_WEAK_BOOK_ENTRY_PRICE,
    qualityWeakBookWideSpreadCents: QUALITY_WEAK_BOOK_WIDE_SPREAD_CENTS,
    v351SideCompetitionEnabled: process.env.V351_SIDE_COMPETITION_ENABLED !== "0",
    v351SideGapScoreWeight: Number(process.env.V351_SIDE_GAP_SCORE_WEIGHT || 1.10),
    v351SideGapMaxAdjustment: Number(process.env.V351_SIDE_GAP_MAX_ADJUSTMENT || 28),
  };
}


function evaluateProfitLockState(signals = [], currentEquity = PAPER_START_BALANCE) {
  if (!PROFIT_LOCK_ENABLED) {
    return { enabled: false, mode: "off", currentEquity: toNumber(currentEquity, PAPER_START_BALANCE), peakEquity: null, peakProfitUsd: 0, givebackUsd: 0, givebackRatio: 0, sessionProfitUsd: 0, reasons: ["profit_lock_disabled"] };
  }
  const sorted = uniqueOfficialFinalSettled(Array.isArray(signals) ? signals : [])
    .slice()
    .sort((left, right) => Date.parse(left.settledAt || left.windowEnd || left.time || "") - Date.parse(right.settledAt || right.windowEnd || right.time || ""));
  let curveEquity = PAPER_START_BALANCE;
  let peakEquity = PAPER_START_BALANCE;
  for (const signal of sorted) {
    curveEquity += runtimeSignalPnl(signal);
    if (curveEquity > peakEquity) peakEquity = curveEquity;

    // Win-Safe Stake Reset: Reset peakEquity to current equity on key lane wins
    if (STAKE_RESET_ON_WIN_SAFE_ENABLED && signal.status === "paper_win") {
      const lane = String(signal.calibratedLane || signal.entryLane || "").toUpperCase().trim();
      const resetLanes = STAKE_RESET_WIN_SAFE_LANES.split(",").map((l) => l.trim().toUpperCase());
      if (resetLanes.includes(lane)) {
        peakEquity = curveEquity;
      }
    }
  }
  const effectiveEquity = Math.max(0, toNumber(currentEquity, curveEquity || PAPER_START_BALANCE));
  peakEquity = Math.max(peakEquity, effectiveEquity);
  const peakProfitUsd = Math.max(0, peakEquity - PAPER_START_BALANCE);
  const sessionProfitUsd = effectiveEquity - PAPER_START_BALANCE;
  const givebackUsd = Math.max(0, peakEquity - effectiveEquity);
  const givebackRatio = peakProfitUsd > 0 ? givebackUsd / peakProfitUsd : 0;
  const reasons = [];
  let mode = "normal";
  if (peakProfitUsd >= PROFIT_LOCK_MIN_PEAK_PROFIT_USD) {
    if (givebackRatio >= PROFIT_LOCK_HARD_RECOVERY_GIVEBACK_RATIO) {
      mode = "hard_recovery";
      reasons.push("profit_lock_hard_recovery_giveback");
    } else if (givebackRatio >= PROFIT_LOCK_GIVEBACK_RATIO) {
      mode = "profit_lock";
      reasons.push("profit_lock_giveback_guard");
    }
  }
  if (peakProfitUsd >= PROFIT_LOCK_AFTER_PROFIT_USD && mode === "normal") {
    reasons.push("profit_lock_peak_profit_watch");
  }
  return {
    enabled: true,
    mode,
    currentEquity: effectiveEquity,
    peakEquity,
    peakProfitUsd,
    sessionProfitUsd,
    givebackUsd,
    givebackRatio,
    reasons,
  };
}

function buildProtectedStakeCap(candidate = {}) {
  if (NO_STAKE_REDUCTION_MODE) {
    return { capUsd: null, reasons: ["no_stake_reduction_mode_stake_caps_disabled"] };
  }
  const caps = [];
  const reasons = [];
  const pushCap = (value, reason) => {
    const cap = toNumber(value, NaN);
    if (!Number.isFinite(cap) || cap <= 0) return;
    caps.push(cap);
    reasons.push(reason);
  };
  const entryPrice = toNumber(candidate.entryPrice ?? candidate.selectedBuyPrice, 0);
  const secondsIntoWindow = toNumber(candidate.secondsIntoWindow, 0);
  const bookSource = String(candidate.bookSource || "unknown").toLowerCase().trim();
  const softReasons = Array.isArray(candidate.softQualityReasons) ? candidate.softQualityReasons : [];
  const replayReason = String(candidate.replayOptimizerDecision?.reason || candidate.replayOptimizer?.reason || candidate.replayOptimizerReason || "").toLowerCase();
  const replayRules = Array.isArray(candidate.replayOptimizerDecision?.matchedRules)
    ? candidate.replayOptimizerDecision.matchedRules
    : Array.isArray(candidate.replayOptimizer?.matchedRules)
      ? candidate.replayOptimizer.matchedRules
      : [];
  const replayBad = replayReason.includes("replay_block") || replayRules.some((rule) => String(rule?.id || rule).toLowerCase().includes("bad"));
  const side = String(candidate.side || candidate.predictedOutcome || candidate.direction || "").toUpperCase();
  const runtimeDecision = candidate.runtimeRuleCache || candidate.runtimeRuleCacheDecision || {};
  const runtimeReason = String(candidate.runtimeRuleReason || runtimeDecision.reason || "");
  const matchedBuckets = Array.isArray(candidate.runtimeMatchedBuckets)
    ? candidate.runtimeMatchedBuckets
    : Array.isArray(runtimeDecision.matchedBuckets)
      ? runtimeDecision.matchedBuckets
      : [];
  const hasToxicBucket = /toxic/i.test(runtimeReason) || matchedBuckets.some((bucket) => bucket && (bucket.toxic || bucket.action === "probe_only_toxic"));
  const calibratedStakeCapUsd = toNumber(candidate.executionQuality?.calibratedStakeCapUsd ?? candidate.calibratedProfile?.stakeCapUsd, 0);
  const calibratedLane = String(candidate.executionQuality?.calibratedLane || candidate.calibratedLane || "").toUpperCase();
  const executionScore = toNumber(candidate.executionQualityScore ?? candidate.executionQuality?.score, 0);
  const rank = String(candidate.rank || "").toUpperCase();
  const timeframe = String(candidate.timeframe || candidate.marketTimeframe || "").toUpperCase();
  const profitLockState = candidate.profitLockState || candidate.executionQuality?.profitLockState || {};
  const profitLockMode = String(candidate.profitLockMode || profitLockState.mode || "normal").toLowerCase();
  const currentVersionStats = candidate.currentVersionStats || {};
  const currentVersionSettled = toNumber(currentVersionStats.settled, 0);
  const currentVersionPnl = toNumber(currentVersionStats.pnl, 0);
  const currentVersionWinRate = toNumber(currentVersionStats.winRate, 0);
  const equityForStakeScaling = getSizingEquity(candidate.accountEquity ?? candidate.equity ?? profitLockState.currentEquity);
  const v333Guard = candidate.v333Guard || {};
  const isProfitWindow = secondsIntoWindow >= CALIBRATED_PROFIT_WINDOW_START && secondsIntoWindow < CALIBRATED_PROFIT_WINDOW_END;
  const isLaneS = calibratedLane === "S";
  const isLaneA = calibratedLane === "A";
  const isLaneF = calibratedLane === "F";
  const isLaneB = calibratedLane === "B" || calibratedLane === "PROBE";
  const laneSExtreme = isLaneS && isProfitWindow && executionScore >= DOWN_LANE_S_EXTREME_MIN_SCORE;

  if (EDGE_ENGINE_ENABLED && candidate.edgeEngineProfile) {
    const equityScaleCandidate = { ...candidate, side, timeframe, calibratedLane };
    if (isLaneB) pushCap(EDGE_ENGINE_LANE_B_MAX_STAKE_USD, "edge_lane_b_probe_cap");
    if (v333Guard.coldStart && (isLaneA || isLaneS)) pushCap(V333_COLD_START_LANE_A_CAP_USD, "v333_cold_start_lane_a_s_probe_cap");
    if (v333Guard.recoveryActive && !isLaneB) pushCap(V333_DRAWDOWN_PROBE_CAP_USD, "v333_recovery_non_probe_cap");
    if (isLaneA) {
      const laneACap = side === "DOWN"
        ? Math.min(
            scaleStakeCapForEquity(EDGE_ENGINE_LANE_A_MAX_STAKE_USD, equityForStakeScaling, equityScaleCandidate),
            scaleStakeCapForEquity(EDGE_ENGINE_DOWN_LANE_A_MAX_STAKE_USD, equityForStakeScaling, equityScaleCandidate),
          )
        : scaleStakeCapForEquity(EDGE_ENGINE_LANE_A_MAX_STAKE_USD, equityForStakeScaling, equityScaleCandidate);
      pushCap(laneACap, "edge_lane_a_equity_scaled_cap");
    }
    if (isLaneS && side === "DOWN") pushCap(scaleStakeCapForEquity(EDGE_ENGINE_DOWN_LANE_S_MAX_STAKE_USD, equityForStakeScaling, equityScaleCandidate), "edge_lane_s_down_equity_scaled_cap");
    if (isLaneS && EDGE_ENGINE_LANE_S_MAX_STAKE_USD > 0) pushCap(scaleStakeCapForEquity(EDGE_ENGINE_LANE_S_MAX_STAKE_USD, equityForStakeScaling, equityScaleCandidate), "edge_lane_s_equity_scaled_cap");
    if (S_LANE_THROTTLE_ENABLED && isLaneS) {
      if (currentVersionSettled < S_LANE_COLD_SETTLED_TRADES) {
        pushCap(S_LANE_COLD_MAX_STAKE_USD, "s_lane_cold_sample_cap");
      } else if (currentVersionPnl < S_LANE_FULL_STAKE_MIN_PNL_USD || currentVersionWinRate < S_LANE_FULL_STAKE_MIN_WIN_RATE) {
        pushCap(S_LANE_RECOVERY_MAX_STAKE_USD, "s_lane_session_quality_cap");
      }
    }
    if (timeframe === "15M" && isLaneS) pushCap(EDGE_ENGINE_15M_LANE_S_MAX_STAKE_USD, "edge_15m_lane_s_cap");
    else if (timeframe === "15M") pushCap(EDGE_ENGINE_15M_LANE_A_MAX_STAKE_USD, "edge_15m_reduced_cap");
    if (timeframe === "15M") pushCap(FIFTEEN_M_GLOBAL_MAX_STAKE_USD, "fifteen_m_global_sample_cap");
    if (profitLockMode === "profit_lock" && isLaneA) pushCap(PROFIT_LOCK_LANE_A_MAX_STAKE_USD, "profit_lock_lane_a_cap");
    if (profitLockMode === "hard_recovery" && !isLaneS) pushCap(Math.min(PROFIT_LOCK_HARD_LANE_A_MAX_STAKE_USD, V333_DRAWDOWN_PROBE_CAP_USD), "hard_recovery_non_s_lane_cap");
    if (bookSource === "rest+rest") pushCap(REST_BOOK_MAX_STAKE_USD, "rest_book_absolute_cap");
    if (entryPrice >= 0.65 && !isLaneS) pushCap(PRICE_065_082_MAX_STAKE_USD, "edge_high_price_non_s_cap");
    if (side === "DOWN" && !isLaneS && !isLaneA) pushCap(DOWN_MAX_STAKE_USD, "edge_down_probe_cap");
    if (hasToxicBucket && !isLaneS) pushCap(Math.min(RUNTIME_TOXIC_MAX_STAKE_USD, V333_DRAWDOWN_PROBE_CAP_USD), "runtime_toxic_non_s_cap");
    if (replayBad && !isLaneS) pushCap(Math.min(REPLAY_BLOCK_UP_MAX_STAKE_USD, V333_DRAWDOWN_PROBE_CAP_USD), "replay_bad_non_s_cap");
    if (!caps.length) return { capUsd: null, reasons: [] };
    return { capUsd: Math.min(...caps), reasons };
  }

  if (calibratedStakeCapUsd > 0) pushCap(calibratedStakeCapUsd, `calibrated_lane_${calibratedLane || "probe"}_absolute_cap`);
  if (isLaneF) pushCap(side === "DOWN" ? Math.min(FAST_WORTH_IT_DOWN_MAX_STAKE_USD, BRIDGE_DOWN_MAX_STAKE_USD) : Math.min(FAST_WORTH_IT_UP_MAX_STAKE_USD, BRIDGE_UP_MAX_STAKE_USD), "lane_f_fast_worth_it_cap");
  if (isLaneB) pushCap(PROFIT_LOCK_LANE_B_MAX_STAKE_USD, "lane_b_probe_cap");
  if (isLaneA) {
    if (secondsIntoWindow >= 30 && secondsIntoWindow < 45) pushCap(WINDOW_30_45_LANE_A_MAX_STAKE_USD, "lane_a_window_30_45_reduced_cap");
    else if (isProfitWindow && LANE_A_PROFIT_WINDOW_MAX_STAKE_USD < PAPER_MAX_TRADE_USD) pushCap(LANE_A_PROFIT_WINDOW_MAX_STAKE_USD, "lane_a_profit_window_allowed_cap");
    else if (secondsIntoWindow >= 60 && secondsIntoWindow < 75) pushCap(WINDOW_60_75_LANE_A_MAX_STAKE_USD, "lane_a_window_60_75_reduced_cap");
    else pushCap(LANE_A_DEFAULT_MAX_STAKE_USD, "lane_a_default_reduced_cap");
  }
  if (secondsIntoWindow >= 75 && secondsIntoWindow < 105) pushCap(WINDOW_75_105_PROBE_MAX_STAKE_USD, "window_75_105_probe_cap");
  if (secondsIntoWindow >= 105) pushCap(WINDOW_105_135_PROBE_MAX_STAKE_USD, "window_105_135_probe_cap");
  if (timeframe === "15M" && !laneSExtreme) pushCap(TIMEFRAME_15M_MAX_STAKE_USD, "timeframe_15m_reduced_cap");
  if (timeframe === "15M") pushCap(FIFTEEN_M_GLOBAL_MAX_STAKE_USD, "fifteen_m_global_sample_cap");
  if (side === "DOWN" && !laneSExtreme) pushCap(DOWN_MAX_STAKE_USD, "down_reduced_cap");
  if (rank === "A+" && !(isLaneS && isProfitWindow && executionScore >= A_PLUS_FULL_STAKE_MIN_SCORE) && !laneSExtreme) {
    pushCap(Math.min(A_PLUS_NON_PREMIUM_MAX_STAKE_USD, 2.20), "a_plus_overconfidence_cap");
  }
  if (profitLockMode === "profit_lock") {
    if (isLaneA) pushCap(PROFIT_LOCK_LANE_A_MAX_STAKE_USD, "profit_lock_lane_a_cap");
    if (isLaneB) pushCap(PROFIT_LOCK_LANE_B_MAX_STAKE_USD, "profit_lock_lane_b_cap");
  }
  if (profitLockMode === "hard_recovery") {
    if (!isLaneS) pushCap(PROFIT_LOCK_HARD_LANE_A_MAX_STAKE_USD, "hard_recovery_non_s_lane_cap");
    if (isLaneB) pushCap(PROFIT_LOCK_LANE_B_MAX_STAKE_USD, "hard_recovery_lane_b_cap");
  }
  if (hasToxicBucket) pushCap(RUNTIME_TOXIC_MAX_STAKE_USD, "runtime_toxic_absolute_cap");
  if (replayBad && side === "UP") pushCap(REPLAY_BLOCK_UP_MAX_STAKE_USD, "replay_block_up_probe_cap");
  if (side === "DOWN" && (replayBad || /probe|toxic/i.test(runtimeReason) || toNumber(candidate.executionQualityScore, 0) < RECOVERY_DOWN_MIN_SCORE)) {
    pushCap(DOWN_RECOVERY_MAX_STAKE_USD, "down_recovery_absolute_cap");
  }
  if (toNumber(candidate.runtimeStakeMultiplier, 1) <= 0.25 || /probe/i.test(runtimeReason)) {
    pushCap(RUNTIME_PROBE_MAX_STAKE_USD, "runtime_probe_absolute_cap");
  }
  if (toNumber(candidate.softQualityStakeMultiplier, 1) < 0.50 || softReasons.some((reason) => /probe|tiny|rest_rest|overconfidence|late|price_0\.65|price_0\.70/i.test(String(reason)))) {
    pushCap(SOFT_QUALITY_PROBE_MAX_STAKE_USD, "soft_quality_probe_absolute_cap");
  }
  if (bookSource === "rest+rest") pushCap(REST_BOOK_MAX_STAKE_USD, "rest_book_absolute_cap");
  if (secondsIntoWindow >= 75 && secondsIntoWindow < 105) pushCap(LATE_75_105_MAX_STAKE_USD, "late_75_105_absolute_cap");
  if (secondsIntoWindow >= 105) pushCap(LATE_105_135_MAX_STAKE_USD, "late_105_135_absolute_cap");
  if (entryPrice >= 0.55 && entryPrice < 0.60) pushCap(PRICE_055_059_MAX_STAKE_USD, "price_055_059_absolute_cap");
  if (entryPrice >= 0.60 && entryPrice < 0.65 && !(isLaneS && isProfitWindow && executionScore >= A_PLUS_FULL_STAKE_MIN_SCORE)) pushCap(PRICE_060_064_MAX_STAKE_USD, "price_060_064_cluster_cap");
  if (entryPrice >= 0.65 && entryPrice < 0.70) pushCap(Math.min(PRICE_065_069_MAX_STAKE_USD, PRICE_065_082_MAX_STAKE_USD), "price_065_069_absolute_cap");
  if (entryPrice >= 0.70 && entryPrice <= 0.82) pushCap(Math.min(PRICE_070_082_MAX_STAKE_USD, PRICE_065_082_MAX_STAKE_USD), "price_070_082_absolute_cap");

  if (!caps.length) return { capUsd: null, reasons: [] };
  return { capUsd: Math.min(...caps), reasons };
}

function shouldDisableProgressiveBoost(candidate = {}) {
  if (NO_STAKE_REDUCTION_MODE) return false;
  const cap = buildProtectedStakeCap(candidate);
  const softMultiplier = toNumber(candidate.softQualityStakeMultiplier, 1);
  const runtimeMultiplier = toNumber(candidate.runtimeStakeMultiplier, 1);
  const runtimeDecision = candidate.runtimeRuleCache || candidate.runtimeRuleCacheDecision || {};
  const runtimeReason = String(candidate.runtimeRuleReason || runtimeDecision.reason || "");
  const replayReason = String(candidate.replayOptimizerDecision?.reason || candidate.replayOptimizer?.reason || candidate.replayOptimizerReason || "").toLowerCase();
  const replayRules = Array.isArray(candidate.replayOptimizerDecision?.matchedRules)
    ? candidate.replayOptimizerDecision.matchedRules
    : Array.isArray(candidate.replayOptimizer?.matchedRules)
      ? candidate.replayOptimizer.matchedRules
      : [];
  const replayBad = replayReason.includes("replay_block") || replayRules.some((rule) => String(rule?.id || rule).toLowerCase().includes("bad"));
  const recoveryActive = Boolean(candidate.executionQuality?.recoveryActive || candidate.executionRecoveryActive);
  const profitLockMode = String(candidate.profitLockMode || candidate.profitLockState?.mode || candidate.executionQuality?.profitLockState?.mode || "normal").toLowerCase();
  const profitLockActive = PROFIT_LOCK_DISABLE_PROGRESSIVE && (profitLockMode === "profit_lock" || profitLockMode === "hard_recovery");
  const bookSource = String(candidate.bookSource || "unknown").toLowerCase().trim();
  return Boolean(
    cap.reasons.length ||
    softMultiplier < 0.50 ||
    runtimeMultiplier <= 0.25 ||
    /toxic|probe/i.test(runtimeReason) ||
    replayBad ||
    (RECOVERY_NO_PROGRESSIVE_BOOST && recoveryActive) ||
    profitLockActive ||
    bookSource === "rest+rest"
  );
}

function applyStrategySelectionToPrediction(prediction, routerDecision, accountRisk) {
  if (!STRATEGY_ROUTER_ENABLED || !routerDecision) return prediction;
  const selected = routerDecision.selected;
  const base = {
    ...prediction,
    strategyRouter: routerDecision,
    gateProtocol: selected?.gates || routerDecision.candidates[0]?.gates || createEmptyGateProtocol({ reason: "no_strategy_candidates" }),
    candidateCount: routerDecision.summary?.total || 0,
    approvedCandidateCount: routerDecision.summary?.approved || 0,
  };
  if (!selected) {
    const firstBlocked = routerDecision.candidates[0]?.blockedAt;
    return {
      ...base,
      tradeable: false,
      riskApproved: false,
      reason: firstBlocked?.reason || routerDecision.candidates[0]?.blockedReason || prediction.reason || "no_strategy_candidate_approved",
      riskReason: firstBlocked?.reason || routerDecision.candidates[0]?.blockedReason || prediction.riskReason || "no_strategy_candidate_approved",
    };
  }

  const side = selected.side === "DOWN" ? "Down" : selected.side === "BOTH" ? prediction.predictedOutcome : "Up";
  const progressiveSignals = PROGRESSIVE_CURRENT_VERSION_ONLY
    ? (prediction.signals || []).filter((signal) => signal.strategyVersion === BTC_PREDICTION_STRATEGY_VERSION)
    : (prediction.signals || []);
  const progressiveStage = PROGRESSIVE_STAKE_ENABLED
    ? getProgressiveStage({
        signals: progressiveSignals,
        accountRisk,
        equity: accountRisk.balance || PAPER_START_BALANCE,
        config: {
          growthSettled: PROGRESSIVE_GROWTH_SETTLED,
          aggressiveSettled: PROGRESSIVE_AGGRESSIVE_SETTLED,
          warmupStakeMultiplier: PROGRESSIVE_WARMUP_STAKE_MULTIPLIER,
          growthStakeMultiplier: PROGRESSIVE_GROWTH_STAKE_MULTIPLIER,
          aggressiveStakeMultiplier: PROGRESSIVE_AGGRESSIVE_STAKE_MULTIPLIER,
          recoveryStakeMultiplier: PROGRESSIVE_RECOVERY_STAKE_MULTIPLIER,
          recoveryLossStreak: PROGRESSIVE_RECOVERY_LOSS_STREAK,
          growthMinWinRate: PROGRESSIVE_GROWTH_MIN_WIN_RATE,
          aggressiveMinWinRate: PROGRESSIVE_AGGRESSIVE_MIN_WIN_RATE,
          aggressiveMinRoi: PROGRESSIVE_AGGRESSIVE_MIN_ROI,
          maxDailyLossFraction: ACTIVE_MAX_DAILY_LOSS_FRACTION,
        },
      })
    : { stage: "fixed", reason: "progressive_stake_disabled", stakeMultiplier: 1, stats: {} };
  const currentVersionStats = summarizeCurrentVersionSettled(prediction.signals || []);

  const accountEquity = getSizingEquity(accountRisk.balance || PAPER_START_BALANCE);
  const preliminaryCalibratedNetEv = evaluateCalibratedNetEv({
    rawConfidence: selected.confidence,
    executablePrice: selected.entryPrice,
    secondsIntoWindow: selected.secondsIntoWindow ?? prediction.secondsIntoWindow,
    feeRate: prediction.takerFeeRate ?? PAPER_CRYPTO_TAKER_FEE_RATE,
  });
  const selectedCoreDirection = normalizeCoreDirection(selected.side || side);
  const modelAssetProbabilityUp = toNumber(
    prediction.independentProbabilityModel?.assetProbabilityUp ??
    prediction.independentProbabilityModel?.probabilityUp ??
    prediction.pAssetUp,
    Number.NaN,
  );
  const independentModelDirection = Number.isFinite(modelAssetProbabilityUp)
    ? (modelAssetProbabilityUp >= 0.5 ? "UP" : "DOWN")
    : normalizeCoreDirection(prediction.predictedOutcome);
  const observerProbability = resolveObserverExecutionProbability({
    executionEnabled: ANTI_DOWNGRADE_SHADOW_EXECUTION_ENABLED,
    reader: observerPolicyReader,
    input: {
      assetProbability: selected.assetProbability,
      symbol: prediction.symbol || selected.symbol,
      direction: selectedCoreDirection,
      selectedBuyPrice: selected.entryPrice,
      confidence: selected.confidence,
    },
  });
  const preliminaryIndependentAssetEdge = evaluateIndependentAssetEdge({
    assetProbability: observerProbability.effectiveProbability,
    executablePrice: selected.entryPrice,
    feeRate: prediction.takerFeeRate ?? PAPER_CRYPTO_TAKER_FEE_RATE,
    minNetEdge: INDEPENDENT_ASSET_MIN_NET_EDGE,
    stressSlippagePerShare: INDEPENDENT_ASSET_STRESS_SLIPPAGE_PER_SHARE,
  });
  const regimeCorePolicy = evaluateRegimeCorePolicy({
    confidence: selected.confidence,
    executablePrice: selected.entryPrice,
    selectedDirection: selectedCoreDirection,
    modelDirection: independentModelDirection,
    independentAssetEdge: preliminaryIndependentAssetEdge,
    observerProbability,
  }, {
    minConfidence: MAIN_ACCURACY_MIN_CONFIDENCE,
    minEntryPrice: MAIN_ACCURACY_MIN_ENTRY_PRICE,
    maxEntryPrice: MAIN_ACCURACY_MAX_ENTRY_PRICE,
  });
  const cohortRegimeGuard = evaluateCohortRegimeGuard(prediction.signals || [], {
    symbol: prediction.symbol || selected.symbol,
    direction: selectedCoreDirection,
    selectedBuyPrice: selected.entryPrice,
  }, {
    enabled: COHORT_REGIME_GUARD_ENABLED,
    lookback: COHORT_REGIME_GUARD_LOOKBACK,
    lossTrigger: COHORT_REGIME_GUARD_LOSS_TRIGGER,
    ttlSettlements: COHORT_REGIME_GUARD_TTL_SETTLEMENTS,
  });
  const regimeCoreEconomics = buildRegimeCoreEconomics(regimeCorePolicy, preliminaryIndependentAssetEdge, observerProbability);
  const fastGrowEvPolicy = FAST_GROW_EV_POLICY_ENABLED
    ? classifyFastGrowEv(regimeCoreEconomics, {
        minNetEdge: FAST_GROW_EV_MIN_NET_EDGE,
        laneSMinNetEdge: FAST_GROW_EV_LANE_S_MIN_NET_EDGE,
        laneCeiling: cohortRegimeGuard.laneCeiling,
        laneSEvidenceReady: regimeCorePolicy.eligible === true,
      })
    : null;
  const calibratedLane = FAST_GROW_EV_POLICY_ENABLED
    ? fastGrowEvPolicy.lane
    : (selected.executionQuality?.calibratedLane || selected.calibratedLane || legacyLaneFromRank(selected.rank || "B"));
  const profitLockState = evaluateProfitLockState(prediction.signals || [], accountEquity);
  const v333Guard = buildV333DrawdownGuardState({
    signals: prediction.signals || [],
    selected,
    accountEquity,
    calibratedLane,
    profitLockState,
  });
  const v334StrictGuard = buildV334StrictEntryGuard({
    signals: prediction.signals || [],
    selected,
    market: prediction,
  });
  const selectedWithProfitLock = {
    ...selected,
    accountEquity,
    equity: accountEquity,
    calibratedLane,
    profitLockState,
    profitLockMode: profitLockState.mode,
    currentVersionStats,
    v333Guard,
    v334StrictGuard,
    executionQuality: {
      ...(selected.executionQuality || {}),
      calibratedLane,
      profitLockState,
    },
  };
  const v337PriorityRaw = buildV337PriorityProfile(selectedWithProfitLock);
  const v337Priority = NO_STAKE_REDUCTION_MODE
    ? { ...v337PriorityRaw, stakeMultiplier: Math.max(1, toNumber(v337PriorityRaw.stakeMultiplier, 1)), reasons: [...(v337PriorityRaw.reasons || []), "no_stake_reduction_mode"] }
    : v337PriorityRaw;
  const protectedStakeCap = buildProtectedStakeCap(selectedWithProfitLock);
  const effectiveProgressiveMultiplier = shouldDisableProgressiveBoost(selectedWithProfitLock)
    ? 1
    : (progressiveStage.stakeMultiplier || 1);
  const dynamicMaxTradeUsd = getDynamicMaxTradeUsd(accountEquity, calibratedLane, selectedWithProfitLock);
  const equityStakeScale = getEquityStakeScale(accountEquity, selectedWithProfitLock);
  let rawRecommendedStakeUsd = sizeStake(accountEquity, {
    rank: selected.rank,
    stakeMultiplier: (NO_STAKE_REDUCTION_MODE ? Math.max(1, selected.stakeMultiplier || 1) : (selected.stakeMultiplier || 1)) * effectiveProgressiveMultiplier,
    kellyFraction: Math.max(0, selected.feeAdjustedEdge || 0),
  }, {
    maxStakeFractionAPlus: ACTIVE_MAX_STAKE_FRACTION_A_PLUS,
    maxStakeFractionA: ACTIVE_MAX_STAKE_FRACTION_A,
    maxStakeFractionB: ACTIVE_MAX_STAKE_FRACTION_B,
    maxStakeFractionC: ACTIVE_MAX_STAKE_FRACTION_C,
    maxTradeUsd: dynamicMaxTradeUsd,
    kellySizingEnabled: KELLY_SIZING_ENABLED,
    kellyFractionMultiplier: KELLY_FRACTION,
    kellyMaxFraction: KELLY_MAX_FRACTION,
    kellyMinFraction: KELLY_MIN_FRACTION,
  });
  const fastGrowSizing = FAST_GROW_EV_POLICY_ENABLED
    ? sizeFastGrowStake({
        policy: fastGrowEvPolicy,
        calibratedNetEv: preliminaryCalibratedNetEv,
        equity: accountEquity,
        entryPrice: selected.entryPrice,
        depthShares: selected.depthShares,
        maxTradeUsd: dynamicMaxTradeUsd,
        minimumOrderShares: toNumber(prediction.minOrderSize, Number.NaN),
        minimumRecordedFillUsd: PAPER_MIN_RECORDED_FILL_USD,
      }, {
        minNetEdge: FAST_GROW_EV_MIN_NET_EDGE,
        laneSMinNetEdge: FAST_GROW_EV_LANE_S_MIN_NET_EDGE,
        laneAMinFraction: FAST_GROW_EV_LANE_A_MIN_FRACTION,
        laneAMaxFraction: FAST_GROW_EV_LANE_A_MAX_FRACTION,
        laneSMinFraction: FAST_GROW_EV_LANE_S_MIN_FRACTION,
        laneSMaxFraction: FAST_GROW_EV_LANE_S_MAX_FRACTION,
        laneSMaxEdge: FAST_GROW_EV_LANE_S_MAX_EDGE,
        depthUtilization: FAST_GROW_DEPTH_UTILIZATION,
      })
    : null;
  if (FAST_GROW_EV_POLICY_ENABLED) rawRecommendedStakeUsd = fastGrowSizing.stakeUsd;
  const edgeProfile = selected.edgeEngineProfile || selected.executionQuality?.edgeEngineProfile || selected.executionQuality?.calibratedProfile || selected.calibratedProfile || {};
  const edgeLane = String(calibratedLane || selected.executionQuality?.calibratedLane || selected.calibratedLane || legacyLaneFromRank(selected.rank || "B")).toUpperCase();
  const edgeLaneScaleCandidate = { ...selectedWithProfitLock, lane: edgeLane, calibratedLane: edgeLane };
  const equityScaledLaneCapUsd = edgeLane === "S"
    ? Math.min(
        scaleStakeCapForEquity(EDGE_ENGINE_LANE_S_MAX_STAKE_USD, accountEquity, edgeLaneScaleCandidate),
        String(selected.side || "").toUpperCase() === "DOWN"
          ? scaleStakeCapForEquity(EDGE_ENGINE_DOWN_LANE_S_MAX_STAKE_USD, accountEquity, edgeLaneScaleCandidate)
          : Number.POSITIVE_INFINITY,
      )
    : edgeLane === "A"
      ? Math.min(
          scaleStakeCapForEquity(EDGE_ENGINE_LANE_A_MAX_STAKE_USD, accountEquity, edgeLaneScaleCandidate),
          String(selected.side || "").toUpperCase() === "DOWN"
            ? scaleStakeCapForEquity(EDGE_ENGINE_DOWN_LANE_A_MAX_STAKE_USD, accountEquity, edgeLaneScaleCandidate)
            : Number.POSITIVE_INFINITY,
        )
      : edgeLane === "B" || edgeLane === "PROBE"
        ? EDGE_ENGINE_LANE_B_MAX_STAKE_USD
        : dynamicMaxTradeUsd;
  if (!FAST_GROW_EV_POLICY_ENABLED && EDGE_ENGINE_ENABLED && EDGE_ENGINE_KELLY_LITE_ENABLED && edgeProfile && edgeProfile.enabled !== false) {
    const equityForSizing = Math.max(MIN_EXECUTABLE_STAKE_USD, accountEquity);
    const kellyLiteFraction = Math.max(0, toNumber(edgeProfile.kellyLiteFraction, 0));
    let edgeStakeUsd = equityForSizing * kellyLiteFraction;
    if (edgeLane === "S") {
      edgeStakeUsd = Math.max(edgeStakeUsd, Math.min(dynamicMaxTradeUsd, equityForSizing * 0.06));
      edgeStakeUsd = Math.min(edgeStakeUsd, dynamicMaxTradeUsd, equityScaledLaneCapUsd);
    } else if (edgeLane === "A") {
      edgeStakeUsd = Math.max(edgeStakeUsd, Math.min(EDGE_ENGINE_LANE_A_MIN_STAKE_USD, dynamicMaxTradeUsd));
      edgeStakeUsd = Math.min(edgeStakeUsd, equityScaledLaneCapUsd, dynamicMaxTradeUsd);
    } else if (edgeLane === "B" || edgeLane === "PROBE") {
      edgeStakeUsd = Math.max(edgeStakeUsd, EDGE_ENGINE_LANE_B_MIN_STAKE_USD);
      edgeStakeUsd = Math.min(edgeStakeUsd, EDGE_ENGINE_LANE_B_MAX_STAKE_USD, dynamicMaxTradeUsd);
    } else {
      // Rank C, D, or unknown — cap at Lane B max (lowest quality = smallest cap)
      edgeStakeUsd = Math.min(edgeStakeUsd, EDGE_ENGINE_LANE_B_MAX_STAKE_USD, dynamicMaxTradeUsd);
    }
    if (toNumber(edgeProfile.netEv, 0) > 0 && edgeStakeUsd > 0) {
      const finalEdgeStakeUsd = edgeStakeUsd * (NO_STAKE_REDUCTION_MODE ? Math.max(1, selected.stakeMultiplier || 1) : (selected.stakeMultiplier || 1));
      rawRecommendedStakeUsd = Math.max(rawRecommendedStakeUsd, finalEdgeStakeUsd);
    }
  }
  if (!FAST_GROW_EV_POLICY_ENABLED && v337Priority.enabled && toNumber(edgeProfile.netEv ?? selected.netEv ?? selected.feeAdjustedEdge, 0) > 0) {
    rawRecommendedStakeUsd *= v337Priority.stakeMultiplier;
  }
  let recommendedStakeUsd = protectedStakeCap.capUsd
    ? Math.min(rawRecommendedStakeUsd, protectedStakeCap.capUsd)
    : rawRecommendedStakeUsd;

  const fastGrowApproved = !FAST_GROW_EV_POLICY_ENABLED || Boolean(fastGrowEvPolicy?.executable && fastGrowSizing?.executable);
  const independentAssetApproved = !INDEPENDENT_ASSET_EDGE_ENABLED || preliminaryIndependentAssetEdge.eligible === true;
  const regimeCoreApproved = !REGIME_CORE_POLICY_ENABLED || regimeCorePolicy.eligible === true;
  const bookConfirmationApproved = selected.bookConfirmed === true;
  const entryApproved = Boolean(
    v334StrictGuard.approved &&
    regimeCoreApproved &&
    independentAssetApproved &&
    bookConfirmationApproved &&
    fastGrowApproved
  );
  const entryBlockReason = !v334StrictGuard.approved
    ? "v334_strict_entry_block"
    : !regimeCoreApproved
      ? (regimeCorePolicy.reason || "regime_core_policy_block")
    : !independentAssetApproved
      ? (preliminaryIndependentAssetEdge.reason || "independent_asset_net_edge_block")
      : !bookConfirmationApproved
        ? "order_book_not_confirming_independent_asset_direction"
        : FAST_GROW_EV_POLICY_ENABLED && !fastGrowEvPolicy?.executable
          ? (fastGrowEvPolicy?.reason || "fastgrow_net_ev_block")
          : FAST_GROW_EV_POLICY_ENABLED && !fastGrowSizing?.executable
            ? (fastGrowSizing?.reason || "fastgrow_stake_not_executable")
            : "approved";

  return {
    ...base,
    predictedOutcome: side,
    selectedStrategy: selected.strategy,
    strategy: selected.strategy,
    selectedBuyPrice: selected.entryPrice,
    selectedBidPrice: selected.bidPrice,
    selectedSpreadCents: selected.spreadCents,
    selectedProbability: selected.probability,
    assetProbability: selected.assetProbability ?? selected.probability,
    assetConfidence: selected.assetConfidence ?? selected.confidence,
    assetNetEdge: preliminaryIndependentAssetEdge.netEdge ?? selected.assetNetEdge ?? null,
    confidence: selected.confidence,
    feeAdjustedEdge: selected.feeAdjustedEdge,
    selectedEdgePercent: selected.feeAdjustedEdge * 100,
    selectedDepthPressure: selected.depthPressure,
    sideDepthAdvantage: selected.depthAdvantage,
    selectedMicropriceEdgeCents: selected.micropriceEdgeCents,
    selectedAskSlopeCents: selected.askSlopeCents,
    bookConfirmationScore: selected.bookConfirmationScore ?? null,
    bookConfirmed: Boolean(selected.bookConfirmed),
    bookRankAdjustment: selected.bookRankAdjustment ?? 0,
    selectedCandidateReasons: selected.reasons || [],
    replayOptimizerDecision: selected.replayOptimizer || null,
    runtimeRuleCacheDecision: selected.runtimeRuleCache || null,
    runtimeScoreAdjustment: selected.runtimeScoreAdjustment || 0,
    runtimeStakeMultiplier: selected.runtimeStakeMultiplier || 1,
    runtimeRuleReason: selected.runtimeRuleReason || "runtime_rule_cache_neutral",
    runtimeMatchedBuckets: selected.runtimeMatchedBuckets || [],
    softQualityDecision: selected.softQuality || null,
    softQualityScoreAdjustment: selected.softQualityScoreAdjustment || 0,
    softQualityStakeMultiplier: selected.softQualityStakeMultiplier || 1,
    softQualityReasons: selected.softQualityReasons || [],
    currentVersionStats,
    executionQuality: selected.executionQuality || null,
    executionQualityScore: selected.executionQualityScore || 0,
    executionQualityThreshold: selected.executionQualityThreshold || 0,
    executionQualityReasons: selected.executionQualityReasons || [],
    executionObserveOnly: Boolean(selected.executionObserveOnly),
    rank: selected.rank,
    riskApproved: entryApproved,
    riskReason: entryApproved ? "approved" : entryBlockReason,
    reason: entryApproved ? "strategy_router_candidate_ready" : entryBlockReason,
    tradeable: entryApproved,
    recommendedStakeUsd,
    rawRecommendedStakeUsd,
    paperMaxTradeUsd: dynamicMaxTradeUsd,
    dynamicMaxTradeUsd,
    accountEquity,
    equityStakeScale,
    equityScaledLaneCapUsd,
    v337Priority,
    v337PriorityScore: v337Priority.score,
    v337PriorityStakeMultiplier: v337Priority.stakeMultiplier,
    v337PriorityReasons: v337Priority.reasons,
    calibratedLane,
    calibratedWinProbability: FAST_GROW_EV_POLICY_ENABLED
      ? regimeCoreEconomics.calibratedProbability ?? null
      : selected.executionQuality?.calibratedWinProbability ?? null,
    estimatedWinProbability: edgeProfile.estimatedWinProbability ?? edgeProfile.winProbability ?? selected.estimatedWinProbability ?? null,
    netEV: FAST_GROW_EV_POLICY_ENABLED
      ? regimeCoreEconomics.netEdge ?? null
      : edgeProfile.netEv ?? selected.netEv ?? null,
    projectedFillPrice: edgeProfile.projectedFillPrice ?? selected.projectedFillPrice ?? null,
    projectedSlippageCents: edgeProfile.projectedSlippageCents ?? null,
    edgeEngineProfile: edgeProfile || null,
    bucketExpectancy: edgeProfile.bucketExpectancy || selected.bucketExpectancy || null,
    microstructure: edgeProfile.microstructure || selected.microstructure || null,
    kellyLiteFraction: edgeProfile.kellyLiteFraction ?? selected.kellyLiteFraction ?? null,
    calibratedProfile: FAST_GROW_EV_POLICY_ENABLED
      ? {
          enabled: true,
          lane: calibratedLane,
          calibratedProbability: regimeCoreEconomics.calibratedProbability ?? null,
          netEv: regimeCoreEconomics.netEdge ?? null,
          reason: regimeCoreEconomics.reason,
          profileId: regimeCorePolicy.policyId,
          legacyCalibratedProbability: preliminaryCalibratedNetEv.calibratedProbability ?? null,
          eligibilityProbabilitySource: regimeCoreEconomics.probabilitySource,
          calibrationSchemaStatus: "legacy_platt_telemetry_only_forward_observer_fail_safe",
        }
      : selected.executionQuality?.calibratedProfile || null,
    preliminaryCalibratedNetEv,
    regimeCorePolicy,
    regimeCoreEconomics,
    observerProbability,
    observerPolicyStatus: observerProbability.policyStatus || null,
    cohortRegimeGuard,
    independentAssetEdgePolicy: preliminaryIndependentAssetEdge,
    fastGrowEvPolicy,
    fastGrowSizing,
    antiPlateauCompounding: {
      enabled: FAST_GROW_EV_POLICY_ENABLED && DYNAMIC_EQUITY_SCALING_ENABLED,
      basis: "current_realized_equity_not_peak_equity",
      martingale: false,
      currentEquityUsd: accountEquity,
      currentDynamicCapUsd: dynamicMaxTradeUsd,
      hardCapUsd: MAX_TRADE_USD_HARD_CAP,
      staticUsdHardCapEnabled: MAX_TRADE_USD_HARD_CAP > 0,
      maxTradeEquityFraction: MAX_TRADE_EQUITY_FRACTION,
      proposedStakeToEquityPct: fastGrowSizing?.stakeToEquityPct ?? null,
    },
    stakeCapUsd: protectedStakeCap.capUsd,
    stakeCapReasons: protectedStakeCap.reasons,
    v333Guard,
    v334StrictGuard,
    profitLockState,
    profitLockMode: profitLockState.mode,
    profitLockGivebackRatio: profitLockState.givebackRatio,
    profitLockGivebackUsd: profitLockState.givebackUsd,
    profitLockPeakEquity: profitLockState.peakEquity,
    progressiveStage: progressiveStage.stage,
    progressiveStageReason: progressiveStage.reason,
    progressiveStakeMultiplier: effectiveProgressiveMultiplier,
    originalProgressiveStakeMultiplier: progressiveStage.stakeMultiplier,
    progressiveBoostDisabledByProtection: effectiveProgressiveMultiplier !== (progressiveStage.stakeMultiplier || 1),
    runtimeSettled: progressiveStage.stats?.settled || 0,
    runtimeWinRate: progressiveStage.stats?.winRate || 0,
    runtimeRoi: progressiveStage.stats?.roi || 0,
  };
}

function sideKey(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "UP" || normalized === "YES") return "UP";
  if (normalized === "DOWN" || normalized === "NO") return "DOWN";
  return normalized;
}

function oppositeSide(value) {
  const side = sideKey(value);
  if (side === "UP") return "DOWN";
  if (side === "DOWN") return "UP";
  return "";
}


function cryptoWindowGroupKey(entry = {}, market = {}) {
  const timeframe = String(entry.timeframe || market.timeframe || "UNKNOWN").toUpperCase();
  const windowStart = entry.windowStart || market.windowStart || "";
  const windowEnd = entry.windowEnd || market.windowEnd || "";
  if (windowStart || windowEnd) return `${timeframe}:${windowStart}:${windowEnd}`;
  const slug = String(entry.slug || market.slug || "unknown");
  const normalized = slug.replace(/^(btc|eth|sol|xrp|doge|bnb|bitcoin|ethereum|solana|ripple|dogecoin)-/i, "crypto-");
  return `${timeframe}:${normalized}`;
}

function isPaperOpenSignal(signal = {}) {
  return signal && signal.status === "paper_open";
}

function isStartupProtectionActive(signals = [], now = Date.now()) {
  if (!STARTUP_PROTECTION_ENABLED) return false;
  const settled = uniqueOfficialFinalSettled(signals).filter((signal) => signal.strategyVersion === BTC_PREDICTION_STRATEGY_VERSION);
  const runtimeAgeMs = now - PROCESS_STARTED_AT_MS;
  return settled.length < STARTUP_PROTECTION_SETTLED_TRADES || runtimeAgeMs < STARTUP_PROTECTION_RUNTIME_MS;
}

function recentLossBrakeActive(signals = []) {
  if (!RECENT_LOSS_BRAKE_ENABLED) return false;
  const settled = uniqueOfficialFinalSettled(signals)
    .filter((signal) => signal.strategyVersion === BTC_PREDICTION_STRATEGY_VERSION)
    .sort((a, b) => Date.parse(b.settledAt || b.time || 0) - Date.parse(a.settledAt || a.time || 0))
    .slice(0, RECENT_LOSS_BRAKE_LOOKBACK);
  if (settled.length < Math.min(3, RECENT_LOSS_BRAKE_LOOKBACK)) return false;
  const pnl = settled.reduce((sum, signal) => sum + toNumber(signal.paperPnlUsd, 0), 0);
  const losses = settled.filter((signal) => signal.status === "paper_loss").length;
  return pnl < 0 && losses >= Math.ceil(settled.length / 2);
}

function evaluateClusterProtection(prediction = {}, market = {}, signals = [], now = Date.now()) {
  const reasons = [];
  if (!CLUSTER_GUARD_ENABLED) return { approved: true, capUsd: null, reasons, mode: "disabled" };

  const selectedSide = sideKey(prediction.predictedOutcome || prediction.side || prediction.direction);
  const lane = String(prediction.calibratedLane || prediction.executionQuality?.calibratedLane || "").toUpperCase();
  const isLaneS = lane === "S";
  const isBridge = Boolean(prediction.fastWorthIt || prediction.bridgeReason || /lane_f|fast_worth_it|bridge/i.test(`${prediction.calibratedProfile?.reason || ""} ${prediction.executionQuality?.reason || ""}`));
  const groupKey = cryptoWindowGroupKey(prediction, market);
  const openInWindow = (signals || []).filter((signal) => isPaperOpenSignal(signal) && cryptoWindowGroupKey(signal, market) === groupKey);
  const sameSideOpen = openInWindow.filter((signal) => sideKey(signal.direction || signal.side) === selectedSide);
  const fullStakeOpen = openInWindow.filter((signal) => toNumber(signal.paperStakeUsd ?? signal.stakeUsd, 0) >= CLUSTER_FULL_STAKE_THRESHOLD_USD);
  const sameSideFullStakeOpen = sameSideOpen.filter((signal) => toNumber(signal.paperStakeUsd ?? signal.stakeUsd, 0) >= CLUSTER_FULL_STAKE_THRESHOLD_USD);
  const settledLossesInWindow = uniqueOfficialFinalSettled(signals).filter((signal) =>
    cryptoWindowGroupKey(signal, market) === groupKey && signal.status === "paper_loss"
  );
  const startupActive = isStartupProtectionActive(signals, now);
  const recentBrake = recentLossBrakeActive(signals);
  let capUsd = null;
  const pushCap = (value, reason) => {
    const numeric = toNumber(value, NaN);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    capUsd = capUsd === null ? numeric : Math.min(capUsd, numeric);
    reasons.push(reason);
  };

  if (SAME_WINDOW_LOSS_BRAKE_ENABLED && settledLossesInWindow.length >= SAME_WINDOW_LOSS_BRAKE_COUNT) {
    return {
      approved: false,
      reason: "same_window_loss_brake_active",
      capUsd: null,
      reasons: ["same_window_loss_brake_active"],
      openInWindow: openInWindow.length,
      sameSideOpen: sameSideOpen.length,
      fullStakeOpen: fullStakeOpen.length,
      sameSideFullStakeOpen: sameSideFullStakeOpen.length,
      startupActive,
      recentBrake,
      groupKey,
    };
  }

  if (openInWindow.length >= CLUSTER_MAX_TOTAL_POSITIONS_PER_WINDOW) {
    return {
      approved: false,
      reason: "cluster_max_total_positions_per_window",
      capUsd: null,
      reasons: ["cluster_max_total_positions_per_window"],
      openInWindow: openInWindow.length,
      sameSideOpen: sameSideOpen.length,
      fullStakeOpen: fullStakeOpen.length,
      sameSideFullStakeOpen: sameSideFullStakeOpen.length,
      startupActive,
      recentBrake,
      groupKey,
    };
  }

  if (sameSideOpen.length >= MAX_SAME_SIDE_CRYPTO_POSITIONS_PER_WINDOW) {
    return {
      approved: false,
      reason: "cluster_same_side_crypto_window_limit",
      capUsd: null,
      reasons: ["cluster_same_side_crypto_window_limit"],
      openInWindow: openInWindow.length,
      sameSideOpen: sameSideOpen.length,
      fullStakeOpen: fullStakeOpen.length,
      sameSideFullStakeOpen: sameSideFullStakeOpen.length,
      startupActive,
      recentBrake,
      groupKey,
    };
  }

  if (startupActive) {
    if (openInWindow.length >= STARTUP_MAX_TOTAL_POSITIONS_PER_WINDOW) {
      return {
        approved: false,
        reason: "startup_window_position_limit",
        capUsd: null,
        reasons: ["startup_window_position_limit"],
        openInWindow: openInWindow.length,
        sameSideOpen: sameSideOpen.length,
        fullStakeOpen: fullStakeOpen.length,
        sameSideFullStakeOpen: sameSideFullStakeOpen.length,
        startupActive,
        recentBrake,
        groupKey,
      };
    }
    if (sameSideOpen.length >= STARTUP_MAX_SAME_SIDE_CRYPTO_PER_WINDOW) {
      return {
        approved: false,
        reason: "startup_same_side_crypto_limit",
        capUsd: null,
        reasons: ["startup_same_side_crypto_limit"],
        openInWindow: openInWindow.length,
        sameSideOpen: sameSideOpen.length,
        fullStakeOpen: fullStakeOpen.length,
        sameSideFullStakeOpen: sameSideFullStakeOpen.length,
        startupActive,
        recentBrake,
        groupKey,
      };
    }
    if (fullStakeOpen.length >= STARTUP_MAX_FULL_STAKE_PER_WINDOW) pushCap(CLUSTER_PROBE_STAKE_USD, "startup_full_stake_already_used_probe_cap");
    if (isBridge) pushCap(STARTUP_FAST_BRIDGE_MAX_STAKE_USD, "startup_fast_bridge_cap");
  }

  if (fullStakeOpen.length >= CLUSTER_MAX_NORMAL_POSITIONS_PER_WINDOW || sameSideFullStakeOpen.length >= MAX_FULL_STAKE_SAME_SIDE_PER_WINDOW) {
    pushCap(CLUSTER_PROBE_STAKE_USD, "cluster_full_stake_quota_used_probe_cap");
  }
  if (sameSideOpen.length >= 1) pushCap(CLUSTER_PROBE_STAKE_USD, "same_side_crypto_correlation_probe_cap");
  if (openInWindow.length >= 2 && !isLaneS) pushCap(CLUSTER_PROBE_STAKE_USD, "third_position_requires_lane_s_or_probe");
  if (isBridge) pushCap(selectedSide === "DOWN" ? BRIDGE_DOWN_MAX_STAKE_USD : BRIDGE_UP_MAX_STAKE_USD, "fast_bridge_never_full_stake_cap");
  if (recentBrake && !isLaneS) pushCap(RECENT_LOSS_BRAKE_MAX_STAKE_USD, "recent_loss_brake_non_s_lane_cap");

  return {
    approved: true,
    reason: reasons.length ? "cluster_protection_cap" : "cluster_protection_clear",
    capUsd,
    reasons,
    openInWindow: openInWindow.length,
    sameSideOpen: sameSideOpen.length,
    fullStakeOpen: fullStakeOpen.length,
    sameSideFullStakeOpen: sameSideFullStakeOpen.length,
    startupActive,
    recentBrake,
    groupKey,
  };
}

function evaluateCorrelationSequence(prediction = {}, market = {}, signals = []) {
  const side = sideKey(prediction.predictedOutcome || prediction.side || prediction.direction);
  const symbol = String(
    prediction.symbol || market.symbol || detectCryptoSymbol(`${market.title || ""} ${market.slug || ""}`),
  ).toUpperCase();
  const groupKey = cryptoWindowGroupKey(prediction, market);
  const correlatedOpen = (Array.isArray(signals) ? signals : []).filter((signal) => {
    if (!isPaperOpenSignal(signal) || cryptoWindowGroupKey(signal, market) !== groupKey) return false;
    if (sideKey(signal.direction || signal.side) !== side) return false;
    const signalSymbol = String(signal.symbol || "").toUpperCase();
    return signal.slug !== market.slug && signalSymbol && signalSymbol !== symbol;
  });
  return {
    groupKey,
    side,
    symbol,
    correlationIndex: Math.min(2, correlatedOpen.length),
    correlatedOpenCount: correlatedOpen.length,
    correlatedSymbols: [...new Set(correlatedOpen.map((signal) => String(signal.symbol || "").toUpperCase()).filter(Boolean))],
    correlatedSlugs: correlatedOpen.map((signal) => signal.slug).filter(Boolean),
  };
}

function observePredictionEligibilityEpisode(prediction = {}, market = {}, now = Date.now()) {
  if (!ELIGIBILITY_EPISODE_ENABLED || BOT_ROLE !== "main_test") {
    return {
      enabled: false,
      ready: true,
      reason: "eligibility_episode_disabled",
      transition: "disabled",
    };
  }
  const selectedSide = sideKey(prediction.predictedOutcome || prediction.side || prediction.direction);
  const isUp = selectedSide === "UP";
  const correlation = evaluateCorrelationSequence(prediction, market, prediction.signals || []);
  const chainlinkSymbol = normalizeExternalPriceSymbol(correlation.symbol);
  const chainlinkCachePoint = externalPriceCache.get(chainlinkSymbol);
  const chainlinkEventTimestampMs = toNumber(chainlinkCachePoint?.updatedAtMs, 0);
  const chainlinkGeneration = chainlinkEventTimestampMs > 0
    ? `${chainlinkSymbol}:${chainlinkEventTimestampMs}`
    : "";
  const key = buildEligibilityEpisodeKey({
    sessionGeneration: paperLedgerGeneration,
    slug: market.slug || prediction.slug,
    side: selectedSide,
  });
  const bookSourceParts = String(prediction.bookSource || "").toLowerCase().split("+").filter(Boolean);
  const targetSource = String(prediction.targetSource || "").toLowerCase();
  const bookGeneration = String(
    isUp ? prediction.upBookEconomicGeneration || "" : prediction.downBookEconomicGeneration || "",
  );
  const decision = eligibilityEpisodeStore.observe({
    key,
    slug: market.slug || prediction.slug,
    side: selectedSide,
    nowMs: now,
    bookGeneration,
    chainlinkGeneration,
    independentAssetPolicyEligible: prediction.independentAssetEdgePolicy?.eligible === true,
    independentAssetPolicyReason: prediction.independentAssetEdgePolicy?.reason,
    assetProbability: prediction.observerProbability?.effectiveProbability ?? prediction.assetProbability ?? prediction.selectedProbability,
    assetNetEdge: prediction.independentAssetEdgePolicy?.netEdge ?? prediction.assetNetEdge,
    calibratedNetEdge: prediction.regimeCoreEconomics?.netEdge,
    calibratedProbability: prediction.regimeCoreEconomics?.calibratedProbability,
    bookConfirmationScore: prediction.bookConfirmationScore,
    bookConfirmed: prediction.bookConfirmed === true,
    bookIntegrityOk: prediction.upBookIntegrity === "ok" && prediction.downBookIntegrity === "ok",
    wsBook: bookSourceParts.length >= 2 && bookSourceParts.every((source) => source.startsWith("ws")),
    chainlinkAgeMs: prediction.currentPriceAgeMs,
    bookAgeMs: prediction.bookAgeMs,
    officialTarget: targetSource.startsWith("polymarket_") && (
      targetSource.includes("event_metadata") || targetSource.includes("chainlink_rtds")
    ),
    correlationIndex: correlation.correlationIndex,
  });
  return {
    enabled: true,
    ...decision,
    key,
    bookGeneration,
    chainlinkGeneration,
    selectedBookEconomicRevision: isUp ? prediction.upBookEconomicRevision : prediction.downBookEconomicRevision,
    selectedBookReceivedAtMs: isUp ? prediction.upBookReceivedAtMs : prediction.downBookReceivedAtMs,
    selectedBookEventTimestampMs: isUp ? prediction.upBookEventTimestampMs : prediction.downBookEventTimestampMs,
    upBookEconomicRevision: prediction.upBookEconomicRevision ?? null,
    downBookEconomicRevision: prediction.downBookEconomicRevision ?? null,
    upBookEconomicGeneration: prediction.upBookEconomicGeneration || null,
    downBookEconomicGeneration: prediction.downBookEconomicGeneration || null,
    upBookReceivedAtMs: prediction.upBookReceivedAtMs ?? null,
    downBookReceivedAtMs: prediction.downBookReceivedAtMs ?? null,
    upBookEventTimestampMs: prediction.upBookEventTimestampMs ?? null,
    downBookEventTimestampMs: prediction.downBookEventTimestampMs ?? null,
    upBookIntegrity: prediction.upBookIntegrity || null,
    downBookIntegrity: prediction.downBookIntegrity || null,
    bookSource: prediction.bookSource || null,
    chainlinkEventTimestampMs: chainlinkEventTimestampMs || null,
    chainlinkArrivalTimestampMs: toNumber(externalPriceLastArrivalBySymbol.get(chainlinkSymbol), 0) || null,
    chainlinkEventProgressTimestampMs: toNumber(externalPriceLastEventProgressBySymbol.get(chainlinkSymbol), 0) || null,
    chainlinkAgeMs: prediction.currentPriceAgeMs ?? null,
    assetProbability: prediction.observerProbability?.effectiveProbability ?? prediction.assetProbability ?? prediction.selectedProbability ?? null,
    assetNetEdge: prediction.independentAssetEdgePolicy?.netEdge ?? prediction.assetNetEdge ?? null,
    independentAssetEdgePolicy: prediction.independentAssetEdgePolicy || null,
    bookConfirmationScore: prediction.bookConfirmationScore ?? null,
    bookConfirmed: prediction.bookConfirmed === true,
    correlation,
    storeStats: { ...eligibilityEpisodeStore.stats, activeEpisodes: eligibilityEpisodeStore.size },
  };
}

function weightedAverageBuyPrice(signals = []) {
  let totalShares = 0;
  let totalCost = 0;
  for (const signal of signals) {
    const shares = toNumber(signal.paperShares ?? signal.paperFillShares, 0);
    const stake = toNumber(signal.paperStakeUsd, 0);
    const price = toNumber(signal.buyPrice ?? signal.selectedBuyPrice ?? signal.entryPrice, 0);
    if (shares > 0 && stake > 0) {
      totalShares += shares;
      totalCost += stake;
      continue;
    }
    if (price > 0 && stake > 0) {
      totalShares += stake / price;
      totalCost += stake;
    }
  }
  return totalShares > 0 ? totalCost / totalShares : 0;
}

function evaluateOppositeSideExposure(prediction = {}, market = {}, signals = []) {
  if (!OPPOSITE_SIDE_EXPOSURE_GUARD_ENABLED) {
    return { approved: true, reason: "opposite_side_guard_disabled", stakeMultiplier: 1 };
  }

  const windowKey = market.slug || prediction.slug || "";
  const selectedDirection = sideKey(prediction.predictedOutcome || prediction.direction || prediction.side);
  const oppositeDirection = oppositeSide(selectedDirection);
  const selectedBuyPrice = toNumber(prediction.selectedBuyPrice ?? prediction.buyPrice ?? prediction.entryPrice, 0);
  if (!windowKey || !selectedDirection || !oppositeDirection || selectedBuyPrice <= 0) {
    return { approved: true, reason: "opposite_side_guard_not_applicable", stakeMultiplier: 1 };
  }

  const oppositeOpenSignals = (Array.isArray(signals) ? signals : []).filter((signal) =>
    signal.status === "paper_open" &&
    getWindowKey(signal) === windowKey &&
    sideKey(signal.direction || signal.side || signal.predictedOutcome) === oppositeDirection
  );
  if (oppositeOpenSignals.length > 0) {
    return {
      approved: false,
      reason: "opposite_side_exposure_blocked",
      stakeMultiplier: 0,
      selectedDirection,
      oppositeDirection,
      selectedBuyPrice,
      oppositeOpenCount: oppositeOpenSignals.length,
    };
  }

  return {
    approved: true,
    reason: "no_opposite_side_exposure",
    stakeMultiplier: 1,
    selectedDirection,
    oppositeDirection,
    selectedBuyPrice,
    oppositeOpenCount: 0,
  };
}

function evaluateExposureGovernor(prediction = {}, market = {}, signals = []) {
  if (!EXPOSURE_GOVERNOR_ENABLED) {
    return { approved: true, reason: "exposure_governor_disabled", stakeMultiplier: 1, reasons: [] };
  }

  const openSignals = (Array.isArray(signals) ? signals : []).filter((signal) => signal.status === "paper_open");
  const settledSignals = uniqueOfficialFinalSettled(signals);
  const realizedPnl = settledSignals.reduce((sum, signal) => sum + toNumber(signal.paperPnlUsd, 0), 0);
  const equityBasis = Math.max(1, PAPER_START_BALANCE + realizedPnl);
  const exposureLimit = equityBasis * Math.max(0.10, MAX_GROSS_OPEN_EXPOSURE_FRACTION);
  const openExposure = openSignals.reduce((sum, signal) => sum + toNumber(signal.paperStakeUsd, 0), 0);
  const symbol = String(prediction.symbol || market.symbol || detectCryptoSymbol(`${market.title || ""} ${market.slug || ""}`)).toUpperCase();
  const side = sideKey(prediction.predictedOutcome || prediction.direction || prediction.side);
  const windowKey = market.slug || prediction.slug || "";
  const openBySymbol = symbol ? openSignals.filter((signal) => String(signal.symbol || "").toUpperCase() === symbol).length : 0;
  const openByWindow = windowKey ? openSignals.filter((signal) => getWindowKey(signal) === windowKey).length : 0;
  const openBySide = side ? openSignals.filter((signal) => sideKey(signal.direction || signal.side) === side).length : 0;

  const reasons = [];
  let stakeMultiplier = 1;
  if (openExposure >= exposureLimit) {
    reasons.push("gross_exposure_full_probe_only");
    stakeMultiplier = Math.min(stakeMultiplier, EXPOSURE_GOVERNOR_TINY_STAKE_MULTIPLIER);
  } else if (openExposure + toNumber(prediction.recommendedStakeUsd, 0) > exposureLimit) {
    reasons.push("gross_exposure_near_limit_reduced");
    stakeMultiplier = Math.min(stakeMultiplier, EXPOSURE_GOVERNOR_REDUCED_STAKE_MULTIPLIER);
  }
  if (openSignals.length >= MAX_OPEN_POSITIONS_SOFT) {
    reasons.push("open_positions_soft_limit_probe_only");
    stakeMultiplier = Math.min(stakeMultiplier, EXPOSURE_GOVERNOR_TINY_STAKE_MULTIPLIER);
  }
  if (symbol && openBySymbol >= MAX_OPEN_PER_SYMBOL) {
    reasons.push("symbol_exposure_reduced");
    stakeMultiplier = Math.min(stakeMultiplier, EXPOSURE_GOVERNOR_REDUCED_STAKE_MULTIPLIER);
  }
  if (windowKey && openByWindow >= MAX_POSITIONS_PER_WINDOW) {
    reasons.push("window_exposure_reduced");
    stakeMultiplier = Math.min(stakeMultiplier, EXPOSURE_GOVERNOR_REDUCED_STAKE_MULTIPLIER);
  }
  if (side && openBySide >= MAX_OPEN_PER_SIDE_BUCKET) {
    reasons.push("side_bucket_exposure_reduced");
    stakeMultiplier = Math.min(stakeMultiplier, EXPOSURE_GOVERNOR_REDUCED_STAKE_MULTIPLIER);
  }

  return {
    approved: true,
    reason: reasons.length ? reasons.join("+") : "exposure_governor_clear",
    reasons,
    stakeMultiplier,
    openExposure,
    exposureLimit,
    openPositions: openSignals.length,
    openBySymbol,
    openByWindow,
    openBySide,
  };
}


function inferMarketTickSize(market = {}, prediction = {}) {
  const explicit = toNumber(
    market.tickSize ??
      market.tick_size ??
      market.minimumTickSize ??
      market.minimum_tick_size ??
      prediction.tickSize ??
      prediction.tick_size,
    0
  );
  return explicit > 0 ? explicit : Math.max(0.0001, REAL_TICK_SIZE_DEFAULT);
}

function isPriceAlignedToTick(price, tickSize) {
  const numericPrice = toNumber(price, 0);
  const numericTick = toNumber(tickSize, 0);
  if (numericPrice <= 0 || numericTick <= 0) return false;
  const units = numericPrice / numericTick;
  return Math.abs(units - Math.round(units)) <= REAL_TICK_SIZE_TOLERANCE;
}

function evaluateRealExecutionReadiness(prediction = {}, market = {}, intendedStakeUsd = 0) {
  if (!REAL_EXECUTION_READINESS_ENABLED || !REAL_SHADOW_ENABLED) {
    return {
      enabled: false,
      approved: true,
      mode: REAL_EXECUTION_MODE,
      reason: "real_execution_shadow_disabled",
      reasons: [],
      intendedStakeUsd,
      testStakeUsd: intendedStakeUsd,
    };
  }

  const reasons = [];
  const warnings = [];
  const entryPrice = toNumber(prediction.selectedBuyPrice ?? prediction.buyPrice ?? prediction.entryPrice, 0);
  const bidPrice = toNumber(prediction.selectedBidPrice ?? prediction.bidPrice, 0);
  const bookAgeMs = toNumber(prediction.bookAgeMs, Infinity);
  const bookSource = String(prediction.bookSource || "").toLowerCase();
  const tickSize = inferMarketTickSize(market, prediction);
  const minimumOrderShares = resolveMarketMinimumShares(
    prediction.minOrderSize,
    market.minOrderSize,
    market.min_order_size,
    market.mos,
  );
  const intendedStake = Math.max(0, toNumber(intendedStakeUsd, 0));
  const testStakeUsd = intendedStake;
  const depthShares = Math.max(0, toNumber(prediction.depthShares ?? prediction.selectedDepthShares ?? (String(prediction.predictedOutcome || "").toUpperCase() === "UP" ? prediction.upDepthShares : prediction.downDepthShares), 0));
  const requiredShares = entryPrice > 0 ? testStakeUsd / entryPrice : Infinity;
  const fillableShares = Math.min(depthShares, requiredShares);
  const fillFraction = requiredShares > 0 && Number.isFinite(requiredShares) ? fillableShares / requiredShares : 0;
  const slippagePrice = Math.min(0.99, entryPrice + REAL_SHADOW_SLIPPAGE_CENTS / 100);
  const slippageCents = Math.max(0, (slippagePrice - entryPrice) * 100);

  if (entryPrice <= 0 || entryPrice >= 1) reasons.push("invalid_entry_price");
  if (!isPriceAlignedToTick(entryPrice, tickSize)) reasons.push("invalid_tick_size_alignment");
  if (!(minimumOrderShares > 0)) reasons.push("polymarket_minimum_order_shares_unavailable");
  else if (requiredShares + 1e-9 < minimumOrderShares) reasons.push("below_polymarket_minimum_order_shares");
  if (REAL_SHADOW_REQUIRE_WS_BOOK && !bookSource.includes("ws")) reasons.push("non_ws_book_source");
  if (bookAgeMs > REAL_SHADOW_MAX_BOOK_AGE_MS) reasons.push("stale_book_for_real_execution");
  if (requiredShares > 0 && depthShares < requiredShares * REAL_SHADOW_MIN_DEPTH_MULTIPLIER) {
    const reason = fillFraction >= REAL_SHADOW_PARTIAL_FILL_MIN_FRACTION && REAL_SHADOW_ALLOW_PARTIAL_FILL
      ? "partial_fill_risk"
      : "insufficient_visible_depth_for_real_size";
    (reason === "partial_fill_risk" ? warnings : reasons).push(reason);
  }
  if (bidPrice > 0 && entryPrice > 0 && (entryPrice - bidPrice) * 100 > QUALITY_MAX_SPREAD_CENTS) {
    warnings.push("spread_may_reduce_real_fill_quality");
  }

  return {
    enabled: true,
    approved: reasons.length === 0,
    mode: REAL_EXECUTION_MODE,
    reason: reasons.length ? reasons[0] : warnings.length ? "real_shadow_approved_with_warnings" : "real_shadow_approved",
    reasons,
    warnings,
    tickSize,
    tickAligned: isPriceAlignedToTick(entryPrice, tickSize),
    minOrderSizeUsd: minimumOrderShares > 0 ? minimumOrderShares * entryPrice : null,
    minimumOrderShares,
    intendedStakeUsd: intendedStake,
    testStakeUsd,
    entryPrice,
    projectedLimitPrice: slippagePrice,
    projectedSlippageCents: slippageCents,
    depthShares,
    requiredShares: Number.isFinite(requiredShares) ? requiredShares : 0,
    fillableShares,
    estimatedFillFraction: Math.max(0, Math.min(1, fillFraction || 0)),
    bookAgeMs: Number.isFinite(bookAgeMs) ? bookAgeMs : null,
    bookSource: prediction.bookSource || "",
  };
}

function v3745RejectionCategory(reason = "") {
  const text = String(reason || "").toLowerCase();
  if (/artificial_fixed_minimum|capital_deadlock/.test(text)) return "CAPITAL_DEADLOCK_BUG";
  if (/true_market_minimum|market_minimum|minimum_order_shares|below_market_minimum/.test(text)) return "TRUE_MARKET_MINIMUM_TOO_LARGE";
  if (/chainlink|book_stale|ws_book|feed|real_market_data|target_unavailable|official_target/.test(text)) return "FEED_UNAVAILABLE";
  if (/regime_core|confidence|independent_asset|net_edge|entry_price|direction_lock|order_book_not_confirming/.test(text)) return "NO_CORE_OPPORTUNITY";
  return "OTHER_EXPLICIT_REJECTION";
}

function maybeCreatePredictionSignal(prediction, market, now) {
  if (BOT_ROLE !== "main_test") {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "observer_role_never_executes",
      slug: market?.slug || prediction?.slug || null,
      botRole: BOT_ROLE,
      excludedFromTradeHistoryAndWinRate: true,
    });
    return null;
  }
  if (paperSessionState?.hold) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "paper_session_hold_no_entry",
      paperSessionId: paperSessionState.id,
      releaseVersion: V356_RELEASE_VERSION,
      appliedToLiveSelection: false,
    });
    return null;
  }
  let eligibilityEpisode = observePredictionEligibilityEpisode(prediction, market, now);
  prediction = { ...prediction, eligibilityEpisode };
  if (!prediction.tradeable) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: prediction.reason || prediction.riskReason || "prediction_not_tradeable",
      rejectionCategory: v3745RejectionCategory(prediction.reason || prediction.riskReason || "prediction_not_tradeable"),
      executionStatus: "unfilled_policy_reject",
      slug: market?.slug || prediction?.slug || null,
      strategy: prediction.selectedStrategy || prediction.strategy || null,
      direction: prediction.predictedOutcome || null,
      calibratedLane: prediction.calibratedLane || null,
      calibratedWinProbability: prediction.calibratedWinProbability ?? null,
      calibratedNetEdge: prediction.preliminaryCalibratedNetEv?.netEdge ?? null,
      independentAssetEdgePolicy: prediction.independentAssetEdgePolicy || null,
      bookConfirmationScore: prediction.bookConfirmationScore ?? null,
      bookConfirmed: prediction.bookConfirmed === true,
      fastGrowEvPolicy: prediction.fastGrowEvPolicy || null,
      fastGrowSizing: prediction.fastGrowSizing || null,
      eligibilityEpisode,
      excludedFromTradeHistoryAndWinRate: true,
    });
    return null;
  }
  if (!canUsePredictionForEntry(prediction)) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "real_market_data_only_entry_block",
      bookSource: prediction.bookSource || "",
      title: prediction.title || "",
      sourceType: prediction.sourceType || "",
    });
    return null;
  }

  const mainAccuracyLane = evaluateMainAccuracyLane(prediction, {
    enabled: BOT_ROLE === "main_test" && MAIN_ACCURACY_LANE_ENABLED,
    minConfidence: MAIN_ACCURACY_MIN_CONFIDENCE,
    minSecondsIntoWindow: MAIN_ACCURACY_MIN_SECONDS_INTO_WINDOW,
    maxSecondsIntoWindowExclusive: MAIN_ACCURACY_MAX_SECONDS_INTO_WINDOW_EXCLUSIVE,
    requireModelReady: MAIN_ACCURACY_REQUIRE_MODEL_READY,
    requireDirectionLock: MAIN_ACCURACY_REQUIRE_DIRECTION_LOCK,
    requireChainlink: MAIN_ACCURACY_REQUIRE_CHAINLINK,
    requireOfficialTarget: MAIN_ACCURACY_REQUIRE_OFFICIAL_TARGET,
    requireWsBook: MAIN_ACCURACY_REQUIRE_WS_BOOK,
    allowedSymbols: MULTI_ASSET_PREDICTION_SYMBOLS,
    maxChainlinkAgeMs: MAIN_ACCURACY_MAX_CHAINLINK_AGE_MS,
    maxBookAgeMs: MAIN_ACCURACY_MAX_BOOK_AGE_MS,
    minEntryPrice: MAIN_ACCURACY_MIN_ENTRY_PRICE,
    maxEntryPrice: MAIN_ACCURACY_MAX_ENTRY_PRICE,
    legacyCalibrationGateEnabled: LEGACY_CALIBRATION_EXECUTION_GATE_ENABLED,
    decisionLatencyMs: Math.max(0, Date.now() - now),
  });
  if (!mainAccuracyLane.eligible) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: mainAccuracyLane.reason,
      rejectionCategory: v3745RejectionCategory(mainAccuracyLane.reason),
      slug: market.slug,
      botRole: BOT_ROLE,
      excludedFromTradeHistoryAndWinRate: true,
      mainAccuracyLane,
    });
    return null;
  }

  const key = market.slug;
  const selectedStrategy = prediction.selectedStrategy || prediction.strategy || "current_prediction";
  const selectedDirection = String(prediction.predictedOutcome || "").toUpperCase();
  if (PAPER_ONE_POSITION_PER_SLUG && hasCommittedSlug(prediction.signals || [], key)) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "paper_slug_already_committed",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      excludedFromTradeHistoryAndWinRate: true,
    });
    return null;
  }
  if (ELIGIBILITY_EPISODE_ENABLED && !eligibilityEpisode.ready) {
    if (eligibilityEpisode.transition !== "duplicate" && eligibilityEpisode.transition !== "ignored") {
      auditLogger.decision({
        time: new Date(now).toISOString(),
        reason: eligibilityEpisode.reason || "eligibility_episode_pending",
        executionStatus: "unfilled_episode_pending",
        slug: key,
        strategy: selectedStrategy,
        direction: selectedDirection,
        eligibilityEpisode,
        excludedFromTradeHistoryAndWinRate: true,
      });
    }
    return null;
  }
  const activeResearchSampleBucket = null;
  const targetSampleCellKey = getSignalCooldownKey(
    key,
    selectedStrategy,
    selectedDirection,
    activeResearchSampleBucket,
    prediction.secondsIntoWindow,
  );
  const v334StrictGuard = prediction.v334StrictGuard || buildV334StrictEntryGuard({
    signals: prediction.signals || [],
    selected: prediction,
    market,
  });
  if (v334StrictGuard.enabled && !v334StrictGuard.approved) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "v334_strict_entry_block",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      v334StrictGuard,
    });
    return null;
  }
  if (prediction.v333Guard?.blockEntry) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "v333_drawdown_guard_block",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      v333Guard: prediction.v333Guard,
    });
    return null;
  }
  const duplicateOpen = (prediction.signals || []).some((signal) => {
    if (signal.status !== "paper_open") return false;
    return getSignalCooldownKey(
      signal.slug || getWindowKey(signal),
      signal.strategy || signal.entryStrategy,
      signal.direction || signal.side,
      signal.researchSampleBucket,
      signal.secondsIntoWindow,
    ) === targetSampleCellKey;
  });
  if (duplicateOpen) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "duplicate_open_strategy_side_window",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
    });
    return null;
  }

  const oppositeSideExposure = evaluateOppositeSideExposure(prediction, market, prediction.signals || []);
  if (!oppositeSideExposure.approved) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: oppositeSideExposure.reason,
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      selectedBuyPrice: oppositeSideExposure.selectedBuyPrice,
      oppositeAverageBuyPrice: oppositeSideExposure.oppositeAverageBuyPrice,
      combinedPrice: oppositeSideExposure.combinedPrice,
      oppositeOpenCount: oppositeSideExposure.oppositeOpenCount,
    });
    return null;
  }

  const exposureGovernor = evaluateExposureGovernor(prediction, market, prediction.signals || []);

  const calibratedLaneForEntry = String(prediction.calibratedLane || prediction.executionQuality?.calibratedLane || "").toUpperCase();
  const profitLockForEntry = prediction.profitLockState || evaluateProfitLockState(prediction.signals || [], prediction.account?.balance || PAPER_START_BALANCE);
  if (PROFIT_LOCK_ENABLED
      && !NO_ENTRY_REDUCTION_MODE
      && PROFIT_LOCK_AFTER_PROFIT_LANE_B_MAX_PER_WINDOW >= 0
      && calibratedLaneForEntry === "B"
      && toNumber(profitLockForEntry.peakProfitUsd, 0) >= PROFIT_LOCK_AFTER_PROFIT_USD) {
    const laneBOpenInWindow = (prediction.signals || []).filter((signal) =>
      signal.status === "paper_open"
      && getWindowKey(signal) === key
      && String(signal.calibratedLane || signal.entryLane || "").toUpperCase() === "B"
    ).length;
    if (laneBOpenInWindow >= PROFIT_LOCK_AFTER_PROFIT_LANE_B_MAX_PER_WINDOW) {
      auditLogger.decision({
        time: new Date(now).toISOString(),
        reason: "profit_lock_lane_b_window_limit",
        slug: key,
        strategy: selectedStrategy,
        direction: selectedDirection,
        laneBOpenInWindow,
        peakProfitUsd: profitLockForEntry.peakProfitUsd,
      });
      return null;
    }
  }

  const clusterProtection = evaluateClusterProtection(prediction, market, prediction.signals || [], now);
  if (!clusterProtection.approved) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: clusterProtection.reason || "cluster_protection_block",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      clusterProtection,
    });
    return null;
  }

  const cooldownKey = targetSampleCellKey;
  const previous = seenPredictionSignals.get(cooldownKey) || 0;
  if (previous && now - previous < ACTIVE_BTC_PAPER_SIGNAL_COOLDOWN_MS) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "signal_cooldown_active",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      cooldownMs: ACTIVE_BTC_PAPER_SIGNAL_COOLDOWN_MS,
    });
    return null;
  }

  const oppositeSideStakeMultiplier = Math.max(0, Math.min(1, toNumber(oppositeSideExposure.stakeMultiplier, 1)));
  const exposureStakeMultiplier = Math.max(0.01, Math.min(1, toNumber(exposureGovernor.stakeMultiplier, 1)));
  const stakeCapUsd = toNumber(prediction.stakeCapUsd, 0);
  const paperMaxTradeUsd = Math.max(0, toNumber(prediction.paperMaxTradeUsd, PAPER_MAX_TRADE_USD));
  const realTestStakeLimitUsd = REAL_EXECUTION_READINESS_ENABLED && REAL_ORDER_MAX_TEST_STAKE_USD > 0 && REAL_SHADOW_CAP_PAPER_STAKE
    ? Math.min(paperMaxTradeUsd, REAL_ORDER_MAX_TEST_STAKE_USD)
    : paperMaxTradeUsd;
  const clusterCapUsd = toNumber(clusterProtection.capUsd, 0);
  const rawStakeUpperBoundUsd = Math.min(
    stakeCapUsd > 0 ? Math.min(realTestStakeLimitUsd, stakeCapUsd) : realTestStakeLimitUsd,
    clusterCapUsd > 0 ? clusterCapUsd : realTestStakeLimitUsd,
  );
  const marketMinimumOrderShares = resolveMarketMinimumShares(
    prediction.minOrderSize,
    market.minOrderSize,
    market.min_order_size,
    market.mos,
  ) || 0;
  const actualMarketMinimum = calculateActualMinimumStake({
    minimumRecordedFillUsd: PAPER_MIN_RECORDED_FILL_USD,
    marketMinimumShares: marketMinimumOrderShares,
    executablePrice: prediction.selectedBuyPrice,
  });
  if (!actualMarketMinimum.valid) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: actualMarketMinimum.reason,
      rejectionCategory: v3745RejectionCategory(actualMarketMinimum.reason),
      executionStatus: "unfilled_technical_reject",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      actualMarketMinimum,
      capitalDeadlockBug: false,
      excludedFromTradeHistoryAndWinRate: true,
    });
    return null;
  }
  const minimumStakeForMarketSharesUsd = actualMarketMinimum.marketMinimumStakeUsd;
  const minimumExecutableStakeUsd = actualMarketMinimum.actualMinimumStakeUsd;
  const minimumProbeStakeUsd = Math.max(minimumExecutableStakeUsd, MIN_PROBE_STAKE_USD);
  const minimumCleanStakeUsd = Math.max(minimumExecutableStakeUsd, MIN_CLEAN_STAKE_USD);
  const v352FloorNonZeroCap = process.env.V352_FLOOR_NONZERO_CAP_TO_MARKET_MIN !== "0";
  const stakeCapReasonsText = (prediction.stakeCapReasons || []).map((reason) => String(reason || "").toLowerCase()).join(" ");
  const hardNonExecutableCap = rawStakeUpperBoundUsd <= 0 ||
    stakeCapReasonsText.includes("synthetic") ||
    stakeCapReasonsText.includes("fallback") ||
    stakeCapReasonsText.includes("invalid") ||
    stakeCapReasonsText.includes("no_liquidity") ||
    stakeCapReasonsText.includes("max_position") ||
    stakeCapReasonsText.includes("exposure_hard_stop");
  const persistedCapital = calculateLifetimePaperMetrics(0, 0);
  const capitalState = summarizePaperCapital(prediction.signals || [], PAPER_START_BALANCE, {
    persistedRealizedPnlUsd: persistedCapital.lifetimeRealizedPnl,
  });
  const entryFeeRate = toNumber(prediction.takerFeeRate, PAPER_CRYPTO_TAKER_FEE_RATE);
  const cashStakeLimit = maximumStakeWithinCash({
    availableCashUsd: PAPER_HARD_CASH_LEDGER_ENABLED ? capitalState.availableCashUsd : Number.POSITIVE_INFINITY,
    entryPrice: prediction.selectedBuyPrice,
    feeRate: PAPER_RESERVE_ENTRY_FEES ? entryFeeRate : 0,
    minimumStakeUsd: minimumExecutableStakeUsd,
  });
  const unresolvedReserveLimit = maximumStakeWithinUnresolvedReserve({
    realizedEquityUsd: capitalState.realizedBalanceUsd,
    openReservedUsd: capitalState.openReservedUsd,
    maxReserveFraction: MAX_UNRESOLVED_RESERVE_FRACTION,
    entryPrice: prediction.selectedBuyPrice,
    feeRate: PAPER_RESERVE_ENTRY_FEES ? entryFeeRate : 0,
    minimumStakeUsd: minimumExecutableStakeUsd,
  });
  if (PAPER_HARD_CASH_LEDGER_ENABLED && !cashStakeLimit.executable) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "paper_insufficient_available_cash",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      availableCashUsd: capitalState.availableCashUsd,
      openReservedUsd: capitalState.openReservedUsd,
      realizedBalanceUsd: capitalState.realizedBalanceUsd,
      minimumExecutableStakeUsd,
      excludedFromTradeHistoryAndWinRate: true,
    });
    return null;
  }
  if (!unresolvedReserveLimit.executable) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "TRUE_MARKET_MINIMUM_TOO_LARGE_FOR_REMAINING_RESERVE",
      rejectionCategory: "TRUE_MARKET_MINIMUM_TOO_LARGE",
      executionStatus: "unfilled_risk_reserve_reject",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      minimumExecutableStakeUsd,
      actualMarketMinimum,
      unresolvedReserveLimit,
      capitalDeadlockBug: false,
      excludedFromTradeHistoryAndWinRate: true,
    });
    return null;
  }
  const allowTechnicalMarketMinimumFloor = !(FAST_GROW_EV_POLICY_ENABLED && FAST_GROW_SKIP_BELOW_MARKET_MIN);
  const technicallyFlooredStakeUpperBoundUsd = rawStakeUpperBoundUsd < minimumExecutableStakeUsd && v352FloorNonZeroCap && !hardNonExecutableCap && allowTechnicalMarketMinimumFloor
    ? minimumExecutableStakeUsd
    : rawStakeUpperBoundUsd;
  const stakeUpperBoundUsd = PAPER_HARD_CASH_LEDGER_ENABLED
    ? Math.min(technicallyFlooredStakeUpperBoundUsd, cashStakeLimit.maximumStakeUsd, unresolvedReserveLimit.maximumStakeUsd)
    : Math.min(technicallyFlooredStakeUpperBoundUsd, unresolvedReserveLimit.maximumStakeUsd);
  const rawPaperStakeUsd = Math.min(stakeUpperBoundUsd, (prediction.recommendedStakeUsd || stakeUpperBoundUsd) * oppositeSideStakeMultiplier * exposureStakeMultiplier);
  const protectedOrObserved = Boolean(prediction.executionObserveOnly || (prediction.stakeCapReasons || []).length || prediction.softQualityStakeMultiplier < 0.50 || prediction.runtimeStakeMultiplier <= 0.25);
  // The legacy $3 clean floor must not inflate a percentage-based fast-grow
  // recommendation after drawdown. Only the actual exchange/recording minimum
  // may floor this release; otherwise stake could exceed its final lane fraction.
  const minimumStakeUsd = FAST_GROW_EV_POLICY_ENABLED
    ? minimumExecutableStakeUsd
    : protectedOrObserved
      ? minimumProbeStakeUsd
      : minimumCleanStakeUsd;
  if (FAST_GROW_EV_POLICY_ENABLED && FAST_GROW_SKIP_BELOW_MARKET_MIN && rawPaperStakeUsd + 1e-9 < minimumExecutableStakeUsd) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "TRUE_MARKET_MINIMUM_TOO_LARGE_FOR_LANE_BUDGET",
      rejectionCategory: "TRUE_MARKET_MINIMUM_TOO_LARGE",
      executionStatus: "unfilled_policy_reject",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      rawPaperStakeUsd,
      recommendedStakeUsd: prediction.recommendedStakeUsd ?? null,
      minimumExecutableStakeUsd,
      marketMinimumOrderShares,
      selectedBuyPrice: prediction.selectedBuyPrice,
      actualMarketMinimum,
      capitalDeadlockBug: false,
      fastGrowEvPolicy: prediction.fastGrowEvPolicy || null,
      fastGrowSizing: prediction.fastGrowSizing || null,
      excludedFromTradeHistoryAndWinRate: true,
    });
    return null;
  }
  if (stakeUpperBoundUsd < minimumExecutableStakeUsd) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "TRUE_MARKET_MINIMUM_TOO_LARGE_FOR_EXECUTABLE_CAP",
      rejectionCategory: "TRUE_MARKET_MINIMUM_TOO_LARGE",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      rawPaperStakeUsd,
      rawStakeUpperBoundUsd,
      stakeUpperBoundUsd,
      minimumExecutableStakeUsd,
      actualMarketMinimum,
      capitalDeadlockBug: false,
      stakeCapReasons: prediction.stakeCapReasons || [],
      executionQualityScore: prediction.executionQualityScore || 0,
      executionQualityThreshold: prediction.executionQualityThreshold || 0,
      executionQualityReasons: prediction.executionQualityReasons || [],
    });
    return null;
  }
  const intendedPaperStakeUsd = Math.max(minimumStakeUsd, Math.min(stakeUpperBoundUsd, Math.max(rawPaperStakeUsd, minimumExecutableStakeUsd)));
  const selectedTickSize = selectedDirection === "UP" ? prediction.upTickSize : prediction.downTickSize;
  const realExecutionReadiness = evaluateRealExecutionReadiness(
    { ...prediction, tickSize: selectedTickSize || prediction.tickSize },
    { ...market, tickSize: selectedTickSize || market.tickSize },
    intendedPaperStakeUsd,
  );
  if (REAL_SHADOW_BLOCK_UNREALISTIC_PAPER && realExecutionReadiness.enabled && !realExecutionReadiness.approved) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: `real_shadow_${realExecutionReadiness.reason}`,
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      realShadowReasons: realExecutionReadiness.reasons || [],
      realShadowWarnings: realExecutionReadiness.warnings || [],
      paperStakeUsd: intendedPaperStakeUsd,
      entryPrice: prediction.selectedBuyPrice,
      tickSize: realExecutionReadiness.tickSize,
      bookAgeMs: realExecutionReadiness.bookAgeMs,
      bookSource: realExecutionReadiness.bookSource,
      estimatedFillFraction: realExecutionReadiness.estimatedFillFraction,
    });
    return null;
  }
  const selectedExecutionAsks = selectedDirection === "UP"
    ? prediction.upExecutionAsks
    : prediction.downExecutionAsks;
  const fillRequest = {
    asks: selectedExecutionAsks,
    intendedStakeUsd: intendedPaperStakeUsd,
    orderType: PAPER_ORDER_TYPE,
    maxSlippageCents: PAPER_MAX_SLIPPAGE_CENTS,
    limitPrice: Math.min(
      MAIN_ACCURACY_MAX_ENTRY_PRICE,
      toNumber(prediction.selectedBuyPrice, 0) + PAPER_MAX_SLIPPAGE_CENTS / 100,
    ),
    feeRate: entryFeeRate,
    minimumOrderShares: marketMinimumOrderShares,
    tickSize: selectedTickSize || market.tickSize || 0.01,
  };
  const fillReconciliation = FAST_GROW_EV_POLICY_ENABLED
    ? reconcileFastGrowObservedFill({
        ...fillRequest,
        rawConfidence: prediction.confidence,
        assetProbability: prediction.assetProbability ?? prediction.selectedProbability,
        effectiveAssetProbability: prediction.observerProbability?.effectiveProbability ?? prediction.assetProbability ?? prediction.selectedProbability,
        observerProbability: prediction.observerProbability || null,
        selectedDirection,
        modelDirection: mainAccuracyLane.modelDirection,
        secondsIntoWindow: prediction.secondsIntoWindow,
        equity: prediction.accountEquity ?? capitalState.realizedBalanceUsd,
        depthShares: selectedDirection === "UP" ? prediction.upDepthShares : prediction.downDepthShares,
        maxTradeUsd: prediction.dynamicMaxTradeUsd ?? prediction.paperMaxTradeUsd ?? PAPER_MAX_TRADE_USD,
        minimumRecordedFillUsd: PAPER_MIN_RECORDED_FILL_USD,
      }, {
        minNetEdge: FAST_GROW_EV_MIN_NET_EDGE,
        laneSMinNetEdge: FAST_GROW_EV_LANE_S_MIN_NET_EDGE,
        laneAMinFraction: FAST_GROW_EV_LANE_A_MIN_FRACTION,
        laneAMaxFraction: FAST_GROW_EV_LANE_A_MAX_FRACTION,
        laneSMinFraction: FAST_GROW_EV_LANE_S_MIN_FRACTION,
        laneSMaxFraction: FAST_GROW_EV_LANE_S_MAX_FRACTION,
        laneSMaxEdge: FAST_GROW_EV_LANE_S_MAX_EDGE,
        depthUtilization: FAST_GROW_DEPTH_UTILIZATION,
        independentAssetMinNetEdge: INDEPENDENT_ASSET_MIN_NET_EDGE,
        independentAssetStressSlippagePerShare: INDEPENDENT_ASSET_STRESS_SLIPPAGE_PER_SHARE,
        regimeCoreEnabled: REGIME_CORE_POLICY_ENABLED,
        regimeCoreMinConfidence: MAIN_ACCURACY_MIN_CONFIDENCE,
        regimeCoreMinEntryPrice: MAIN_ACCURACY_MIN_ENTRY_PRICE,
        regimeCoreMaxEntryPrice: MAIN_ACCURACY_MAX_ENTRY_PRICE,
        laneCeiling: prediction.cohortRegimeGuard?.laneCeiling || "S",
        laneSEvidenceReady: prediction.regimeCorePolicy?.eligible === true,
        maxIterations: 4,
      })
    : null;
  const paperFill = fillReconciliation?.paperFill || simulateMarketableBuy(fillRequest);
  const finalCalibratedNetEv = fillReconciliation?.calibratedNetEv || evaluateCalibratedNetEv({
    rawConfidence: prediction.confidence,
    executablePrice: paperFill.averageFillPrice,
    measuredFeePerShare: paperFill.filledShares > 0 ? paperFill.takerFeeUsd / paperFill.filledShares : Number.NaN,
    secondsIntoWindow: prediction.secondsIntoWindow,
    feeRate: entryFeeRate,
  });
  const finalIndependentAssetEdge = fillReconciliation?.independentAssetEdge || evaluateIndependentAssetEdge({
    assetProbability: prediction.observerProbability?.effectiveProbability ?? prediction.assetProbability,
    executablePrice: paperFill.averageFillPrice,
    measuredFeePerShare: paperFill.filledShares > 0
      ? paperFill.takerFeeUsd / paperFill.filledShares
      : Number.NaN,
    feeRate: entryFeeRate,
    minNetEdge: INDEPENDENT_ASSET_MIN_NET_EDGE,
    stressSlippagePerShare: INDEPENDENT_ASSET_STRESS_SLIPPAGE_PER_SHARE,
  });
  const finalRegimeCorePolicy = fillReconciliation?.regimeCorePolicy || evaluateRegimeCorePolicy({
    confidence: prediction.confidence,
    executablePrice: paperFill.averageFillPrice,
    selectedDirection,
    modelDirection: mainAccuracyLane.modelDirection,
    independentAssetEdge: finalIndependentAssetEdge,
    observerProbability: prediction.observerProbability,
  }, {
    minConfidence: MAIN_ACCURACY_MIN_CONFIDENCE,
    minEntryPrice: MAIN_ACCURACY_MIN_ENTRY_PRICE,
    maxEntryPrice: MAIN_ACCURACY_MAX_ENTRY_PRICE,
  });
  const finalRegimeCoreEconomics = buildRegimeCoreEconomics(
    finalRegimeCorePolicy,
    finalIndependentAssetEdge,
    prediction.observerProbability,
  );
  const finalFastGrowEvPolicy = FAST_GROW_EV_POLICY_ENABLED
    ? fillReconciliation?.policy || classifyFastGrowEv(finalRegimeCoreEconomics, {
        minNetEdge: FAST_GROW_EV_MIN_NET_EDGE,
        laneSMinNetEdge: FAST_GROW_EV_LANE_S_MIN_NET_EDGE,
        laneCeiling: prediction.cohortRegimeGuard?.laneCeiling || "S",
        laneSEvidenceReady: finalRegimeCorePolicy.eligible === true,
      })
    : null;
  const finalFastGrowSizing = fillReconciliation?.sizing || null;
  if (ELIGIBILITY_EPISODE_ENABLED) {
    const finalFillEpisode = eligibilityEpisodeStore.revalidateFinalEdge(eligibilityEpisode.key, {
      assetNetEdge: finalIndependentAssetEdge.netEdge,
      independentAssetPolicyEligible: finalIndependentAssetEdge.eligible === true,
      independentAssetPolicyReason: finalIndependentAssetEdge.reason,
      calibratedNetEdge: finalCalibratedNetEv.netEdge,
      calibratedPolicyEligible: Boolean(
        finalRegimeCorePolicy.eligible &&
        (!FAST_GROW_EV_POLICY_ENABLED || finalFastGrowEvPolicy?.executable),
      ),
      calibratedPolicyReason: finalFastGrowEvPolicy?.reason || finalRegimeCorePolicy.reason,
      bookConfirmed: prediction.bookConfirmed === true,
      correlationIndex: eligibilityEpisode.correlation?.correlationIndex,
    });
    eligibilityEpisode = {
      ...eligibilityEpisode,
      ...finalFillEpisode,
      preliminaryReady: eligibilityEpisode.ready === true,
      preliminaryCalibratedNetEdge: prediction.preliminaryCalibratedNetEv?.netEdge ?? null,
      finalFillCalibratedNetEdge: finalCalibratedNetEv.netEdge ?? null,
      preliminaryAssetNetEdge: prediction.independentAssetEdgePolicy?.netEdge ?? null,
      finalFillAssetNetEdge: finalIndependentAssetEdge.netEdge ?? null,
    };
    prediction = { ...prediction, eligibilityEpisode };
    if (!eligibilityEpisode.ready) {
      auditLogger.decision({
        time: new Date(now).toISOString(),
        reason: eligibilityEpisode.reason || "eligibility_episode_final_fill_rejected",
        executionStatus: "unfilled_episode_final_fill_reject",
        slug: key,
        strategy: selectedStrategy,
        direction: selectedDirection,
        calibratedNetEv: finalCalibratedNetEv,
        independentAssetEdgePolicy: finalIndependentAssetEdge,
        fastGrowEvPolicy: finalFastGrowEvPolicy,
        eligibilityEpisode,
        excludedFromTradeHistoryAndWinRate: true,
      });
      return null;
    }
  }
  const paperFillReservedUsd = paperFill.filledStakeUsd + (PAPER_RESERVE_ENTRY_FEES ? paperFill.takerFeeUsd : 0);
  if (PAPER_HARD_CASH_LEDGER_ENABLED && paperFillReservedUsd > capitalState.availableCashUsd + 1e-7) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "paper_fill_exceeds_available_cash",
      executionStatus: "unfilled",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      availableCashUsd: capitalState.availableCashUsd,
      attemptedReservedUsd: paperFillReservedUsd,
      excludedFromTradeHistoryAndWinRate: true,
    });
    return null;
  }
  const unresolvedReservedAfterFillUsd = capitalState.openReservedUsd + paperFillReservedUsd;
  const unresolvedReserveHardLimitUsd = capitalState.realizedBalanceUsd * MAX_UNRESOLVED_RESERVE_FRACTION;
  if (unresolvedReservedAfterFillUsd > unresolvedReserveHardLimitUsd + 1e-7) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: "unresolved_reserve_hard_limit_after_fill",
      executionStatus: "unfilled_risk_reserve_reject",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      openReservedBeforeEntryUsd: capitalState.openReservedUsd,
      attemptedReservedByEntryUsd: paperFillReservedUsd,
      unresolvedReservedAfterFillUsd,
      unresolvedReserveHardLimitUsd,
      excludedFromTradeHistoryAndWinRate: true,
    });
    return null;
  }
  if (
    paperFill.realParityEligible &&
    paperFill.filledStakeUsd >= PAPER_MIN_RECORDED_FILL_USD &&
    FAST_GROW_EV_POLICY_ENABLED &&
    !fillReconciliation?.executable
  ) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: `paper_${fillReconciliation?.reason || "fastgrow_fill_reconciliation_rejected"}`,
      executionStatus: "unfilled_policy_reject",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      intendedStakeUsd: intendedPaperStakeUsd,
      reconciledIntendedStakeUsd: fillReconciliation?.intendedStakeUsd ?? null,
      filledStakeUsd: paperFill.filledStakeUsd,
      fillReconciliationIterations: fillReconciliation?.iterations ?? null,
      calibratedNetEv: finalCalibratedNetEv,
      independentAssetEdgePolicy: finalIndependentAssetEdge,
      fastGrowEvPolicy: finalFastGrowEvPolicy,
      fastGrowSizing: finalFastGrowSizing,
      excludedFromTradeHistoryAndWinRate: true,
    });
    return null;
  }
  if (paperFill.filledStakeUsd < PAPER_MIN_RECORDED_FILL_USD || !paperFill.realParityEligible) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: `paper_${paperFill.reason || "unfilled"}`,
      executionStatus: "unfilled",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      intendedStakeUsd: intendedPaperStakeUsd,
      filledStakeUsd: paperFill.filledStakeUsd,
      orderType: PAPER_ORDER_TYPE,
      bestAskAtDecision: paperFill.bestAskAtDecision,
      limitPrice: paperFill.limitPrice,
      bookAgeMs: prediction.bookAgeMs,
      excludedFromTradeHistoryAndWinRate: true,
    });
    return null;
  }
  if (INDEPENDENT_ASSET_EDGE_ENABLED && !finalIndependentAssetEdge.eligible) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: `paper_${finalIndependentAssetEdge.reason || "independent_asset_edge_rejected"}`,
      executionStatus: "unfilled_policy_reject",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      independentAssetEdgePolicy: finalIndependentAssetEdge,
      calibratedNetEv: finalCalibratedNetEv,
      excludedFromTradeHistoryAndWinRate: true,
    });
    return null;
  }
  if (!finalRegimeCorePolicy.eligible || (FAST_GROW_EV_POLICY_ENABLED && !finalFastGrowEvPolicy.executable)) {
    auditLogger.decision({
      time: new Date(now).toISOString(),
      reason: `paper_${finalFastGrowEvPolicy?.reason || finalRegimeCorePolicy.reason}`,
      executionStatus: "unfilled_policy_reject",
      slug: key,
      strategy: selectedStrategy,
      direction: selectedDirection,
      calibratedNetEv: finalCalibratedNetEv,
      regimeCorePolicy: finalRegimeCorePolicy,
      fastGrowEvPolicy: finalFastGrowEvPolicy,
      excludedFromTradeHistoryAndWinRate: true,
    });
    return null;
  }
  seenPredictionSignals.set(cooldownKey, now);
  const paperStakeUsd = paperFill.filledStakeUsd;
  const paperShares = paperFill.filledShares;
  const potentialProfitUsd = paperFill.netPotentialProfitUsd;
  const signalCurrentPrice = toNumber(prediction.currentPrice, 0);
  const signalPriceToBeat = toNumber(prediction.priceToBeat, 0);
  const signalDistanceBps = signalCurrentPrice > 0 && signalPriceToBeat > 0
    ? Math.abs((signalCurrentPrice / signalPriceToBeat) - 1) * 10_000
    : toNumber(prediction.distanceBps, 0);
  const referencePriceStatus = signalCurrentPrice > 0 && signalPriceToBeat > 0
    ? "available"
    : "unavailable";

  const signal = {
    id: `${key}:${selectedStrategy}:${selectedDirection}:${now}`,
    strategyVersion: BTC_PREDICTION_STRATEGY_VERSION,
    releaseVersion: V356_RELEASE_VERSION,
    configHash: V3745_CONFIG_HASH,
    botRole: BOT_ROLE,
    botInstanceId: BOT_INSTANCE_ID,
    researchSampleBucket: activeResearchSampleBucket,
    probabilityModel: prediction.predictionEngine || "v3745_regime_core_independent_asset_with_observer_fail_safe",
    probabilityModelInputs: prediction.independentProbabilityModel || null,
    eligibilityEpisode,
    mainAccuracyLane,
    calibratedNetEv: finalCalibratedNetEv,
    legacyCalibrationTelemetry: finalCalibratedNetEv,
    regimeCorePolicy: finalRegimeCorePolicy,
    regimeCoreEconomics: finalRegimeCoreEconomics,
    observerProbability: prediction.observerProbability || null,
    observerPolicyStatus: prediction.observerPolicyStatus || null,
    cohortRegimeGuard: prediction.cohortRegimeGuard || null,
    preliminaryCalibratedNetEv: prediction.preliminaryCalibratedNetEv || null,
    independentAssetEdgePolicy: finalIndependentAssetEdge,
    preliminaryIndependentAssetEdgePolicy: prediction.independentAssetEdgePolicy || null,
    fastGrowEvPolicy: finalFastGrowEvPolicy || prediction.fastGrowEvPolicy || null,
    fastGrowSizing: finalFastGrowSizing || prediction.fastGrowSizing || null,
    fillReconciliation: fillReconciliation
      ? {
          reason: fillReconciliation.reason,
          iterations: fillReconciliation.iterations,
          preliminaryIntendedStakeUsd: intendedPaperStakeUsd,
          reconciledIntendedStakeUsd: fillReconciliation.intendedStakeUsd,
          finalLane: finalFastGrowEvPolicy?.lane || null,
        }
      : null,
    antiPlateauCompounding: {
      ...(prediction.antiPlateauCompounding || {}),
      finalFilledStakeToEquityPct: toNumber(prediction.accountEquity, 0) > 0
        ? (paperFill.filledStakeUsd / prediction.accountEquity) * 100
        : null,
    },
    calibratedWinProbability: finalRegimeCoreEconomics.calibratedProbability,
    calibratedNetEdge: finalRegimeCoreEconomics.netEdge,
    calibrationProfileId: finalRegimeCorePolicy.policyId,
    legacyCalibrationProfileId: finalCalibratedNetEv.profileId,
    strategy: selectedStrategy,
    entryStrategy: selectedStrategy,
    sourceType: String(prediction.bookSource || "").includes("synthetic") || /learning fallback/i.test(prediction.title || "") ? "fallback" : "real_market",
    riskProfile: prediction.riskProfile || RISK_PROFILE,
    aggressiveLearningMode: Boolean(prediction.aggressiveLearningMode),
    time: new Date(now).toISOString(),
    slug: market.slug,
    conditionId: market.conditionId || market.marketId || null,
    title: market.title,
    marketUrl: market.marketUrl || `${POLYMARKET_WEB}/event/${market.slug}`,
    symbol: prediction.symbol || market.symbol || detectCryptoSymbol(`${market.title || ""} ${market.slug || ""}`),
    timeframe: prediction.timeframe || market.timeframe || detectMarketTimeframe(`${market.title || ""} ${market.slug || ""}`),
    marketFamily: prediction.marketFamily || market.marketFamily || detectMarketFamily(`${market.title || ""} ${market.slug || ""}`),
    predictionEngine: prediction.predictionEngine || "btc_price_distance",
    direction: prediction.predictedOutcome,
    confidence: prediction.confidence,
    priceToBeat: signalPriceToBeat > 0 ? signalPriceToBeat : null,
    currentPrice: signalCurrentPrice > 0 ? signalCurrentPrice : null,
    targetSource: prediction.targetSource || null,
    currentSource: prediction.currentSource || null,
    currentPriceAgeMs: mainAccuracyLane.currentPriceAgeMs,
    binanceContextPrice: prediction.binanceContextPrice ?? null,
    binanceContextAgeMs: prediction.binanceContextAgeMs ?? null,
    binanceContextSource: prediction.binanceContextSource || null,
    binanceContextDivergenceBps: prediction.binanceContextDivergenceBps ?? null,
    referencePriceStatus,
    priceDelta: prediction.priceDelta,
    buyPrice: paperFill.averageFillPrice,
    bestAskAtDecision: paperFill.bestAskAtDecision,
    worstFillPrice: paperFill.worstFillPrice,
    entryLimitPrice: paperFill.limitPrice,
    bidPrice: prediction.selectedBidPrice,
    selectedEdgePercent: prediction.selectedEdgePercent,
    selectedSpreadCents: prediction.selectedSpreadCents,
    probabilityUp: prediction.probabilityUp,
    probabilityDown: prediction.probabilityDown,
    pAssetUp: prediction.pAssetUp ?? prediction.independentProbabilityModel?.assetProbabilityUp ?? prediction.independentProbabilityModel?.probabilityUp ?? null,
    pMarketUp: prediction.pMarketUp ?? prediction.independentProbabilityModel?.marketProbabilityUp ?? null,
    pFinalUp: prediction.pFinalUp ?? prediction.probabilityUp ?? null,
    calibrationStatus: prediction.calibrationStatus || prediction.independentProbabilityModel?.calibrationStatus || "unavailable",
    selectedProbability: prediction.selectedProbability,
    assetProbability: prediction.assetProbability ?? prediction.selectedProbability ?? null,
    assetConfidence: prediction.assetConfidence ?? prediction.confidence ?? null,
    assetNetEdge: finalIndependentAssetEdge.netEdge ?? prediction.assetNetEdge ?? null,
    bookConfirmationScore: prediction.bookConfirmationScore ?? null,
    bookConfirmed: prediction.bookConfirmed === true,
    feeAdjustedEdge: prediction.feeAdjustedEdge,
    grossEdge: prediction.grossEdge,
    feeEstimate: prediction.feeEstimate,
    rank: prediction.rank,
    volatilityAdjustedDistance: prediction.volatilityAdjustedDistance,
    volatility60Bps: prediction.volatility60Bps,
    momentum15Bps: prediction.momentum15Bps,
    momentum30Bps: prediction.momentum30Bps,
    momentum60Bps: prediction.momentum60Bps,
    yesNoAskCost: prediction.yesNoAskCost,
    directionShadowEntrySnapshot: {
      schemaVersion: "v3747.direction-shadow-entry-snapshot.1",
      capturedAt: new Date(now).toISOString(),
      observerOnlyConsumer: true,
      entrySnapshotOnly: true,
      liveMarketData: true,
      syntheticDataUsed: false,
      bookSource: prediction.bookSource,
      bookAgeMs: mainAccuracyLane.bookAgeMs,
      upBestAsk: prediction.predictedOutcome === "Up" ? paperFill.bestAskAtDecision : prediction.upBuyPrice,
      downBestAsk: prediction.predictedOutcome === "Down" ? paperFill.bestAskAtDecision : prediction.downBuyPrice,
      upBestAskDepthShares: prediction.upDepthShares,
      downBestAskDepthShares: prediction.downDepthShares,
      selectedDirection: prediction.predictedOutcome,
      selectedAverageFillPrice: paperFill.averageFillPrice,
      selectedFilledStakeUsd: paperFill.filledStakeUsd,
    },
    selectedBookImbalance: prediction.selectedBookImbalance,
    selectedDepthPressure: prediction.selectedDepthPressure,
    sideDepthAdvantage: prediction.sideDepthAdvantage,
    selectedMicropriceEdgeCents: prediction.selectedMicropriceEdgeCents,
    selectedAskSlopeCents: prediction.selectedAskSlopeCents,
    stableTicks: prediction.stableTicks,
    riskReason: prediction.riskReason,
    progressiveStage: prediction.progressiveStage,
    progressiveStageReason: prediction.progressiveStageReason,
    progressiveStakeMultiplier: prediction.progressiveStakeMultiplier,
    selectedCandidateReasons: prediction.selectedCandidateReasons || [],
    replayOptimizerReason: prediction.replayOptimizerDecision?.reason || "replay_optimizer_clear",
    replayOptimizerMatchedRules: (prediction.replayOptimizerDecision?.matchedRules || []).map((rule) => rule.id),
    runtimeRuleReason: prediction.runtimeRuleReason || "runtime_rule_cache_neutral",
    runtimeScoreAdjustment: prediction.runtimeScoreAdjustment || 0,
    runtimeStakeMultiplier: prediction.runtimeStakeMultiplier ?? 1,
    runtimeMatchedBuckets: prediction.runtimeMatchedBuckets || [],
    softQualityReasons: prediction.softQualityReasons || [],
    softQualityStakeMultiplier: prediction.softQualityStakeMultiplier ?? 1,
    executionQualityScore: prediction.executionQualityScore || 0,
    executionQualityThreshold: prediction.executionQualityThreshold || 0,
    executionQualityReasons: prediction.executionQualityReasons || [],
    executionObserveOnly: Boolean(prediction.executionObserveOnly),
    calibratedLane: finalFastGrowEvPolicy?.lane || prediction.calibratedLane || "unknown",
    entryLane: finalFastGrowEvPolicy?.lane || prediction.calibratedLane || "unknown",
    calibratedProfile: prediction.calibratedProfile || null,
    v337PriorityScore: prediction.v337PriorityScore ?? null,
    v337PriorityStakeMultiplier: prediction.v337PriorityStakeMultiplier ?? null,
    v337PriorityReasons: prediction.v337PriorityReasons || [],
    profitLockMode: prediction.profitLockMode || prediction.profitLockState?.mode || "normal",
    profitLockGivebackRatio: prediction.profitLockGivebackRatio ?? prediction.profitLockState?.givebackRatio ?? null,
    profitLockGivebackUsd: prediction.profitLockGivebackUsd ?? prediction.profitLockState?.givebackUsd ?? null,
    profitLockPeakEquity: prediction.profitLockPeakEquity ?? prediction.profitLockState?.peakEquity ?? null,
    stakeCapUsd: prediction.stakeCapUsd || null,
    stakeCapReasons: prediction.stakeCapReasons || [],
    clusterProtectionReason: clusterProtection.reason || "cluster_protection_clear",
    clusterProtectionReasons: clusterProtection.reasons || [],
    clusterOpenInWindow: clusterProtection.openInWindow || 0,
    clusterSameSideOpen: clusterProtection.sameSideOpen || 0,
    clusterFullStakeOpen: clusterProtection.fullStakeOpen || 0,
    clusterSameSideFullStakeOpen: clusterProtection.sameSideFullStakeOpen || 0,
    startupWarmupActive: Boolean(clusterProtection.startupActive),
    recentLossBrakeActive: Boolean(clusterProtection.recentBrake),
    whyEntered: [
      `lane:${finalFastGrowEvPolicy?.lane || prediction.calibratedLane || "unknown"}`,
      `profitLock:${prediction.profitLockMode || prediction.profitLockState?.mode || "normal"}`,
      `winProb:${finalRegimeCoreEconomics.calibratedProbability ?? "na"}`,
      `ev:${finalRegimeCoreEconomics.netEdge ?? "na"}`,
      `core:${finalRegimeCorePolicy.reason}`,
      `episode:${eligibilityEpisode.distinctSnapshots || 0}/${eligibilityEpisode.requirements?.requiredSnapshots || 0}`,
      `cluster:${clusterProtection.reason || "clear"}`,
      `stakeCap:${[...(prediction.stakeCapReasons || []), ...(clusterProtection.reasons || [])].join("|") || "none"}`
    ],
    whyNotFullStake: [...(prediction.stakeCapReasons || []), ...(clusterProtection.reasons || [])],
    paperMaxTradeUsd: paperMaxTradeUsd,
    dynamicMaxTradeUsd: prediction.dynamicMaxTradeUsd ?? paperMaxTradeUsd,
    accountEquity: prediction.accountEquity ?? null,
    equityStakeScale: prediction.equityStakeScale ?? null,
    equityScaledLaneCapUsd: prediction.equityScaledLaneCapUsd ?? null,
    rawRecommendedStakeUsd: prediction.rawRecommendedStakeUsd ?? prediction.recommendedStakeUsd ?? null,
    recommendedStakeUsd: prediction.recommendedStakeUsd ?? null,
    oppositeSideExposureReason: oppositeSideExposure.reason || "no_opposite_side_exposure",
    oppositeSideStakeMultiplier,
    oppositeSideCombinedPrice: oppositeSideExposure.combinedPrice ?? null,
    oppositeSideAverageBuyPrice: oppositeSideExposure.oppositeAverageBuyPrice ?? null,
    oppositeSideOpenCount: oppositeSideExposure.oppositeOpenCount || 0,
    exposureGovernorReason: exposureGovernor.reason || "exposure_governor_clear",
    exposureGovernorReasons: exposureGovernor.reasons || [],
    exposureStakeMultiplier,
    exposureOpenUsd: exposureGovernor.openExposure || 0,
    exposureLimitUsd: exposureGovernor.exposureLimit || 0,
    paperAvailableCashBeforeEntryUsd: capitalState.availableCashUsd,
    paperOpenReservedBeforeEntryUsd: capitalState.openReservedUsd,
    paperReservedByEntryUsd: paperFillReservedUsd,
    actualMarketMinimumStake: actualMarketMinimum,
    unresolvedReserveLimit,
    capitalDeadlockBug: false,
    realExecutionMode: realExecutionReadiness.mode || REAL_EXECUTION_MODE,
    realShadowApproved: realExecutionReadiness.approved,
    realShadowReason: realExecutionReadiness.reason,
    realShadowReasons: realExecutionReadiness.reasons || [],
    realShadowWarnings: realExecutionReadiness.warnings || [],
    realShadowTickSize: realExecutionReadiness.tickSize,
    realShadowTickAligned: realExecutionReadiness.tickAligned,
    realShadowMinOrderSizeUsd: realExecutionReadiness.minOrderSizeUsd,
    realShadowProjectedLimitPrice: realExecutionReadiness.projectedLimitPrice,
    realShadowProjectedSlippageCents: realExecutionReadiness.projectedSlippageCents,
    realShadowRequiredShares: realExecutionReadiness.requiredShares,
    realShadowVisibleDepthShares: realExecutionReadiness.depthShares,
    realShadowEstimatedFillFraction: realExecutionReadiness.estimatedFillFraction,
    realShadowTestStakeUsd: realExecutionReadiness.testStakeUsd,
    adaptiveStakeMultiplier: prediction.adaptiveStakeMultiplier ?? 1,
    adaptiveReason: prediction.adaptiveDecision?.reason || "adaptive_clear",
    adaptiveMatchedRules: (prediction.adaptiveDecision?.matchedRules || []).map((rule) => rule.id),
    secondsIntoWindow: prediction.secondsIntoWindow,
    distanceBps: signalDistanceBps,
    requiredConfidence: prediction.requiredConfidence,
    learnedBucket: prediction.learnedBucket,
    bookSource: prediction.bookSource,
    bookAgeMs: mainAccuracyLane.bookAgeMs,
    depthShares: prediction.predictedOutcome === "Up" ? prediction.upDepthShares : prediction.downDepthShares,
    paperStakeUsd,
    intendedStakeUsd: intendedPaperStakeUsd,
    fillableStakeUsd: paperFill.fillableStakeUsd,
    filledStakeUsd: paperFill.filledStakeUsd,
    unfilledStakeUsd: paperFill.unfilledStakeUsd,
    paperShares,
    filledShares: paperFill.filledShares,
    paperFillShares: paperFill.filledShares,
    executionStatus: paperFill.executionStatus,
    paperOrderType: paperFill.orderType,
    paperFillFraction: paperFill.fillFraction,
    paperFillLevelsUsed: paperFill.levelsUsed,
    averageFillPrice: paperFill.averageFillPrice,
    takerFeeUsd: paperFill.takerFeeUsd,
    takerFeeRate: toNumber(prediction.takerFeeRate, PAPER_CRYPTO_TAKER_FEE_RATE),
    slippageUsd: paperFill.slippageUsd,
    slippageCents: paperFill.slippageCents,
    grossPotentialProfitUsd: paperFill.grossPotentialProfitUsd,
    potentialProfitUsd,
    realParityEligible: paperFill.realParityEligible,
    learningEligible: true,
    decisionToSendLatencyMs: Math.max(0, Date.now() - now),
    bookAgeAtCommitMs: Math.max(0, Date.now() - toNumber(prediction.bookSnapshotReceivedAtMs, now)),
    windowStart: market.windowStart,
    windowEnd: market.windowEnd,
    status: "paper_open",
  };

  auditLogger.decision({
    time: signal.time,
    reason: "paper_entry_committed",
    executionStatus: signal.executionStatus,
    signalId: signal.id,
    slug: signal.slug,
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    strategy: signal.strategy,
    direction: signal.direction,
    paperStakeUsd: signal.paperStakeUsd,
    filledShares: signal.filledShares,
    averageFillPrice: signal.averageFillPrice,
    takerFeeUsd: signal.takerFeeUsd,
    slippageCents: signal.slippageCents,
    calibratedNetEv: finalCalibratedNetEv,
    regimeCorePolicy: finalRegimeCorePolicy,
    observerProbability: prediction.observerProbability || null,
    cohortRegimeGuard: prediction.cohortRegimeGuard || null,
    independentAssetEdgePolicy: finalIndependentAssetEdge,
    eligibilityEpisode,
    bookConfirmationScore: prediction.bookConfirmationScore ?? null,
    bookConfirmed: prediction.bookConfirmed === true,
    actualMarketMinimum,
    unresolvedReserveLimit,
    capitalDeadlockBug: false,
    excludedFromTradeHistoryAndWinRate: false,
  });
  auditLogger.signal(signal);
  eligibilityEpisodeStore.commit(eligibilityEpisode.key, eligibilityEpisode.correlation?.correlationIndex || 0);
  eligibilityEpisodeStore.delete(buildEligibilityEpisodeKey({
    sessionGeneration: paperLedgerGeneration,
    slug: market.slug,
    side: selectedDirection === "UP" ? "DOWN" : "UP",
  }));
  return signal;
}

async function scanBtcPrediction(previousPrediction = createEmptyPrediction()) {
  await settleShadowSignals(Date.now()).catch(() => {});
  if (!BTC_PREDICTION_ENABLED) {
    return createEmptyPrediction({
      status: "disabled",
      reason: "btc_prediction_disabled",
      signals: previousPrediction.signals || [],
      history: previousPrediction.history || [],
      stats: summarizePredictionStats(previousPrediction.signals || []),
      updatedAt: new Date().toISOString(),
    });
  }

  const now = Date.now();
  const paperGenerationAtStart = paperLedgerGeneration;

  try {
    const spotSnapshot = getExternalPriceSnapshot("BTC", now);
    const spot = {
      price: spotSnapshot.available ? spotSnapshot.price : 0,
      source: spotSnapshot.source || "polymarket_chainlink_rtds_pending",
    };
    const market = await fetchBtc5mMarket(now);
    const declaredTarget = declaredMarketPriceToBeat(market);
    if (declaredTarget > 0) priceTargetCache.set(market.slug, { price: declaredTarget, source: "polymarket_market_event_metadata" });
    scheduleOfficialPriceToBeatRefresh(market);
    const target = priceTargetCache.get(market.slug) || { price: 0, source: "polymarket_target_pending" };
    const externalAnchor = buildExternalPriceAnchorForMarket(market, now);
    const [upBookSnapshot, downBookSnapshot] = await fetchEntryBookPair(market.upTokenId, market.downTokenId);
    const upAsk = upBookSnapshot ? getBestAsk(upBookSnapshot.book) : null;
    const downAsk = downBookSnapshot ? getBestAsk(downBookSnapshot.book) : null;
    const upBid = upBookSnapshot ? getBestBid(upBookSnapshot.book) : null;
    const downBid = downBookSnapshot ? getBestBid(downBookSnapshot.book) : null;
    const upBuyPrice = upAsk?.price || 0;
    const downBuyPrice = downAsk?.price || 0;
    const upBidPrice = upBid?.price || 0;
    const downBidPrice = downBid?.price || 0;
    const upSellPrice = upBidPrice;
    const downSellPrice = downBidPrice;
    const upMidPrice = upBuyPrice > 0 && upBidPrice > 0 ? (upBuyPrice + upBidPrice) / 2 : 0;
    const downMidPrice = downBuyPrice > 0 && downBidPrice > 0 ? (downBuyPrice + downBidPrice) / 2 : 0;
    const upDepthShares = upAsk?.size || 0;
    const downDepthShares = downAsk?.size || 0;
    const upDepthDiagnostics = upBookSnapshot ? getBookDepthDiagnostics(upBookSnapshot.book) : {};
    const downDepthDiagnostics = downBookSnapshot ? getBookDepthDiagnostics(downBookSnapshot.book) : {};
    const bookSource = [upBookSnapshot?.source || "none", downBookSnapshot?.source || "none"].join("+");
    const bookAgeMs = Math.max(toNumber(upBookSnapshot?.ageMs, 0), toNumber(downBookSnapshot?.ageMs, 0));
    const settledPreviousSignals = await settlePredictionSignals(previousPrediction.signals || [], now);
    const adaptiveLearningSignals = ADAPTIVE_USE_IMPORTED_LEARNING
      ? [...(IMPORTED_LEARNING_BRAIN?.adaptiveSignals || []), ...settledPreviousSignals]
      : settledPreviousSignals;
    let adaptiveState = buildAdaptiveLearningState(adaptiveLearningSignals, now, buildAdaptiveConfig());
    if (ADAPTIVE_USE_IMPORTED_LEARNING && IMPORTED_LEARNING_BRAIN?.adaptiveSignals?.length) {
      const runtimeAdaptiveState = buildAdaptiveLearningState(settledPreviousSignals, now, buildAdaptiveConfig());
      adaptiveState = {
        ...adaptiveState,
        summary: {
          ...adaptiveState.summary,
          consecutiveLosses: runtimeAdaptiveState.summary.consecutiveLosses,
          recoveryActive: runtimeAdaptiveState.summary.recoveryActive,
          hardStopActive: runtimeAdaptiveState.summary.hardStopActive,
        },
        recovery: runtimeAdaptiveState.recovery,
      };
    }
    persistAdaptiveLearningState(DATA_DIR, adaptiveState);
    const previousHistory = previousPrediction.history || [];
    const previousStats = summarizePredictionStats(settledPreviousSignals);
    const lossCircuit = evaluatePredictionLossCircuit(settledPreviousSignals, now);
    const prices = {
      upBuyPrice,
      downBuyPrice,
      upBidPrice,
      downBidPrice,
      upSellPrice,
      downSellPrice,
      upMidPrice,
      downMidPrice,
      upDepthShares,
      downDepthShares,
      bookAgeMs,
      upDepthDiagnostics,
      downDepthDiagnostics,
    };
    const calculated = calculateDirectionalMarketPrediction({
      market: {
        ...market,
        symbol: market.symbol || "BTC",
        timeframe: market.timeframe || "5M",
        marketFamily: market.marketFamily || "DIRECTIONAL",
      },
      prices,
      externalAnchor,
      previousHistory,
      previousStats,
      previousSignals: settledPreviousSignals,
      lossCircuit,
      now,
    });
    let basePrediction = {
      status: "live",
      title: market.title,
      slug: market.slug,
      marketUrl: market.marketUrl,
      windowStart: market.windowStart,
      windowEnd: market.windowEnd,
      priceToBeat: target.price,
      targetSource: target.source,
      currentPrice: spot.price,
      currentSource: spot.source,
      upBuyPrice,
      downBuyPrice,
      upSellPrice,
      downSellPrice,
      upMidPrice,
      downMidPrice,
      upDepthShares,
      downDepthShares,
      upBidPrice,
      downBidPrice,
      bookSource,
      bookAgeMs,
      takerFeeRate: market.takerFeeRate ?? PAPER_CRYPTO_TAKER_FEE_RATE,
      minOrderSize: resolveMarketMinimumShares(
        market.minOrderSize,
        market.min_order_size,
        market.mos,
        upBookSnapshot?.book?.min_order_size,
        upBookSnapshot?.book?.minimum_order_size,
        downBookSnapshot?.book?.min_order_size,
        downBookSnapshot?.book?.minimum_order_size,
      ),
      upExecutionAsks: normalizeBookLevels(upBookSnapshot?.book?.asks, "ask"),
      downExecutionAsks: normalizeBookLevels(downBookSnapshot?.book?.asks, "ask"),
      upBookIntegrity: upBookSnapshot?.book?.integrityReason || "missing",
      downBookIntegrity: downBookSnapshot?.book?.integrityReason || "missing",
      upBookReceivedAtMs: toNumber(upBookSnapshot?.book?.receivedAt, 0) || null,
      downBookReceivedAtMs: toNumber(downBookSnapshot?.book?.receivedAt, 0) || null,
      upBookEventTimestampMs: toNumber(upBookSnapshot?.book?.lastEventTimestamp, 0) || null,
      downBookEventTimestampMs: toNumber(downBookSnapshot?.book?.lastEventTimestamp, 0) || null,
      upBookEconomicRevision: toNumber(upBookSnapshot?.book?.economicRevision, 0) || null,
      downBookEconomicRevision: toNumber(downBookSnapshot?.book?.economicRevision, 0) || null,
      upBookEconomicGeneration: upBookSnapshot?.book?.economicGeneration || null,
      downBookEconomicGeneration: downBookSnapshot?.book?.economicGeneration || null,
      upTickSize: toNumber(upBookSnapshot?.book?.minimum_tick_size ?? upBookSnapshot?.book?.tick_size, market.tickSize || 0.01),
      downTickSize: toNumber(downBookSnapshot?.book?.minimum_tick_size ?? downBookSnapshot?.book?.tick_size, market.tickSize || 0.01),
      bookSnapshotReceivedAtMs: Math.min(
        toNumber(upBookSnapshot?.book?.receivedAt, now),
        toNumber(downBookSnapshot?.book?.receivedAt, now),
      ),
      upOutcomePrice: market.upOutcomePrice,
      downOutcomePrice: market.downOutcomePrice,
      signals: settledPreviousSignals,
      history: previousHistory,
      updatedAt: new Date(now).toISOString(),
      lastError: "",
      ...calculated,
      priceToBeat: externalAnchor.priceToBeat || 0,
      targetSource: externalAnchor.targetSource || "external_price_window_anchor",
      currentPrice: externalAnchor.currentPrice || 0,
      currentSource: externalAnchor.currentSource || "external_price_ws_cache",
      referencePriceStatus: externalAnchor.referencePriceStatus || "unavailable",
      priceDelta: externalAnchor.priceDelta ?? calculated.priceDelta ?? 0,
      priceDeltaPercent: externalAnchor.priceDeltaPercent ?? calculated.priceDeltaPercent ?? 0,
      distanceBps: externalAnchor.distanceBps ?? calculated.distanceBps ?? 0,
      requiredDistanceBps: externalAnchor.requiredDistanceBps ?? calculated.requiredDistanceBps ?? 0,
      momentum15Bps: externalAnchor.momentum15Bps ?? calculated.momentum15Bps ?? 0,
      momentum30Bps: externalAnchor.momentum30Bps ?? calculated.momentum30Bps ?? 0,
      momentum60Bps: externalAnchor.momentum60Bps ?? calculated.momentum60Bps ?? 0,
      predictionEngine: calculated.predictionEngine,
    };
    if (REAL_MARKET_DATA_ONLY && (market.synthetic || !hasLiveBookSource(bookSource))) {
      const blockedPrediction = {
        ...basePrediction,
        tradeable: false,
        riskApproved: false,
        status: "live",
        reason: market.synthetic ? "blocked_learning_fallback_real_data_only" : "blocked_non_live_orderbook_real_data_only",
        riskReason: market.synthetic ? "blocked_learning_fallback_real_data_only" : "blocked_non_live_orderbook_real_data_only",
      };
      auditLogger.decision({
        time: new Date(now).toISOString(),
        reason: blockedPrediction.reason,
        realMarketDataOnly: true,
        bookSource,
        marketSynthetic: Boolean(market.synthetic),
      });
      basePrediction = blockedPrediction;
    }

    const strategyAccountRisk = accountRiskFromSignals(
      settledPreviousSignals,
      getBankrollFromStats(previousStats),
      PAPER_START_BALANCE,
      { activeWindowKey: market.slug },
    );
    const strategyRouterDecision = evaluateStrategyRouter({
      prediction: basePrediction,
      accountRisk: strategyAccountRisk,
      config: buildStrategyRouterConfig(buildStrategyPerformanceReport(settledPreviousSignals), settledPreviousSignals),
    });
    for (const candidate of strategyRouterDecision.candidates || []) {
      auditLogger.strategy({
        time: new Date(now).toISOString(),
        ...candidate,
        gates: undefined,
        consensus: undefined,
        gateSummary: candidate.gates?.gateSummary,
        blockedAt: candidate.blockedAt,
      });
      auditLogger.gate({
        time: new Date(now).toISOString(),
        strategy: candidate.strategy,
        side: candidate.side,
        approved: candidate.approved,
        reason: candidate.blockedReason || candidate.gates?.reason || "approved",
        blockedAt: candidate.blockedAt || null,
        gateSummary: candidate.gates?.gateSummary || null,
      });
    }
    basePrediction = applyStrategySelectionToPrediction(basePrediction, strategyRouterDecision, strategyAccountRisk);
    basePrediction = applyAdaptiveAvoidanceToPrediction(basePrediction, adaptiveState, strategyAccountRisk);

    // V361 Shadow selection logging
    if ((V361_SHADOW_ONLY || SHADOW_OBSERVER_ENABLED) && Array.isArray(strategyRouterDecision.candidates)) {
      const shadowReranked = strategyRouterDecision.candidates
        .map((cand) => {
          const v361 = scoreV361Capped(cand, basePrediction);
          return {
            ...cand,
            v361Score: v361.score,
            totalV361Score: toNumber(cand.score, 0) + v361.score,
          };
        })
        .filter((cand) => cand.approved !== false)
        .sort((left, right) => right.totalV361Score - left.totalV361Score);

      const topShadow = shadowReranked[0];
      if (topShadow) {
        logV361ShadowCandidate(topShadow, market, now);
      }
    }

    if (paperGenerationAtStart !== paperLedgerGeneration) {
      return state.prediction || createEmptyPrediction({
        status: "reset",
        reason: "paper_equity_reset_ignored_stale_scan",
        updatedAt: new Date(now).toISOString(),
      });
    }

    const approvedCandidates = buildNoDowngradeEntryCandidatePool(
      strategyRouterDecision.candidates || [],
      basePrediction,
    ).slice(0, PAPER_MAX_ENTRIES_PER_TICK);
    let signals = settledPreviousSignals;
    const newSignals = [];
    for (const candidate of approvedCandidates) {
      const dynamicAccountRisk = accountRiskFromSignals(
        signals,
        getBankrollFromStats(summarizePredictionStats(signals)),
        PAPER_START_BALANCE,
        { activeWindowKey: market.slug },
      );
      const candidatePrediction = applyAdaptiveAvoidanceToPrediction(
        applyStrategySelectionToPrediction(basePrediction, { ...strategyRouterDecision, selected: candidate }, dynamicAccountRisk),
        adaptiveState,
        dynamicAccountRisk,
      );
      const signal = maybeCreatePredictionSignal({ ...candidatePrediction, signals }, market, now);
      if (signal) {
        newSignals.push(signal);
        signals = [signal, ...signals].slice(0, 500);
      }
    }
    const historyPoint = {
      time: new Date(now).toISOString(),
      slug: market.slug,
      currentPrice: spot.price,
      priceToBeat: target.price,
      priceDelta: calculated.priceDelta,
      confidence: calculated.confidence,
      predictedOutcome: calculated.predictedOutcome,
      selectedEdgePercent: calculated.selectedEdgePercent,
      selectedSpreadCents: calculated.selectedSpreadCents,
      selectedBidPrice: calculated.selectedBidPrice,
      probabilityUp: calculated.probabilityUp,
      probabilityDown: calculated.probabilityDown,
      selectedProbability: calculated.selectedProbability,
      feeAdjustedEdge: calculated.feeAdjustedEdge,
      rank: calculated.rank,
      momentum15Bps: calculated.momentum15Bps,
      momentum30Bps: calculated.momentum30Bps,
      momentum60Bps: calculated.momentum60Bps,
      volatility60Bps: calculated.volatility60Bps,
      volatilityAdjustedDistance: calculated.volatilityAdjustedDistance,
      yesNoAskCost: calculated.yesNoAskCost,
      selectedBookImbalance: calculated.selectedBookImbalance,
      selectedDepthPressure: calculated.selectedDepthPressure,
      sideDepthAdvantage: calculated.sideDepthAdvantage,
      selectedMicropriceEdgeCents: calculated.selectedMicropriceEdgeCents,
      selectedAskSlopeCents: calculated.selectedAskSlopeCents,
      riskReason: calculated.riskReason,
      secondsIntoWindow: calculated.secondsIntoWindow,
      distanceBps: calculated.distanceBps,
      requiredDistanceBps: calculated.requiredDistanceBps,
      requiredConfidence: calculated.requiredConfidence,
      learnedBucket: calculated.learnedBucket,
      strategyVersion: BTC_PREDICTION_STRATEGY_VERSION,
      selectedStrategy: basePrediction.selectedStrategy || "current_prediction",
      candidateCount: basePrediction.candidateCount || 0,
      approvedCandidateCount: basePrediction.approvedCandidateCount || 0,
      gateSummary: basePrediction.gateProtocol?.gateSummary || null,
      finalSelectionTradeable: Boolean(basePrediction.tradeable),
      finalSelectionReason: basePrediction.reason || basePrediction.riskReason || "unknown",
      calibratedLane: basePrediction.calibratedLane || null,
      calibratedWinProbability: basePrediction.calibratedWinProbability ?? null,
      calibratedNetEdge: basePrediction.preliminaryCalibratedNetEv?.netEdge ?? null,
      fastGrowEvPolicy: basePrediction.fastGrowEvPolicy || null,
      fastGrowSizing: basePrediction.fastGrowSizing || null,
      antiPlateauCompounding: basePrediction.antiPlateauCompounding || null,
      recommendedStakeUsd: basePrediction.recommendedStakeUsd ?? null,
      dynamicMaxTradeUsd: basePrediction.dynamicMaxTradeUsd ?? null,
      riskProfile: RISK_PROFILE,
      aggressiveLearningMode: AGGRESSIVE_LEARNING_MODE,
      upBuyPrice,
      downBuyPrice,
      upDepthShares,
      downDepthShares,
      bookSource,
    };
    recordPredictionSnapshot({
      ...historyPoint,
      status: basePrediction.status,
      reason: basePrediction.reason,
      tradeable: basePrediction.tradeable,
      newSignals: newSignals.length,
    });

    if (paperGenerationAtStart !== paperLedgerGeneration) {
      return state.prediction || createEmptyPrediction({
        status: "reset",
        reason: "paper_equity_reset_ignored_stale_scan",
        updatedAt: new Date(now).toISOString(),
      });
    }

    const prediction = {
      ...createEmptyPrediction(),
      ...basePrediction,
      lastSignal: newSignals[0] || signals[0] || null,
      signals,
      history: [...previousHistory, historyPoint].slice(-500),
      stats: summarizePredictionStats(signals),
    };
    if (paperGenerationAtStart === paperLedgerGeneration) savePersistedPrediction(prediction);
    return paperGenerationAtStart === paperLedgerGeneration ? prediction : (state.prediction || prediction);
  } catch (error) {
    const prediction = {
      ...previousPrediction,
      status: "error",
      reason: "btc_prediction_error",
      lastError: error instanceof Error ? error.message : "BTC prediction failed",
      updatedAt: new Date().toISOString(),
      stats: summarizePredictionStats(previousPrediction.signals || []),
    };
    if (paperGenerationAtStart === paperLedgerGeneration) savePersistedPrediction(prediction);
    return paperGenerationAtStart === paperLedgerGeneration ? prediction : (state.prediction || prediction);
  }
}

async function fetchMarkets() {
  const now = Date.now();
  const [markets, targetedMarkets] = await Promise.all([
    fetchGammaMarkets(now),
    fetchCryptoScannerMarkets(now).catch(() => []),
  ]);
  if (!Array.isArray(markets)) return [];

  return dedupeMarkets([
    ...(Array.isArray(targetedMarkets) ? targetedMarkets : []),
    ...markets,
  ])
    .map(normalizeMarket)
    .filter(Boolean)
    .sort((left, right) => scannerMarketPriority(right) - scannerMarketPriority(left))
    .slice(0, Math.min(ORDERBOOK_LIMIT, CRYPTO_SCANNER_MAX_WATCHED_MARKETS));
}

async function fetchGammaMarkets(now = Date.now()) {
  if (gammaMarketCache.expiresAt > now && Array.isArray(gammaMarketCache.markets)) {
    return gammaMarketCache.markets;
  }

  const params = new URLSearchParams({
    active: "true",
    closed: "false",
    limit: String(MARKET_LIMIT),
    enableOrderBook: "true",
  });
  const markets = await fetchJson(`${GAMMA_API}/markets?${params.toString()}`);
  const safeMarkets = Array.isArray(markets) ? markets : [];
  gammaMarketCache = {
    expiresAt: now + MARKET_DISCOVERY_CACHE_TTL_MS,
    markets: safeMarkets,
  };
  return safeMarkets;
}

function dedupeMarkets(markets = []) {
  const map = new Map();
  for (const market of markets) {
    const key = String(market?.conditionId || market?.id || market?.slug || "");
    if (!key) continue;
    const current = map.get(key);
    if (!current || toNumber(market.volumeNum ?? market.volume, 0) > toNumber(current.volumeNum ?? current.volume, 0)) {
      map.set(key, market);
    }
  }
  return [...map.values()];
}

function scannerMarketPriority(market = {}) {
  const isTargetSymbol = market.symbol && market.symbol !== "OTHER";
  const isFastTimeframe = CRYPTO_SCANNER_FAST_TIMEFRAMES.includes(String(market.timeframe || "").toUpperCase());
  const isContextTimeframe = CRYPTO_SCANNER_CONTEXT_TIMEFRAMES.includes(String(market.timeframe || "").toUpperCase());
  const directionalBonus = market.marketFamily === "DIRECTIONAL" ? 120 : 0;
  const symbolBonus = isTargetSymbol ? 140 : 0;
  const timeframeBonus = isFastTimeframe ? 160 : isContextTimeframe ? 45 : 0;
  const liquidityScore = Math.min(35, Math.log10(Math.max(1, toNumber(market.liquidity))) * 6);
  const volumeScore = Math.min(45, Math.log10(Math.max(1, toNumber(market.volume))) * 7);
  return symbolBonus + timeframeBonus + directionalBonus + liquidityScore + volumeScore;
}

async function fetchCryptoScannerMarkets(now = Date.now()) {
  if (!CRYPTO_SCANNER_ENABLED || !CRYPTO_SCANNER_TARGETED_MARKETS_ENABLED) return [];
  if (cryptoScannerMarketCache.expiresAt > now && Array.isArray(cryptoScannerMarketCache.markets)) {
    return cryptoScannerMarketCache.markets;
  }

  const requests = [];
  for (const term of CRYPTO_SCANNER_SYMBOLS) {
    const params = new URLSearchParams({
      active: "true",
      closed: "false",
      enableOrderBook: "true",
      limit: String(CRYPTO_SCANNER_SEARCH_LIMIT_PER_TERM),
      search: term,
    });
    requests.push(fetchJson(`${GAMMA_API}/markets?${params.toString()}`));
  }

  if (CRYPTO_SCANNER_INCLUDE_UPDOWN_SLUGS) {
    for (const slug of buildCryptoUpDownSlugs(now)) {
      requests.push(fetchJson(`${GAMMA_API}/markets/slug/${slug}`).then((market) => [market]));
    }
  }

  const results = await Promise.allSettled(requests);
  const markets = results.flatMap((result) => {
    if (result.status !== "fulfilled") return [];
    return Array.isArray(result.value) ? result.value : [];
  });
  cryptoScannerMarketCache = {
    expiresAt: now + CRYPTO_SCANNER_MARKET_CACHE_TTL_MS,
    markets,
  };
  return markets;
}

function buildCryptoUpDownSlugs(now = Date.now()) {
  const prefixByTerm = {
    bitcoin: "btc",
    btc: "btc",
    ethereum: "eth",
    eth: "eth",
    solana: "sol",
    sol: "sol",
    ripple: "xrp",
    xrp: "xrp",
    dogecoin: "doge",
    doge: "doge",
    bnb: "bnb",
    binance: "bnb",
    microstrategy: "mstr",
    strategy: "mstr",
    mstr: "mstr",
    cardano: "ada",
    ada: "ada",
    chainlink: "link",
    link: "link",
    avalanche: "avax",
    avax: "avax",
    polkadot: "dot",
    dot: "dot",
    litecoin: "ltc",
    ltc: "ltc",
    tron: "trx",
    trx: "trx",
    toncoin: "ton",
    ton: "ton",
    shiba: "shib",
    shib: "shib",
    pepe: "pepe",
    sui: "sui",
    aptos: "apt",
    apt: "apt",
    near: "near",
    arbitrum: "arb",
    arb: "arb",
    optimism: "op",
    op: "op",
    uniswap: "uni",
    uni: "uni",
    aave: "aave",
    ondo: "ondo",
    worldcoin: "wld",
    wld: "wld",
    sei: "sei",
  };
  const prefixes = [...new Set(CRYPTO_SCANNER_SYMBOLS
    .map((term) => prefixByTerm[String(term).trim().toLowerCase()])
    .filter(Boolean))];
  const frames = CRYPTO_SCANNER_FAST_TIMEFRAMES
    .map((frame) => frame.toLowerCase())
    .filter((frame) => frame === "5m" || frame === "15m");
  const slugs = [];
  for (const prefix of prefixes) {
    for (const frame of frames) {
      const seconds = frame === "15m" ? 900 : 300;
      const alignedEpoch = Math.floor(now / (seconds * 1_000)) * seconds;
      for (const epoch of [alignedEpoch - seconds, alignedEpoch, alignedEpoch + seconds]) {
        slugs.push(`${prefix}-updown-${frame}-${epoch}`);
      }
    }
  }
  return [...new Set(slugs)];
}

async function fetchBook(tokenId) {
  const params = new URLSearchParams({ token_id: tokenId });
  return fetchJson(`${CLOB_API}/book?${params.toString()}`);
}

function syncBookFeed(tokenIds) {
  if (!ORDERBOOK_WS_ENABLED) {
    bookFeedState.status = "disabled";
    return;
  }
  if (typeof WebSocket !== "function") {
    bookFeedState.status = "unavailable";
    bookFeedState.lastError = "ws_package_unavailable";
    return;
  }

  const tokens = [...new Set(tokenIds.map(String).filter(Boolean))].slice(0, ORDERBOOK_WS_MAX_TOKENS);
  const tokenKey = tokens.join(",");
  const existingTokens = new Set(bookFeedState.tokens);
  const requestedAlreadyCovered = tokens.length > 0 && tokens.every((token) => existingTokens.has(token));
  const lastMessageMs = Date.parse(bookFeedState.lastMessageAt || bookFeedState.connectedAt || "");
  const silenceMs = Number.isFinite(lastMessageMs) ? Date.now() - lastMessageMs : 0;
  if (
    V337_WS_FREEZE_RECONNECT_MS > 0 &&
    tokens.length > 0 &&
    bookFeedState.ws &&
    bookFeedState.status === "live" &&
    silenceMs > V337_WS_FREEZE_RECONNECT_MS
  ) {
    bookFeedState.status = "stale_reconnect";
    bookFeedState.staleReconnects += 1;
    bookFeedState.lastError = `v337_ws_no_market_events_${silenceMs}ms`;
    try {
      bookFeedState.ws.close();
    } catch {
      bookFeedState.ws = null;
    }
  }
  const staleTokenRefresh =
    V337_WS_STALE_TOKEN_REFRESH_MS > 0 &&
    bookFeedState.lastSubscribeAt &&
    Date.now() - Date.parse(bookFeedState.lastSubscribeAt) > V337_WS_STALE_TOKEN_REFRESH_MS &&
    tokens.length > existingTokens.size &&
    !requestedAlreadyCovered;
  if (
    !tokens.length ||
    (
      bookFeedState.ws &&
      ["connecting", "live"].includes(bookFeedState.status) &&
      !staleTokenRefresh &&
      (bookFeedState.tokenKey === tokenKey || requestedAlreadyCovered)
    )
  ) {
    return;
  }

  try {
    if (bookFeedState.heartbeatTimer) {
      clearInterval(bookFeedState.heartbeatTimer);
      bookFeedState.heartbeatTimer = null;
    }
    bookFeedState.ws?.close?.();
  } catch {
    // Closing a stale feed should not affect REST scans.
  }

  bookFeedState.status = "connecting";
  bookFeedState.tokens = tokens;
  bookFeedState.tokenKey = tokenKey;
  bookFeedState.lastError = "";
  bookFeedState.connectedAt = null;
  bookFeedState.lastSubscribeAt = null;

  try {
    const ws = new WebSocket(CLOB_WS_API, {
      perMessageDeflate: false,
      handshakeTimeout: REQUEST_TIMEOUT_MS,
      headers: {
        origin: POLYMARKET_WEB,
        "user-agent": "trade-paper-bot/1.0",
      },
      lookup: USE_DOH ? dohLookup : undefined,
    });
    bookFeedState.ws = ws;
    const openTimeout = setTimeout(() => {
      if (bookFeedState.ws === ws && bookFeedState.status === "connecting") {
        bookFeedState.status = "timeout";
        bookFeedState.lastError = "book_feed_open_timeout";
        try {
          ws.close();
        } catch {
          bookFeedState.ws = null;
        }
      }
    }, Math.min(8_000, REQUEST_TIMEOUT_MS));
    openTimeout.unref?.();

    ws.on("open", () => {
      clearTimeout(openTimeout);
      bookFeedState.status = "live";
      bookFeedState.connectedAt = new Date().toISOString();
      bookFeedState.lastSubscribeAt = bookFeedState.connectedAt;
      ws.send(JSON.stringify({
        type: "market",
        assets_ids: tokens,
        custom_feature_enabled: true,
      }));
      bookFeedState.heartbeatTimer = setInterval(() => {
        if (bookFeedState.ws !== ws || ws.readyState !== WebSocket.OPEN) return;
        try {
          ws.send("PING");
        } catch (error) {
          bookFeedState.lastError = error instanceof Error ? error.message : "book_feed_ping_failed";
        }
      }, 10_000);
      bookFeedState.heartbeatTimer.unref?.();
    });

    ws.on("message", (data) => {
      const raw = (typeof data === "string" ? data : Buffer.from(data).toString("utf8")).trim();
      if (raw === "PONG") return;
      if (raw === "PING") {
        try {
          ws.send("PONG");
        } catch {
          // Best-effort server ping response.
        }
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const message of parsed) handleBookFeedMessage(message);
          return;
        }
        handleBookFeedMessage(parsed);
      } catch (error) {
        bookFeedState.lastError = error instanceof Error ? error.message : "book_feed_parse_failed";
      }
    });

    ws.on("error", (error) => {
      bookFeedState.status = "error";
      bookFeedState.lastError = error instanceof Error ? error.message : "book_feed_socket_error";
    });

    ws.on("close", () => {
      clearTimeout(openTimeout);
      if (bookFeedState.ws === ws) {
        if (bookFeedState.heartbeatTimer) {
          clearInterval(bookFeedState.heartbeatTimer);
          bookFeedState.heartbeatTimer = null;
        }
        if (bookFeedState.status !== "timeout") bookFeedState.status = "closed";
        bookFeedState.ws = null;
      }
    });
  } catch (error) {
    bookFeedState.status = "error";
    bookFeedState.lastError = error instanceof Error ? error.message : "book_feed_start_failed";
  }
}

function handleBookFeedMessage(message) {
  const eventType = message?.event_type || message?.type || "";
  const assetId = String(message?.asset_id || "");

  if (!eventType) return;

  if (eventType === "book") {
    const tokenId = assetId || String(message.asset_id || message.token_id || "");
    if (tokenId) {
      cacheBook(tokenId, {
        asks: message.asks || [],
        bids: message.bids || [],
        hash: message.hash || "",
        timestamp: message.timestamp || Date.now(),
      }, "ws_snapshot");
    }
    bookFeedState.updates += 1;
    bookFeedState.lastMessageAt = new Date().toISOString();
    return;
  }

  if (eventType === "best_bid_ask") {
    const tokenId = assetId || String(message.asset_id || "");
    const next = applyBestBidAskHint(orderBookCache.get(tokenId), message, {
      tokenId,
      source: "ws_top_hint",
      receivedAt: Date.now(),
      eventTimestamp: message.timestamp,
    });
    if (tokenId) orderBookCache.set(tokenId, next);
    if (next?.resyncRequired) scheduleOrderBookIntegrityResync(tokenId, next.integrityReason);
    bookFeedState.updates += 1;
    bookFeedState.lastMessageAt = new Date().toISOString();
    return;
  }

  if (eventType === "tick_size_change") {
    updateCachedTickSize(assetId, message.new_tick_size || message.tick_size, "ws");
    bookFeedState.updates += 1;
    bookFeedState.lastMessageAt = new Date().toISOString();
    return;
  }

  if (eventType === "new_market") {
    bookFeedState.marketEvents += 1;
    bookFeedState.lastMessageAt = new Date().toISOString();
    if (V337_WS_ROTATE_ON_MARKET_EVENTS) {
      const normalized = normalizeMarket({
        ...message,
        active: message.active !== false,
        enableOrderBook: true,
        category: Array.isArray(message.tags) ? message.tags.join(",") : message.category,
      });
      if (normalized) {
        cryptoScannerMarketCache = {
          expiresAt: Math.max(cryptoScannerMarketCache.expiresAt || 0, Date.now() + CRYPTO_SCANNER_MARKET_CACHE_TTL_MS),
          markets: dedupeMarkets([normalized, ...(cryptoScannerMarketCache.markets || [])]),
        };
        gammaMarketCache = {
          expiresAt: Math.min(gammaMarketCache.expiresAt || 0, Date.now() + MARKET_DISCOVERY_CACHE_TTL_MS),
          markets: dedupeMarkets([normalized, ...(gammaMarketCache.markets || [])]),
        };
      }
    }
    return;
  }

  if (eventType === "market_resolved") {
    bookFeedState.marketEvents += 1;
    bookFeedState.lastMessageAt = new Date().toISOString();
    const resolvedIds = new Set([
      ...(parseArrayField(message.assets_ids).map(String)),
      ...(parseArrayField(message.clob_token_ids).map(String)),
      String(message.winning_asset_id || ""),
    ].filter(Boolean));
    const resolvedMarket = String(message.market || message.condition_id || message.id || "");
    if (resolvedIds.size || resolvedMarket) {
      for (const tokenId of resolvedIds) orderBookCache.delete(tokenId);
      const keepOpen = (market) =>
        !resolvedMarket ||
        String(market?.id || market?.conditionId || market?.condition_id || "") !== resolvedMarket;
      cryptoScannerMarketCache = {
        ...cryptoScannerMarketCache,
        markets: (cryptoScannerMarketCache.markets || []).filter(keepOpen),
      };
      gammaMarketCache = {
        ...gammaMarketCache,
        markets: (gammaMarketCache.markets || []).filter(keepOpen),
      };
    }
    return;
  }

  if (eventType !== "price_change") return;

  const rows = Array.isArray(message.price_changes) ? message.price_changes : Array.isArray(message.changes) ? message.changes : [];
  const rowsByToken = new Map();
  for (const row of rows) {
    const tokenId = String(row?.asset_id || assetId || "");
    if (!tokenId) continue;
    const list = rowsByToken.get(tokenId) || [];
    list.push(row);
    rowsByToken.set(tokenId, list);
  }
  for (const [tokenId, tokenRows] of rowsByToken) {
    const next = applyPriceChanges(orderBookCache.get(tokenId), tokenRows, {
      tokenId,
      source: "ws_delta",
      receivedAt: Date.now(),
      eventTimestamp: message.timestamp,
    });
    orderBookCache.set(tokenId, next);
    if (next.resyncRequired) scheduleOrderBookIntegrityResync(tokenId, next.integrityReason);
  }
  bookFeedState.updates += 1;
  bookFeedState.lastMessageAt = new Date().toISOString();
}

async function runLimited(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runWorker));
  return results;
}

function calculateOpportunity(market, yesBook, noBook) {
  const fill = calculateDepthFill(yesBook, noBook);
  const yesAsk = fill.yesAsk || getBestAsk(yesBook);
  const noAsk = fill.noAsk || getBestAsk(noBook);
  const bookAgeMs = Math.max(toNumber(yesBook?.ageMs, 0), toNumber(noBook?.ageMs, 0));
  const bookFetchMs = toNumber(yesBook?.fetchMs, 0) + toNumber(noBook?.fetchMs, 0);
  const bookSource = [yesBook?.source || "unknown", noBook?.source || "unknown"].join("+");

  if (!yesAsk || !noAsk) {
    return {
      rejected: true,
      reason: "missing_best_ask",
      opportunity: {
        id: `${market.id}:missing:${Date.now()}`,
        marketId: market.id,
        question: market.question,
        category: market.category,
        symbol: market.symbol || "OTHER",
        timeframe: market.timeframe || "UNK",
        marketFamily: market.marketFamily || "EVENT",
        positiveOutcome: market.positiveOutcome || "Yes",
        negativeOutcome: market.negativeOutcome || "No",
        slug: market.slug,
        yesTokenId: market.yesTokenId,
        noTokenId: market.noTokenId,
        priceToBeat: market.priceToBeat || null,
        targetSource: market.targetSource || null,
        tickSize: market.tickSize || null,
        minOrderSizeUsd: market.minOrderSize || null,
        takerFeeRate: market.takerFeeRate ?? PAPER_CRYPTO_TAKER_FEE_RATE,
        yesAsk: yesAsk?.price || 0,
        noAsk: noAsk?.price || 0,
        combinedAsk: 0,
        edgeCents: 0,
        edgePercent: 0,
        depthShares: 0,
        executableShares: 0,
        costUsd: 0,
        theoreticalProfitUsd: 0,
        slippageCents: 0,
        bookAgeMs,
        bookFetchMs,
        bookSource,
        minOrderSize: MIN_DEPTH_SHARES,
        volume: market.volume,
        liquidity: market.liquidity,
        detectedAt: new Date().toISOString(),
      },
    };
  }

  const bestCombinedAsk = fill.bestCombinedAsk || yesAsk.price + noAsk.price;
  const combinedAsk = fill.combinedAsk || bestCombinedAsk;
  const rawEdge = fill.edgeCents ?? 1 - combinedAsk;
  const depthShares = fill.depthShares || Math.min(yesAsk.size, noAsk.size);
  const minOrderSize = Math.max(
    toNumber(yesBook.min_order_size, MIN_DEPTH_SHARES),
    toNumber(noBook.min_order_size, MIN_DEPTH_SHARES),
    MIN_DEPTH_SHARES,
  );
  const edgePercent = fill.edgePercent ?? (combinedAsk > 0 ? (rawEdge / combinedAsk) * 100 : 0);

  const opportunity = {
    id: `${market.id}:${yesBook.hash || yesBook.timestamp}:${noBook.hash || noBook.timestamp}`,
    marketId: market.id,
    question: market.question,
    category: market.category,
    symbol: market.symbol || "OTHER",
    timeframe: market.timeframe || "UNK",
    marketFamily: market.marketFamily || "EVENT",
    positiveOutcome: market.positiveOutcome || "Yes",
    negativeOutcome: market.negativeOutcome || "No",
    slug: market.slug,
    yesTokenId: market.yesTokenId,
    noTokenId: market.noTokenId,
    priceToBeat: market.priceToBeat || null,
    targetSource: market.targetSource || null,
    tickSize: market.tickSize || null,
    minOrderSizeUsd: market.minOrderSize || null,
    takerFeeRate: market.takerFeeRate ?? PAPER_CRYPTO_TAKER_FEE_RATE,
    yesAsk: yesAsk.price,
    noAsk: noAsk.price,
    bestCombinedAsk,
    combinedAsk,
    edgeCents: rawEdge,
    edgePercent,
    depthShares,
    executableShares: fill.executableShares || 0,
    costUsd: fill.costUsd || 0,
    theoreticalProfitUsd: fill.theoreticalProfitUsd || 0,
    yesAvgPrice: fill.yesAvgPrice || 0,
    noAvgPrice: fill.noAvgPrice || 0,
    yesWorstPrice: fill.yesWorstPrice || 0,
    noWorstPrice: fill.noWorstPrice || 0,
    slippageCents: fill.slippageCents || 0,
    levelsUsed: fill.levelsUsed || 0,
    bookAgeMs,
    bookFetchMs,
    bookSource,
    minOrderSize,
    volume: market.volume,
    liquidity: market.liquidity,
    detectedAt: new Date().toISOString(),
  };

  if (!fill.fillable) {
    return {
      rejected: true,
      reason: fill.reason || "not_fillable",
      opportunity,
    };
  }

  if (rawEdge < MIN_EDGE_CENTS) {
    return {
      rejected: true,
      reason: "edge_below_threshold",
      opportunity,
    };
  }

  if (fill.executableShares < minOrderSize) {
    return {
      rejected: true,
      reason: "insufficient_depth",
      opportunity,
    };
  }

  if (fill.theoreticalProfitUsd < MIN_PAPER_PROFIT_USD) {
    return {
      rejected: true,
      reason: "profit_below_threshold",
      opportunity,
    };
  }

  return opportunity;
}

function simulateTrade(opportunity) {
  const now = Date.now();
  const cooldownKey = opportunity.marketId;
  const previous = seenTrades.get(cooldownKey) || 0;

  if (now - previous < TRADE_COOLDOWN_MS) {
    return {
      rejected: true,
      reason: "cooldown",
      opportunity,
    };
  }

  seenTrades.set(cooldownKey, now);

  const shares = toNumber(opportunity.executableShares, 0);
  const grossCost = toNumber(opportunity.costUsd, 0) || shares * opportunity.combinedAsk;
  const grossPayout = shares;
  const latencyPenalty = grossCost * (SIMULATED_LATENCY_MS / 1_000) * 0.00045;
  const depthPenalty = opportunity.depthShares < 25 ? grossCost * 0.0015 : 0;
  const realizedProfit = grossPayout - grossCost - latencyPenalty - depthPenalty;
  const win = realizedProfit > 0;

  return {
    id: `${opportunity.id}:${now}`,
    time: new Date(now).toISOString(),
    question: opportunity.question,
    slug: opportunity.slug,
    yesAsk: opportunity.yesAsk,
    noAsk: opportunity.noAsk,
    combinedAsk: opportunity.combinedAsk,
    bestCombinedAsk: opportunity.bestCombinedAsk,
    shares,
    costUsd: grossCost,
    theoreticalProfitUsd: grossPayout - grossCost,
    realizedProfitUsd: realizedProfit,
    edgePercent: opportunity.edgePercent,
    depthShares: opportunity.depthShares,
    executableShares: opportunity.executableShares,
    slippageCents: opportunity.slippageCents,
    levelsUsed: opportunity.levelsUsed,
    bookSource: opportunity.bookSource,
    bookAgeMs: opportunity.bookAgeMs,
    bookFetchMs: opportunity.bookFetchMs,
    latencyMs: SIMULATED_LATENCY_MS,
    status: win ? "win" : "loss",
  };
}


function getPaperSideBid(signal = {}, prediction = {}) {
  const signalSide = String(signal.direction || signal.side || "").toUpperCase();
  if (signal.slug && prediction?.slug && signal.slug !== prediction.slug) return 0;
  if (signalSide === "UP") return toNumber(prediction.upBidPrice, 0);
  if (signalSide === "DOWN") return toNumber(prediction.downBidPrice, 0);
  return 0;
}

function calculateLifetimePaperMetrics(openExposure = 0, unrealizedPnl = 0) {
  try {
    const settlementsDir = path.join(DATA_DIR, "settlements");
    if (!fs.existsSync(settlementsDir)) {
      return { lifetimeRealizedPnl: 0, lifetimePaperEquity: PAPER_START_BALANCE + unrealizedPnl, lifetimeCashBalance: Math.max(0, PAPER_START_BALANCE - openExposure), lifetimeWinRate: 0, lifetimeSettledTrades: 0, wins: 0, losses: 0 };
    }
    const files = fs.readdirSync(settlementsDir).filter(f => f.endsWith(".jsonl"));
    const uniqueSettlements = new Map();
    for (const file of files) {
      const filePath = path.join(settlementsDir, file);
      try {
        const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
        for (const line of lines) {
          if (!line) continue;
          try {
            const s = JSON.parse(line);
            if (s.id) uniqueSettlements.set(s.id, s);
          } catch { /* ignore parse errors */ }
        }
      } catch { /* ignore file read errors */ }
    }
    const allSettled = Array.from(uniqueSettlements.values());
    const resetTime = paperSessionState?.resetAt ? Date.parse(paperSessionState.resetAt) : 0;
    const settledList = allSettled.filter(s => {
      if (!isPrimaryPaperSignal(s) || !shouldTrainFromSettlement(s)) return false;
      const t = Date.parse(s.settledAt || s.time || s.windowEnd) || 0;
      return t >= resetTime;
    });
    const lifetimeRealizedPnl = settledList.reduce((sum, s) => sum + toNumber(s.paperPnlUsd, 0), 0);
    const lifetimePaperEquity = PAPER_START_BALANCE + lifetimeRealizedPnl + unrealizedPnl;
    const lifetimeCashBalance = Math.max(0, PAPER_START_BALANCE + lifetimeRealizedPnl - openExposure);
    const wins = settledList.filter(s => s.status === "paper_win").length;
    const total = settledList.length;
    const losses = total - wins;
    const lifetimeWinRate = total > 0 ? (wins / total) * 100 : 0;
    return { lifetimeRealizedPnl, lifetimePaperEquity, lifetimeCashBalance, lifetimeWinRate, lifetimeSettledTrades: total, wins, losses };
  } catch {
    return { lifetimeRealizedPnl: 0, lifetimePaperEquity: PAPER_START_BALANCE + unrealizedPnl, lifetimeCashBalance: Math.max(0, PAPER_START_BALANCE - openExposure), lifetimeWinRate: 0, lifetimeSettledTrades: 0, wins: 0, losses: 0 };
  }
}

function buildPaperAccountMetrics(prediction = {}) {
  const resetTime = paperSessionState?.resetAt ? Date.parse(paperSessionState.resetAt) : 0;
  const allSignals = uniqueOfficialFinalSignals(Array.isArray(prediction?.signals) ? prediction.signals : []);
  const signals = allSignals.filter(s => {
    if (!isPrimaryPaperSignal(s)) return false;
    const t = Date.parse(s.time || s.windowEnd) || 0;
    return t >= resetTime;
  });
  const open = signals.filter((signal) => signal.status === "paper_open");
  const openStakeExposure = open.reduce((total, signal) => total + toNumber(signal.filledStakeUsd ?? signal.paperStakeUsd, 0), 0);
  const openFeeReserve = open.reduce((total, signal) => total + toNumber(signal.takerFeeUsd, 0), 0);
  const openExposure = openStakeExposure + (PAPER_RESERVE_ENTRY_FEES ? openFeeReserve : 0);
  const unrealizedPnl = open.reduce((total, signal) => {
    const bid = getPaperSideBid(signal, prediction);
    if (bid <= 0) return total;
    const markValue = toNumber(signal.paperShares, 0) * bid;
    return total + (markValue - toNumber(signal.paperStakeUsd, 0) - toNumber(signal.takerFeeUsd, 0));
  }, 0);
  const lifetime = calculateLifetimePaperMetrics(openExposure, unrealizedPnl);
  const realizedPnl = lifetime.lifetimeRealizedPnl;
  const cashBalance = lifetime.lifetimeCashBalance;
  const paperEquity = lifetime.lifetimePaperEquity;
  return {
    cashBalance,
    paperBalance: cashBalance,
    paperEquity,
    realizedPnl,
    unrealizedPnl,
    openExposure,
    openStakeExposure,
    openFeeReserve,
    openPositions: open.length,
    settledPositions: lifetime.lifetimeSettledTrades,
  };
}

function summarize(nextState, scanResult, prediction = nextState.prediction, reference = nextState.reference) {
  const previousTrades = nextState.trades || [];
  const trades = [...scanResult.newTrades, ...previousTrades].slice(0, 80);
  const previousRejects = nextState.rejects || [];
  const rejects = [...scanResult.rejects, ...previousRejects].slice(0, 80);
  const realizedPnl = trades.reduce((total, trade) => total + trade.realizedProfitUsd, 0);
  const paperAccount = buildPaperAccountMetrics(prediction || {});
  const lifetime = calculateLifetimePaperMetrics(paperAccount.openExposure, paperAccount.unrealizedPnl);
  const paperWins = lifetime.wins;
  const paperLosses = lifetime.losses;
  const paperWinRate = lifetime.lifetimeWinRate;
  const settledPaperSignalsCount = lifetime.lifetimeSettledTrades;
  const acceptedTrades = trades.length;
  const wins = trades.filter((trade) => trade.status === "win").length;
  const arbitrageWinRate = acceptedTrades > 0 ? (wins / acceptedTrades) * 100 : 0;
  const bestTrade = trades.reduce(
    (best, trade) => (trade.realizedProfitUsd > (best?.realizedProfitUsd ?? Number.NEGATIVE_INFINITY) ? trade : best),
    null,
  );
  const avgEdge =
    acceptedTrades > 0 ? trades.reduce((total, trade) => total + trade.edgePercent, 0) / acceptedTrades : 0;
  const avgProfit =
    acceptedTrades > 0 ? trades.reduce((total, trade) => total + trade.realizedProfitUsd, 0) / acceptedTrades : 0;

  const bestOpportunity = scanResult.opportunities.reduce(
    (best, opportunity) => (opportunity.edgePercent > (best?.edgePercent ?? Number.NEGATIVE_INFINITY) ? opportunity : best),
    null,
  );
  const previousHistory = nextState.history || [];
  const currentEdges = scanResult.evaluatedMarkets
    .map((market) => market.edgePercent)
    .filter((value) => Number.isFinite(value));
  const bestSeenEdge = currentEdges.length ? Math.max(...currentEdges) : 0;
  const avgSeenEdge = currentEdges.length
    ? currentEdges.reduce((total, value) => total + value, 0) / currentEdges.length
    : 0;
  const currentRejectSummary = aggregateBy(scanResult.rejects, (reject) => reject.reason).map((item) => ({
    reason: item.key,
    count: item.count,
    percent: scanResult.rejects.length ? (item.count / scanResult.rejects.length) * 100 : 0,
  }));
  const categorySummary = [...scanResult.evaluatedMarkets.reduce((map, market) => {
    const key = market.category || "Market";
    const current = map.get(key) || {
      category: key,
      markets: 0,
      books: 0,
      opportunities: 0,
      bestEdgePercent: Number.NEGATIVE_INFINITY,
      avgEdgePercent: 0,
      totalEdgePercent: 0,
    };
    current.markets += 1;
    current.books += market.yesAsk > 0 || market.noAsk > 0 ? 2 : 0;
    current.opportunities += market.status === "opportunity" ? 1 : 0;
    current.bestEdgePercent = Math.max(current.bestEdgePercent, market.edgePercent || 0);
    current.totalEdgePercent += market.edgePercent || 0;
    current.avgEdgePercent = current.totalEdgePercent / current.markets;
    map.set(key, current);
    return map;
  }, new Map()).values()]
    .map((item) => ({
      ...item,
      bestEdgePercent: item.bestEdgePercent === Number.NEGATIVE_INFINITY ? 0 : item.bestEdgePercent,
    }))
    .sort((left, right) => right.markets - left.markets)
    .slice(0, 8);
  const historyPoint = {
    time: new Date().toISOString(),
    scannedMarkets: scanResult.scannedMarkets,
    scannedBooks: scanResult.scannedBooks,
    opportunities: scanResult.opportunities.length,
    newTrades: scanResult.newTrades.length,
    rejects: scanResult.rejects.length,
    bestEdgePercent: bestSeenEdge,
    avgEdgePercent: avgSeenEdge,
  };
  const telemetry = scanResult.telemetry || {};
  const totalBookReads = toNumber(telemetry.cacheHits, 0) + toNumber(telemetry.restFetches, 0);
  const avgBookAgeMs = average(telemetry.bookAgeSamples);
  const avgBookFetchMs = average(telemetry.bookFetchSamples);
  pushLatencySample("scanLatencyMs", toNumber(telemetry.scanLatencyMs, 0));
  maybeLogLatencyDiagnostics({ scanLatencyMs: toNumber(telemetry.scanLatencyMs, 0), avgBookAgeMs, avgBookFetchMs });
  const avgSlippageCents = average(telemetry.slippageSamples) * 100;
  const cacheHitRate = totalBookReads > 0 ? (toNumber(telemetry.cacheHits, 0) / totalBookReads) * 100 : 0;
  const bookFeedStatus =
    bookFeedState.status === "live"
      ? "live"
      : toNumber(telemetry.restFetches, 0) > 0
        ? "rest_fallback"
        : bookFeedState.status;
  const rankedMarkets = rankOpportunities(scanResult.evaluatedMarkets);
  const cryptoCandidates = rankedMarkets.filter((market) => market.cryptoCandidate);
  const strategies = cryptoCandidates.reduce((map, market) => {
    const key = market.strategy || "watch_only";
    map[key] = (map[key] || 0) + 1;
    return map;
  }, {});
  const calibration = buildCalibrationReport(prediction?.signals || []);
  auditLogger.report("calibration-latest.json", calibration);
  const activeStats = prediction?.stats?.activeStats || prediction?.stats || {};
  const accountRisk = accountRiskFromSignals(
    prediction?.signals || [],
    getBankrollFromStats(prediction?.stats || activeStats),
    PAPER_START_BALANCE,
    { activeWindowKey: prediction?.slug || "" },
  );
  const risk = createEmptyRisk({
    ...accountRisk,
    activePositions: (prediction?.signals || []).filter((signal) => {
      const resetTime = paperSessionState?.resetAt ? Date.parse(paperSessionState.resetAt) : 0;
      const t = Date.parse(signal.time || 0);
      return signal.status === "paper_open" && t >= resetTime && isPrimaryPaperSignal(signal);
    }).length,
    approved: Boolean(prediction?.riskApproved),
    reason: prediction?.riskReason || prediction?.reason || "waiting",
    profile: prediction?.riskProfile || RISK_PROFILE,
    aggressiveLearningMode: Boolean(prediction?.aggressiveLearningMode || AGGRESSIVE_LEARNING_MODE),
    recommendedStakeUsd: prediction?.recommendedStakeUsd || 0,
    progressiveStage: prediction?.progressiveStage || "waiting",
    progressiveStageReason: prediction?.progressiveStageReason || "waiting",
    progressiveStakeMultiplier: prediction?.progressiveStakeMultiplier || 0,
    runtimeSettled: prediction?.runtimeSettled || 0,
    runtimeWinRate: prediction?.runtimeWinRate || 0,
    runtimeRoi: prediction?.runtimeRoi || 0,
    updatedAt: new Date().toISOString(),
  });
  const signalForAgents = prediction
    ? {
        rank: prediction.rank,
        side: prediction.predictedOutcome,
        probability: prediction.selectedProbability,
        entryPrice: prediction.selectedBuyPrice,
        edge: prediction.feeAdjustedEdge,
        feeAdjustedEdge: prediction.feeAdjustedEdge,
        selectedSpreadCents: prediction.selectedSpreadCents,
        spreadCents: prediction.selectedSpreadCents,
        bookAgeMs: prediction.bookAgeMs,
        yesNoAskCost: prediction.yesNoAskCost,
        selectedBookImbalance: prediction.selectedBookImbalance,
        reason: prediction.reason,
        reasons: [prediction.reason, prediction.riskReason].filter(Boolean),
      }
    : null;
  const agents = AI_AGENT_ENABLED
    ? runAdvisorAgents({ markets: rankedMarkets, signal: signalForAgents, reference, calibration })
    : createEmptyAgents({ enabled: false, mode: "disabled" });
  const strategyRouterState = createEmptyStrategyRouter(prediction?.strategyRouter || {});
  const gateProtocolState = createEmptyGateProtocol(prediction?.gateProtocol || {});
  const runtimeLearningReport = buildStrategyPerformanceReport(prediction?.signals || []);
  const learning = createEmptyLearning({
    ...selectLearningPerformanceReport(runtimeLearningReport, IMPORTED_LEARNING_BRAIN, {
      enabled: LEARNING_BRAIN_ENABLED,
      mode: LEARNING_BRAIN_MODE,
      minRuntimeSettled: LEARNING_BRAIN_MIN_RUNTIME_SETTLED,
    }),
    runtime: runtimeLearningReport,
    adaptive: prediction?.adaptiveLearning || createEmptyAdaptiveLearningState({
      enabled: ADAPTIVE_LEARNING_ENABLED,
      mode: ADAPTIVE_LEARNING_ENABLED ? ADAPTIVE_MODE : "disabled",
    }),
    replayOptimizer: REPLAY_OPTIMIZER_STATE,
    importedBrain: IMPORTED_LEARNING_BRAIN?.enabled ? {
      status: IMPORTED_LEARNING_BRAIN.status,
      importedSamples: IMPORTED_LEARNING_BRAIN.importedSamples,
      settled: IMPORTED_LEARNING_BRAIN.settled,
      allowedStrategies: IMPORTED_LEARNING_BRAIN.allowedStrategies,
      blockedStrategies: IMPORTED_LEARNING_BRAIN.blockedStrategies,
      adaptiveThresholds: IMPORTED_LEARNING_BRAIN.adaptiveThresholds,
    } : null,
  });
  auditLogger.report("strategy-performance-latest.json", learning);
  const lastGoodSnapshot = saveLastGoodModelSnapshot({
    prediction,
    reason: "summarize_runtime_positive_snapshot",
  });
  auditLogger.decision({
    time: new Date().toISOString(),
    prediction: signalForAgents,
    risk,
    agents: agents.decision,
    strategyRouter: strategyRouterState.summary,
    gateProtocol: gateProtocolState.gateSummary,
    adaptive: learning.adaptive?.summary || null,
  });

  return {
    ...nextState,
    mode: "paper",
    status: "live",
    blocked: false,
    source: {
      ...nextState.source,
      gamma: scanResult.gammaFallback ? "learning_fallback" : "live",
      clob: scanResult.scannedBooks > 0 ? "live" : "partial",
      btc: prediction?.status === "live" ? "live" : prediction?.status || "partial",
      reference: reference?.status || "partial",
      lastError: "",
      lastScanAt: new Date().toISOString(),
      nextScanAt: new Date(Date.now() + SCAN_INTERVAL_MS).toISOString(),
    },
    metrics: (() => {
      const lifetime = calculateLifetimePaperMetrics(paperAccount.openExposure, paperAccount.unrealizedPnl);
      return {
      balance: paperAccount.paperEquity,
      cashBalance: paperAccount.cashBalance,
      paperBalance: paperAccount.paperBalance,
      paperEquity: paperAccount.paperEquity,
      openExposure: paperAccount.openExposure,
      openStakeExposure: paperAccount.openStakeExposure,
      openFeeReserve: paperAccount.openFeeReserve,
      unrealizedPnl: paperAccount.unrealizedPnl,
      realizedPnl: paperAccount.realizedPnl,
      arbitrageRealizedPnl: realizedPnl,
      pnlPercent: (paperAccount.paperEquity - PAPER_START_BALANCE) / PAPER_START_BALANCE * 100,
      lifetimeRealizedPnl: lifetime.lifetimeRealizedPnl,
      lifetimePaperEquity: lifetime.lifetimePaperEquity,
      lifetimeCashBalance: lifetime.lifetimeCashBalance,
      lifetimeWinRate: lifetime.lifetimeWinRate,
      lifetimeSettledTrades: lifetime.lifetimeSettledTrades,
      scannedMarkets: scanResult.scannedMarkets,
      scannedBooks: scanResult.scannedBooks,
        opportunities: scanResult.opportunities.length,
        acceptedTrades,
        rejectedSignals: rejects.length,
        winRate: settledPaperSignalsCount ? paperWinRate : arbitrageWinRate,
        paperWinRate,
        paperWins,
        paperLosses,
        settledPaperTrades: settledPaperSignalsCount,
        arbitrageWinRate,
        avgEdgePercent: avgEdge,
      avgProfitUsd: avgProfit,
      bestProfitUsd: bestTrade?.realizedProfitUsd || 0,
      bestEdgePercent: bestOpportunity?.edgePercent || 0,
      fillRate:
        acceptedTrades + rejects.length > 0 ? (acceptedTrades / (acceptedTrades + rejects.length)) * 100 : 0,
      avgBookAgeMs,
      avgBookFetchMs,
      cacheHitRate,
    };
    })(),
    execution: createEmptyExecution({
      bookFeedStatus,
      bookFeedTokens: bookFeedState.tokens.length,
      bookFeedUpdates: bookFeedState.updates,
      bookFeedMarketEvents: bookFeedState.marketEvents,
      bookFeedStaleReconnects: bookFeedState.staleReconnects,
      bookFeedLastMessageAt: bookFeedState.lastMessageAt,
      cacheHits: toNumber(telemetry.cacheHits, 0),
      restFetches: toNumber(telemetry.restFetches, 0),
      wsSnapshots: toNumber(telemetry.wsSnapshots, 0),
      staleBooks: toNumber(telemetry.staleBooks, 0),
      avgBookAgeMs,
      avgBookFetchMs,
      entryBookAgeMs: avgLatencySample("entryBookAgeMs"),
      entryRefreshes: latencyState.entryRefreshes,
      staleEntryDrops: latencyState.staleEntryDrops,
      httpConnectMs: avgLatencySample("httpConnectMs"),
      httpTlsMs: avgLatencySample("httpTlsMs"),
      httpTotalMs: avgLatencySample("httpTotalMs"),
      eventLoopDelayMs: avgLatencySample("eventLoopDelayMs"),
      eventLoopDelayP95Ms: percentileLatencySample("eventLoopDelayMs", 0.95),
      orderbookQueueWaitMs: avgLatencySample("orderbookQueueWaitMs"),
      scanSkippedTicks: latencyState.scanSkippedTicks,
      scanCatchupRuns: latencyState.scanCatchupRuns,
      scanLatencyMs: toNumber(telemetry.scanLatencyMs, 0),
      scanLatencyP95Ms: percentileLatencySample("scanLatencyMs", 0.95),
      paperCandidates: toNumber(telemetry.paperCandidates, 0),
      paperFills: toNumber(telemetry.paperFills, 0),
      paperRejects: toNumber(telemetry.paperRejects, 0),
      avgSlippageCents,
      externalPriceFeed: buildExternalPriceFeedTelemetry(),
      lastBookSource: scanResult.evaluatedMarkets[0]?.bookSource || "pending",
      lastError: bookFeedState.lastError,
      updatedAt: new Date().toISOString(),
    }),
    bestOpportunity,
    opportunities: scanResult.opportunities.slice(0, 25),
    trades,
    rejects,
    marketRows: rankedMarkets
      .sort((left, right) => {
        const leftComplete = left.combinedAsk > 0 ? 1 : 0;
        const rightComplete = right.combinedAsk > 0 ? 1 : 0;
        if (rightComplete !== leftComplete) return rightComplete - leftComplete;
        return (right.opportunityScore || 0) - (left.opportunityScore || 0);
      })
      .slice(0, 80),
    rejectionSummary: currentRejectSummary,
    categorySummary,
    scanner: createEmptyScanner({
      watchedMarkets: rankedMarkets.length,
      cryptoCandidates: cryptoCandidates.length,
      subscribedMarkets: Math.min(ORDERBOOK_WS_MAX_TOKENS / 2, cryptoCandidates.length),
      tradeCandidates: cryptoCandidates.filter((market) => market.status === "opportunity").length,
      topCandidates: cryptoCandidates.slice(0, CRYPTO_SCANNER_MAX_TRADE_CANDIDATES),
      strategies,
      updatedAt: new Date().toISOString(),
    }),
    agents,
    risk,
    strategyRouter: strategyRouterState,
    gateProtocol: gateProtocolState,
    learning: {
      ...learning,
      lastGoodSnapshot,
      resetProofMemory: prediction?.resetProofMemory || null,
    },
    adaptiveLearning: learning.adaptive,
    weather: buildWeatherStrategyStatus(),
    exitEngine: buildExitEngineStatus(),
    calibration,
    history: [historyPoint, ...previousHistory].slice(0, 80),
    prediction,
    reference,
    updatedAt: new Date().toISOString(),
  };
}

function summarizeError(error) {
  const blocked = error?.code === "CAPTIVE_PORTAL" || String(error?.sample || "").includes("Internet Baik");
  const tlsError = error?.code === "CERT_HAS_EXPIRED" || error?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
  const networkError = error?.code === "FETCH_FAILED" || error?.message === "fetch failed";
  return {
    ...state,
    status: blocked ? "blocked" : tlsError ? "tls_error" : networkError ? "network_error" : "error",
    blocked,
    source: {
      ...state.source,
      gamma: blocked ? "blocked" : tlsError ? "tls_error" : networkError ? "network_error" : "error",
      clob: blocked ? "blocked" : state.source.clob,
      btc: state.prediction?.status || state.source.btc,
      reference: state.reference?.status || state.source.reference,
      lastError: blocked
        ? "Local network returned Telkomsel Internet Baik HTML instead of Polymarket JSON."
        : tlsError
          ? "TLS certificate validation failed. Fix Windows certificate store or run with POLYMARKET_INSECURE_TLS=1 for local testing."
          : networkError
            ? "Polymarket API is not reachable from this local network."
        : error instanceof Error
          ? error.message
          : "Unknown scan error",
      lastScanAt: new Date().toISOString(),
      nextScanAt: new Date(Date.now() + SCAN_INTERVAL_MS).toISOString(),
    },
    execution: createEmptyExecution({
      ...state.execution,
      bookFeedStatus: bookFeedState.status,
      bookFeedTokens: bookFeedState.tokens.length,
      bookFeedUpdates: bookFeedState.updates,
      externalPriceFeed: buildExternalPriceFeedTelemetry(),
      lastError: bookFeedState.lastError || (error instanceof Error ? error.message : "scan_error"),
      updatedAt: new Date().toISOString(),
    }),
    updatedAt: new Date().toISOString(),
  };
}

function serveStaticUi(url, response) {
  try {
    const pathname = decodeURIComponent(url.pathname || "/");
    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    let filePath = path.resolve(DIST_DIR, requested);
    const relative = path.relative(DIST_DIR, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      sendNotFound(response);
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(DIST_DIR, "index.html");
    }
    if (!fs.existsSync(filePath)) {
      sendJson(response, 404, {
        error: "frontend_dist_not_found",
        detail: "Run npm run build, or use RUN_BUILD_AND_PM2.bat.",
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "content-type": STATIC_CONTENT_TYPES[ext] || "application/octet-stream",
      "access-control-allow-origin": "*",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
    });
    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    sendJson(response, 500, { error: "static_serve_failed", detail: error instanceof Error ? error.message : "unknown" });
  }
}

function hasHotMarketFastLaneSignal(snapshot = state) {
  if (!HOT_MARKET_FAST_LANE_ENABLED) return false;
  const prediction = snapshot?.prediction || {};
  const predictionScore = Math.max(
    toNumber(prediction.confidence, 0),
    toNumber(prediction.qualityScore, 0),
    toNumber(prediction.executionQualityScore, 0),
    toNumber(prediction.v337PriorityScore, 0),
  );
  if (prediction.tradeable && predictionScore >= HOT_MARKET_MIN_EDGE_SCORE && toNumber(prediction.bookAgeMs, 9999) <= HOT_MARKET_MAX_BOOK_AGE_MS) return true;

  const rows = [
    ...(snapshot?.scanner?.topCandidates || []),
    ...(snapshot?.marketRows || []),
    ...(snapshot?.opportunities || []),
  ];
  return rows.some((row) => {
    const score = Math.max(
      toNumber(row.opportunityScore, 0),
      toNumber(row.scannerScore, 0),
      toNumber(row.edgePercent, 0) * 8,
      toNumber(row.scannerEdgePercent, 0) * 8,
    );
    const bookAge = toNumber(row.bookAgeMs, 0);
    const hotFamily = String(row.marketFamily || "").toUpperCase() === "DIRECTIONAL" || row.cryptoCandidate || row.status === "opportunity";
    return hotFamily && score >= HOT_MARKET_MIN_EDGE_SCORE && (!bookAge || bookAge <= HOT_MARKET_MAX_BOOK_AGE_MS);
  });
}

function hotMarketFastLaneIntervalMs(snapshot = state) {
  const prediction = snapshot?.prediction || {};
  const score = Math.max(
    toNumber(prediction.confidence, 0),
    toNumber(prediction.qualityScore, 0),
    toNumber(prediction.executionQualityScore, 0),
    toNumber(prediction.v337PriorityScore, 0),
  );
  if (score >= HOT_MARKET_MIN_EDGE_SCORE + 20 && toNumber(prediction.bookAgeMs, 9999) <= ENTRY_REFRESH_BOOK_IF_OLDER_MS) {
    return Math.max(50, ULTRA_HOT_MARKET_SCAN_INTERVAL_MS);
  }
  return Math.max(75, HOT_MARKET_SCAN_INTERVAL_MS);
}

async function scan({ catchup = false } = {}) {
  if (SCAN_NO_OVERLAP && scanRunning) {
    scanSkippedWhileRunning = true;
    latencyState.scanSkippedTicks += 1;
    return;
  }
  scanRunning = true;
  if (catchup) latencyState.scanCatchupRuns += 1;
  const scanStartedAt = Date.now();

  // --- V362.2: Selesaikan sinyal di awal tick scan secara mandiri ---
  // Ini mencegah state reversion akibat error network setelahnya
  // sehingga menghilangkan duplikasi log settlement
  try {
    const currentPrediction = state.prediction || createEmptyPrediction();
    const preSettledSignals = await settlePredictionSignals(currentPrediction.signals || [], scanStartedAt);
    if (preSettledSignals !== currentPrediction.signals) {
      state.prediction = {
        ...currentPrediction,
        signals: preSettledSignals,
        stats: summarizePredictionStats(preSettledSignals),
      };
      savePersistedPrediction(state.prediction);
    }
  } catch (_settleErr) {
    // Kegagalan settlement awal tidak boleh menghentikan loop trading utama
  }
  // --- End V362.2 settlement guard ---

  let referencePromise = Promise.resolve(state.reference);
  let predictionPromise = Promise.resolve(state.prediction);

  try {
    referencePromise = scanReferenceWallet(state.reference).catch((error) =>
      createReferenceScanError(state.reference, error, state.prediction),
    );
    let gammaFallbackError = null;
    let markets = [];
    try {
      markets = await fetchMarkets();
    } catch (error) {
      if (!BTC_LEARNING_FALLBACK_MODE) throw error;
      gammaFallbackError = error;
      markets = [];
    }
    syncBookFeed(markets.flatMap((market) => [market.yesTokenId, market.noTokenId]));
    const bookResults = await runLimited(markets, Math.max(1, ORDERBOOK_SCAN_CONCURRENCY), async (market) => {
      const [yesSnapshot, noSnapshot] = await Promise.all([
        fetchBookSnapshot(market.yesTokenId),
        fetchBookSnapshot(market.noTokenId),
      ]);
      return { market, yesSnapshot, noSnapshot };
    });

    const scanResult = {
      scannedMarkets: markets.length,
      scannedBooks: 0,
      opportunities: [],
      newTrades: [],
      rejects: [],
      evaluatedMarkets: [],
      gammaFallback: Boolean(gammaFallbackError),
      gammaFallbackError: gammaFallbackError instanceof Error ? gammaFallbackError.message : "",
      telemetry: {
        cacheHits: 0,
        restFetches: 0,
        wsSnapshots: 0,
        staleBooks: 0,
        bookAgeSamples: [],
        bookFetchSamples: [],
        paperCandidates: 0,
        paperFills: 0,
        paperRejects: 0,
        slippageSamples: [],
        scanLatencyMs: 0,
      },
    };

    for (const result of bookResults) {
      if (result.status !== "fulfilled") {
        scanResult.telemetry.paperRejects += 1;
        scanResult.rejects.push({
          time: new Date().toISOString(),
          reason: result.reason instanceof Error ? result.reason.message : "book_fetch_failed",
        });
        continue;
      }

      scanResult.scannedBooks += 2;
      const yesBook = {
        ...result.value.yesSnapshot.book,
        source: result.value.yesSnapshot.source,
        ageMs: result.value.yesSnapshot.ageMs,
        fetchMs: result.value.yesSnapshot.fetchMs,
      };
      const noBook = {
        ...result.value.noSnapshot.book,
        source: result.value.noSnapshot.source,
        ageMs: result.value.noSnapshot.ageMs,
        fetchMs: result.value.noSnapshot.fetchMs,
      };
      const snapshots = [result.value.yesSnapshot, result.value.noSnapshot];
      for (const snapshot of snapshots) {
        if (snapshot.cacheHit) scanResult.telemetry.cacheHits += 1;
        if (snapshot.source === "rest") scanResult.telemetry.restFetches += 1;
        if (snapshot.source === "ws") scanResult.telemetry.wsSnapshots += 1;
        if (snapshot.ageMs > ORDERBOOK_CACHE_TTL_MS) scanResult.telemetry.staleBooks += 1;
        scanResult.telemetry.bookAgeSamples.push(snapshot.ageMs);
        scanResult.telemetry.bookFetchSamples.push(snapshot.fetchMs);
      }

      const opportunity = calculateOpportunity(result.value.market, yesBook, noBook);
      const marketRow = {
        ...(opportunity.opportunity || opportunity),
        status: opportunity.rejected ? "rejected" : "opportunity",
        reason: opportunity.rejected ? opportunity.reason : "edge_passed",
      };
      scanResult.evaluatedMarkets.push(marketRow);
      scanResult.telemetry.paperCandidates += 1;
      scanResult.telemetry.slippageSamples.push(marketRow.slippageCents || 0);

      if (opportunity.rejected) {
        scanResult.telemetry.paperRejects += 1;
        scanResult.rejects.push({
          time: new Date().toISOString(),
          reason: opportunity.reason,
          question: opportunity.opportunity?.question || "",
          symbol: opportunity.opportunity?.symbol || "OTHER",
          timeframe: opportunity.opportunity?.timeframe || "UNK",
          marketFamily: opportunity.opportunity?.marketFamily || "EVENT",
          edgePercent: opportunity.opportunity?.edgePercent || 0,
          yesAsk: opportunity.opportunity?.yesAsk || 0,
          noAsk: opportunity.opportunity?.noAsk || 0,
          depthShares: opportunity.opportunity?.depthShares || 0,
          executableShares: opportunity.opportunity?.executableShares || 0,
          bookSource: opportunity.opportunity?.bookSource || "",
          bookAgeMs: opportunity.opportunity?.bookAgeMs || 0,
        });
        continue;
      }

      scanResult.opportunities.push(opportunity);
      const simulated = simulateTrade(opportunity);
      if (simulated.rejected) {
        scanResult.telemetry.paperRejects += 1;
        scanResult.rejects.push({
          time: new Date().toISOString(),
          reason: simulated.reason,
          question: simulated.opportunity.question,
          edgePercent: simulated.opportunity.edgePercent,
          executableShares: simulated.opportunity.executableShares,
        });
      } else {
        scanResult.telemetry.paperFills += 1;
        scanResult.newTrades.push(simulated);
      }
    }

    const selectedPredictionMarkets = await selectBestDirectionalPredictionMarkets(scanResult, state.prediction, Date.now());
    predictionPromise = selectedPredictionMarkets.length
      ? scanDirectionalPredictionBatch(state.prediction, selectedPredictionMarkets)
      : Promise.resolve({
          ...state.prediction,
          status: "waiting",
          reason: "no_eligible_fastgrow_market_this_tick",
          updatedAt: new Date().toISOString(),
        });
    const prediction = await predictionPromise;
    const reference = attachReferenceAgreement(await referencePromise, prediction);
    scanResult.telemetry.scanLatencyMs = Date.now() - scanStartedAt;
    state = summarize(state, scanResult, prediction, reference);
  } catch (error) {
    const errorState = summarizeError(error);
    const prediction = await predictionPromise.catch(() => state.prediction);
    const reference = attachReferenceAgreement(await referencePromise.catch((referenceError) =>
      createReferenceScanError(state.reference, referenceError, prediction),
    ), prediction);
    state = {
      ...errorState,
      prediction,
      reference,
      source: {
        ...errorState.source,
        btc: prediction?.status || errorState.source.btc,
        reference: reference?.status || errorState.source.reference,
      },
    };
  } finally {
    scanRunning = false;
    lastCompletedScanAt = Date.now();
    const shouldCatchup =
      SCAN_CATCHUP_AFTER_LONG_TICK &&
      SCAN_SKIPPED_TICK_CATCHUP &&
      scanSkippedWhileRunning &&
      !scanCatchupScheduled;
    scanSkippedWhileRunning = false;
    if (shouldCatchup) {
      scanCatchupScheduled = true;
      setImmediate(() => {
        scanCatchupScheduled = false;
        scan({ catchup: true }).catch(() => {});
      });
    }
    broadcast();
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    response.end();
    return;
  }

  if (url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      status: state.status,
      updatedAt: state.updatedAt,
      releaseVersion: V356_RELEASE_VERSION,
      botRole: BOT_ROLE,
      botInstanceId: BOT_INSTANCE_ID,
      configHash: V3745_CONFIG_HASH,
      externalPriceFeed: buildExternalPriceFeedTelemetry(),
      observerPolicy: observerPolicyReader.status(),
      settlementObserver: settlementObserverLearner?.status() || { status: "disabled_for_main" },
      directionShadowObserver: directionShadowObserver?.status() || { status: "disabled_for_main" },
      paperState: {
        path: BTC_PAPER_STATE_PATH,
        persistenceEnabled: PAPER_STATE_PERSISTENCE_ENABLED,
        observerTradingStatePersistenceForbidden: BOT_ROLE === "checkpoint_observer",
        heartbeatMs: PAPER_STATE_HEARTBEAT_MS,
      },
    });
    return;
  }

  if (url.pathname === "/api/state") {
    sendJson(response, 200, projectRealtimeStateSnapshot());
    return;
  }
  if (url.pathname === "/api/v3/state") {
    sendJson(response, 200, projectRealtimeStateSnapshot());
    return;
  }

  if (url.pathname === "/api/v3/ui-state") {
    sendJson(response, 200, projectUiStateSnapshot());
    return;
  }

  if (url.pathname === "/api/v3/effective-config") {
    const snapshot = projectUiStateSnapshot();
    sendJson(response, 200, {
      version: BTC_PREDICTION_STRATEGY_VERSION,
      releaseVersion: V356_RELEASE_VERSION,
      configHash: V3745_CONFIG_HASH,
      criticalConfig: V3745_CRITICAL_CONFIG,
      botRole: BOT_ROLE,
      botInstanceId: BOT_INSTANCE_ID,
      envOverride: process.env.BOT_ENV_OVERRIDE === "1",
      v337PriorityAllocatorEnabled: V337_PRIORITY_ALLOCATOR_ENABLED,
      v337WsFreezeReconnectMs: V337_WS_FREEZE_RECONNECT_MS,
      v337WsStaleTokenRefreshMs: V337_WS_STALE_TOKEN_REFRESH_MS,
      v337WsRotateOnMarketEvents: V337_WS_ROTATE_ON_MARKET_EVENTS,
      v337MaxStakeMultiplier: V337_MAX_STAKE_MULTIPLIER,
      v337MinStakeMultiplier: V337_MIN_STAKE_MULTIPLIER,
      externalPriceWatchdogEnabled: EXTERNAL_PRICE_WATCHDOG_ENABLED,
      externalPriceWatchdogIntervalMs: EXTERNAL_PRICE_WATCHDOG_INTERVAL_MS,
      externalPriceWatchdogStaleAfterMs: EXTERNAL_PRICE_WATCHDOG_STALE_AFTER_MS,
      externalPriceWatchdogStartupGraceMs: EXTERNAL_PRICE_WATCHDOG_STARTUP_GRACE_MS,
      externalPriceWatchdogReconnectDelayMs: EXTERNAL_PRICE_WATCHDOG_RECONNECT_DELAY_MS,
      externalPriceFeed: buildExternalPriceFeedTelemetry(),
      marketLimit: MARKET_LIMIT,
      orderbookLimit: ORDERBOOK_LIMIT,
      scanIntervalMs: SCAN_INTERVAL_MS,
      orderbookScanConcurrency: ORDERBOOK_SCAN_CONCURRENCY,
      cryptoScannerMaxWatchedMarkets: CRYPTO_SCANNER_MAX_WATCHED_MARKETS,
      cryptoScannerMaxTradeCandidates: CRYPTO_SCANNER_MAX_TRADE_CANDIDATES,
      cryptoScannerSearchLimitPerTerm: CRYPTO_SCANNER_SEARCH_LIMIT_PER_TERM,
      cryptoScannerSymbols: CRYPTO_SCANNER_SYMBOLS,
      cryptoScannerFastTimeframes: CRYPTO_SCANNER_FAST_TIMEFRAMES,
      multiAssetPredictionSymbols: MULTI_ASSET_PREDICTION_SYMBOLS,
      multiAssetPredictionTimeframes: MULTI_ASSET_PREDICTION_TIMEFRAMES,
      multiAssetSelectionPoolSize: MULTI_ASSET_SELECTION_POOL_SIZE,
      multiAssetCommitMarketsPerTick: MULTI_ASSET_COMMIT_MARKETS_PER_TICK,
      strategyMaxCandidatesPerTick: STRATEGY_MAX_CANDIDATES_PER_TICK,
      paperMaxEntriesPerTick: PAPER_MAX_ENTRIES_PER_TICK,
      maxActivePositions: MAX_ACTIVE_POSITIONS,
      maxOpenPositionsSoft: MAX_OPEN_POSITIONS_SOFT,
      maxOpenPerSymbol: MAX_OPEN_PER_SYMBOL,
      maxOpenPerSideBucket: MAX_OPEN_PER_SIDE_BUCKET,
      maxGrossOpenExposureFraction: MAX_GROSS_OPEN_EXPOSURE_FRACTION,
      maxPositionsPerWindow: MAX_POSITIONS_PER_WINDOW,
      maxSameSidePerWindow: MAX_SAME_SIDE_PER_WINDOW,
      maxStrategyPositionsPerWindow: MAX_STRATEGY_POSITIONS_PER_WINDOW,
      replayOptimizerActionMode: REPLAY_OPTIMIZER_STATE?.actionMode || "enforce",
      replayOptimizerBlockingEnabled: REPLAY_OPTIMIZER_STATE?.blockingEnabled !== false,
      replayOptimizerReduceStakeEnabled: REPLAY_OPTIMIZER_STATE?.reduceStakeEnabled !== false,
      fastCandidateBridgeEnabled: FAST_CANDIDATE_BRIDGE_ENABLED,
      fastWorthItLaneEnabled: FAST_WORTH_IT_LANE_ENABLED,
      edgeEngineEnabled: EDGE_ENGINE_ENABLED,
      edgeEngineTargetWinRate: EDGE_ENGINE_TARGET_WIN_RATE,
      edgeLaneSMinWinProb: EDGE_ENGINE_LANE_S_MIN_WIN_PROB,
      edgeLaneAMinWinProb: EDGE_ENGINE_LANE_A_MIN_WIN_PROB,
      edgeLaneBMinWinProb: EDGE_ENGINE_LANE_B_MIN_WIN_PROB,
      edgeKellyLiteEnabled: EDGE_ENGINE_KELLY_LITE_ENABLED,
      edgeLaneAMinStakeUsd: EDGE_ENGINE_LANE_A_MIN_STAKE_USD,
      edgeLaneSMaxStakeUsd: EDGE_ENGINE_LANE_S_MAX_STAKE_USD,
      edgeLaneAMaxStakeUsd: EDGE_ENGINE_LANE_A_MAX_STAKE_USD,
      edgeLaneBMaxStakeUsd: EDGE_ENGINE_LANE_B_MAX_STAKE_USD,
      edgeDownLaneAMaxStakeUsd: EDGE_ENGINE_DOWN_LANE_A_MAX_STAKE_USD,
      edgeDownLaneSMaxStakeUsd: EDGE_ENGINE_DOWN_LANE_S_MAX_STAKE_USD,
      edge15mLaneAMaxStakeUsd: EDGE_ENGINE_15M_LANE_A_MAX_STAKE_USD,
      edge15mLaneSMaxStakeUsd: EDGE_ENGINE_15M_LANE_S_MAX_STAKE_USD,
      fifteenMGlobalMaxStakeUsd: FIFTEEN_M_GLOBAL_MAX_STAKE_USD,
      sLaneThrottleEnabled: S_LANE_THROTTLE_ENABLED,
      sLaneColdSettledTrades: S_LANE_COLD_SETTLED_TRADES,
      sLaneColdMaxStakeUsd: S_LANE_COLD_MAX_STAKE_USD,
      sLaneRecoveryMaxStakeUsd: S_LANE_RECOVERY_MAX_STAKE_USD,
      sLaneFullStakeMinPnlUsd: S_LANE_FULL_STAKE_MIN_PNL_USD,
      sLaneFullStakeMinWinRate: S_LANE_FULL_STAKE_MIN_WIN_RATE,
      dynamicEquityScalingEnabled: DYNAMIC_EQUITY_SCALING_ENABLED,
      dynamicEquityScalingStartEquity: DYNAMIC_EQUITY_SCALING_START_EQUITY,
      maxTradeEquityFraction: MAX_TRADE_EQUITY_FRACTION,
      maxTradeUsdHardCap: MAX_TRADE_USD_HARD_CAP,
      equityLaneScalingEnabled: EQUITY_LANE_SCALING_ENABLED,
      equityLaneScalingBaseEquity: EQUITY_LANE_SCALING_BASE_EQUITY,
      equityLaneScalingStartEquity: EQUITY_LANE_SCALING_START_EQUITY,
      equityLaneScalingCurve: EQUITY_LANE_SCALING_CURVE,
      equityLaneScalingMaxMultiplier: EQUITY_LANE_SCALING_MAX_MULTIPLIER,
      equityLaneScalingRequireNormalProfitLock: EQUITY_LANE_SCALING_REQUIRE_NORMAL_PROFIT_LOCK,
      equityLaneScalingRequireWsBook: EQUITY_LANE_SCALING_REQUIRE_WS_BOOK,
      fastGrowEvPolicyEnabled: FAST_GROW_EV_POLICY_ENABLED,
      fastGrowEvMinNetEdge: FAST_GROW_EV_MIN_NET_EDGE,
      fastGrowEvLaneSMinNetEdge: FAST_GROW_EV_LANE_S_MIN_NET_EDGE,
      fastGrowEvLaneAMinFraction: FAST_GROW_EV_LANE_A_MIN_FRACTION,
      fastGrowEvLaneAMaxFraction: FAST_GROW_EV_LANE_A_MAX_FRACTION,
      fastGrowEvLaneSMinFraction: FAST_GROW_EV_LANE_S_MIN_FRACTION,
      fastGrowEvLaneSMaxFraction: FAST_GROW_EV_LANE_S_MAX_FRACTION,
      fastGrowEvLaneSMaxEdge: FAST_GROW_EV_LANE_S_MAX_EDGE,
      fastGrowDepthUtilization: FAST_GROW_DEPTH_UTILIZATION,
      fastGrowSkipBelowMarketMin: FAST_GROW_SKIP_BELOW_MARKET_MIN,
      regimeCorePolicyEnabled: REGIME_CORE_POLICY_ENABLED,
      regimeCoreMinConfidence: MAIN_ACCURACY_MIN_CONFIDENCE,
      regimeCoreMinEntryPrice: MAIN_ACCURACY_MIN_ENTRY_PRICE,
      legacyCalibrationExecutionGateEnabled: LEGACY_CALIBRATION_EXECUTION_GATE_ENABLED,
      legacyCalibrationRole: "telemetry_only",
      maxUnresolvedReserveFraction: MAX_UNRESOLVED_RESERVE_FRACTION,
      cohortRegimeGuardEnabled: COHORT_REGIME_GUARD_ENABLED,
      observerPolicy: observerPolicyReader.status(),
      settlementObserver: settlementObserverLearner?.status() || { status: "disabled_for_main" },
      directionShadowObserver: directionShadowObserver?.status() || { status: "disabled_for_main" },
      mainBehaviorPolicyId: MAIN_BEHAVIOR_POLICY_ID,
      antiDowngradeShadowEnabled: ANTI_DOWNGRADE_SHADOW_ENABLED,
      antiDowngradeShadowExecutionEnabled: ANTI_DOWNGRADE_SHADOW_EXECUTION_ENABLED,
      antiDowngradeAutomaticPromotion: ANTI_DOWNGRADE_AUTOMATIC_PROMOTION,
      antiDowngradeReportPath: ANTI_DOWNGRADE_REPORT_PATH,
      directionShadowEnabled: DIRECTION_SHADOW_ENABLED,
      directionShadowExecutionEnabled: DIRECTION_SHADOW_EXECUTION_ENABLED,
      directionShadowAutomaticPromotion: DIRECTION_SHADOW_AUTOMATIC_PROMOTION,
      directionShadowMaxObservationDelayMs: DIRECTION_SHADOW_MAX_OBSERVATION_DELAY_MS,
      directionShadowReportPath: DIRECTION_SHADOW_REPORT_PATH,
      paperStatePersistenceEnabled: PAPER_STATE_PERSISTENCE_ENABLED,
      paperStatePath: BTC_PAPER_STATE_PATH,
      antiPlateauSizingBasis: "current_realized_equity_not_peak_equity",
      antiPlateauMartingale: false,
      antiPlateau: snapshot.antiPlateau || buildAntiPlateauTelemetry(snapshot.prediction?.signals || []),
      stakeResetOnWinSafeEnabled: STAKE_RESET_ON_WIN_SAFE_ENABLED,
      stakeResetWinSafeLanes: STAKE_RESET_WIN_SAFE_LANES,
      v333DrawdownGuardEnabled: V333_DRAWDOWN_GUARD_ENABLED,
      v333MinSizingEquityUsd: V333_MIN_SIZING_EQUITY_USD,
      v333ColdStartSettledRequired: V333_COLD_START_SETTLED_REQUIRED,
      v333ColdStartLaneACapUsd: V333_COLD_START_LANE_A_CAP_USD,
      v333DrawdownProbeCapUsd: V333_DRAWDOWN_PROBE_CAP_USD,
      v333BlockUpInDrawdown: V333_BLOCK_UP_IN_DRAWDOWN,
      v334StrictEntryGuardEnabled: V334_STRICT_ENTRY_GUARD_ENABLED,
      v334AllowedSymbols: [...V334_ALLOWED_SYMBOLS],
      v334AllowedTimeframes: [...V334_ALLOWED_TIMEFRAMES],
      v334AllowedSides: [...V334_ALLOWED_SIDES],
      v334MaxEntryPrice: V334_MAX_ENTRY_PRICE,
      v334MaxOpenPositions: V334_MAX_OPEN_POSITIONS,
      v334BlockRuntimeToxic: V334_BLOCK_RUNTIME_TOXIC,
      v334BlockReplayBad: V334_BLOCK_REPLAY_BAD,
      v334BlockRestBook: V334_BLOCK_REST_BOOK,
      v334BlockAfterLossStreak: V334_BLOCK_AFTER_LOSS_STREAK,
      currentEquityStakeScale: getEquityStakeScale(snapshot.prediction?.accountEquity ?? (PAPER_START_BALANCE + toNumber(snapshot.metrics?.realizedPnl, 0)), {
        lane: snapshot.prediction?.calibratedLane || "A",
        profitLockMode: snapshot.prediction?.profitLockMode || "normal",
        bookSource: snapshot.prediction?.bookSource || "unknown",
        softQualityStakeMultiplier: snapshot.prediction?.softQualityStakeMultiplier ?? 1,
        runtimeStakeMultiplier: snapshot.prediction?.runtimeStakeMultiplier ?? 1,
        runtimeRuleReason: snapshot.prediction?.runtimeRuleReason || "",
        executionObserveOnly: snapshot.prediction?.executionObserveOnly || false,
      }),
      executionMode: process.env.EXECUTION_MODE || "polymarket_edge_engine",
      effectiveConfigSource: process.env.BOT_ENV_OVERRIDE === "1" ? ".env override enabled" : "locked process environment",
      currentStrategyRouterSummary: snapshot.strategyRouter?.summary || null,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === "/api/v3/account") {
    const snapshot = projectUiStateSnapshot();
    sendJson(response, 200, {
      mode: snapshot.mode,
      status: snapshot.status,
      config: snapshot.config,
      metrics: snapshot.metrics,
      antiPlateau: snapshot.antiPlateau,
      risk: snapshot.risk,
      stats: snapshot.prediction?.stats || {},
      updatedAt: snapshot.updatedAt,
    });
    return;
  }

  if (url.pathname === "/api/v3/paper/session") {
    const snapshot = projectUiStateSnapshot();
    sendJson(response, 200, {
      ok: true,
      session: paperSessionState || createPaperSessionState(),
      noDowngradeAudit: buildV356NoDowngradeAudit(snapshot),
      metrics: snapshot.metrics,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (url.pathname === "/api/v3/paper/resume-session" && request.method === "POST") {
    const session = resumePaperSession(Date.now());
    sendJson(response, 200, {
      ok: true,
      paperSessionId: session.id,
      paperSessionHold: session.hold,
      resumedAt: session.resumedAt,
      liveSelectionCore: V356_BASELINE_CORE,
      releaseVersion: V356_RELEASE_VERSION,
    });
    return;
  }

  if (url.pathname === "/api/v3/position-ledger") {
    const snapshot = projectUiStateSnapshot();
    const openPositions = snapshot.prediction?.openSignals || [];
    const history = snapshot.prediction?.recentSignals || [];
    const ledgerAccount = {
      cashBalance: snapshot.metrics?.cashBalance ?? snapshot.metrics?.paperBalance ?? PAPER_START_BALANCE,
      paperBalance: snapshot.metrics?.paperBalance ?? snapshot.metrics?.cashBalance ?? PAPER_START_BALANCE,
      paperEquity: snapshot.metrics?.paperEquity ?? snapshot.metrics?.balance ?? PAPER_START_BALANCE,
      openExposure: snapshot.metrics?.openExposure || 0,
      openStakeExposure: snapshot.metrics?.openStakeExposure || 0,
      openFeeReserve: snapshot.metrics?.openFeeReserve || 0,
      unrealizedPnl: snapshot.metrics?.unrealizedPnl || 0,
      realizedPnl: snapshot.metrics?.realizedPnl || 0,
      pnlPercent: snapshot.metrics?.pnlPercent || 0,
    };
    sendJson(response, 200, {
      account: ledgerAccount,
      openPositions,
      history,
      summary: {
        open: openPositions.length,
        history: history.length,
        realizedPnl: ledgerAccount.realizedPnl,
        unrealizedPnl: ledgerAccount.unrealizedPnl,
        paperEquity: ledgerAccount.paperEquity,
      },
      updatedAt: snapshot.updatedAt,
    });
    return;
  }

  if (url.pathname === "/api/v3/paper/close-open" && request.method === "POST") {
    const result = resetPaperLedger({ closeOpen: true, keepHistory: true });
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/v3/paper/reset-equity" && request.method === "POST") {
    const result = resetPaperLedger({ closeOpen: true, keepHistory: false });
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/v3/paper/hard-reset" && request.method === "POST") {
    const result = resetPaperLedger({ closeOpen: true, keepHistory: false });
    sendJson(response, 200, result);
    return;
  }

  if (url.pathname === "/api/v3/strategies") {
    sendJson(response, 200, projectRealtimeStateSnapshot().strategyRouter || createEmptyStrategyRouter());
    return;
  }

  if (url.pathname === "/api/v3/candidates") {
    sendJson(response, 200, projectRealtimeStateSnapshot().strategyRouter?.candidates || []);
    return;
  }

  if (url.pathname === "/api/v3/agent-advice") {
    sendJson(response, 200, loadAgentAdvice());
    return;
  }

  if (url.pathname === "/api/v3/gates") {
    sendJson(response, 200, projectRealtimeStateSnapshot().gateProtocol || createEmptyGateProtocol());
    return;
  }

  if (url.pathname === "/api/v3/learning") {
    sendJson(response, 200, projectRealtimeStateSnapshot().learning || createEmptyLearning());
    return;
  }

  if (url.pathname === "/api/v3/positions") {
    sendJson(response, 200, (projectRealtimeStateSnapshot().prediction?.signals || []).filter((signal) => signal.status === "paper_open"));
    return;
  }

  if (url.pathname === "/api/v3/events") {
    sendJson(response, 200, { trades: projectRealtimeStateSnapshot().trades || [], rejects: projectRealtimeStateSnapshot().rejects || [] });
    return;
  }

  if (url.pathname === "/api/v3/agents") {
    sendJson(response, 200, projectRealtimeStateSnapshot().agents || createEmptyAgents());
    return;
  }

  if (url.pathname === "/api/v3/market-quality") {
    const snapshot = projectRealtimeStateSnapshot();
    sendJson(response, 200, { scanner: snapshot.scanner, execution: snapshot.execution, rejectionSummary: snapshot.rejectionSummary, categorySummary: snapshot.categorySummary });
    return;
  }


  if (url.pathname === "/api/reference") {
    sendJson(response, 200, projectRealtimeStateSnapshot().reference);
    return;
  }

  if (url.pathname === "/api/agents") {
    sendJson(response, 200, projectRealtimeStateSnapshot().agents);
    return;
  }

  if (url.pathname === "/api/scanner") {
    sendJson(response, 200, projectRealtimeStateSnapshot().scanner);
    return;
  }

  if (url.pathname === "/api/calibration") {
    sendJson(response, 200, projectRealtimeStateSnapshot().calibration || buildCalibrationReport(state.prediction?.signals || []));
    return;
  }

  if (url.pathname === "/api/events") {
    sse(response);
    return;
  }

  if (url.pathname === "/api/events/ui") {
    sse(response, { compact: true });
    return;
  }

  if (url.pathname === "/api/scan" || url.pathname === "/api/v3/scan") {
    scan().catch(() => {});
    sendJson(response, 202, { ok: true, status: "scan_started" });
    return;
  }

  if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
    serveStaticUi(url, response);
    return;
  }

  sendNotFound(response);
});

server.listen(PORT, HOST, async () => {
  console.log(`Paper bot ${BOT_ROLE}/${BOT_INSTANCE_ID} listening on http://${HOST}:${PORT}`);
  console.log(`[V374.7 DIRECTION-ONLY SHADOW FASTGROW PAPER CONFIG] ${V3745_CONFIG_HASH} ${JSON.stringify(V3745_CRITICAL_CONFIG)}`);
  const runSettlementObserver = () => {
    if (!settlementObserverLearner) return;
    try {
      const result = settlementObserverLearner.runOnce(Date.now());
      auditLogger.event({
        time: new Date().toISOString(),
        reason: "observer_settlement_policy_refreshed",
        observerOnly: true,
        executionEligible: false,
        status: result.status,
      });
    } catch (error) {
      auditLogger.event({
        time: new Date().toISOString(),
        reason: "observer_settlement_policy_refresh_failed",
        observerOnly: true,
        executionEligible: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const runDirectionShadowObserver = () => {
    if (!directionShadowObserver) return;
    try {
      const result = directionShadowObserver.runOnce(Date.now());
      auditLogger.event({
        time: new Date().toISOString(),
        reason: "observer_direction_shadow_refreshed",
        observerOnly: true,
        executionEligible: false,
        automaticPromotion: false,
        status: result.status,
      });
    } catch (error) {
      auditLogger.event({
        time: new Date().toISOString(),
        reason: "observer_direction_shadow_refresh_failed",
        observerOnly: true,
        executionEligible: false,
        automaticPromotion: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const runResearchObservers = () => {
    runSettlementObserver();
    runDirectionShadowObserver();
  };
  runResearchObservers();
  startExternalPriceAnchorFeeds();
  scan().catch(() => {});
  const scanTimer = setInterval(() => scan().catch(() => {}), SCAN_INTERVAL_MS);
  const hotLaneTimer = HOT_MARKET_FAST_LANE_ENABLED
    ? setInterval(() => {
        if (!hasHotMarketFastLaneSignal(state)) return;
        const targetInterval = hotMarketFastLaneIntervalMs(state);
        if (Date.now() - lastCompletedScanAt < targetInterval) return;
        scan({ catchup: true }).catch(() => {});
      }, Math.max(50, Math.min(HOT_MARKET_SCAN_INTERVAL_MS, ULTRA_HOT_MARKET_SCAN_INTERVAL_MS)))
    : null;
  const uiTickTimer = setInterval(() => broadcast(), UI_TICK_INTERVAL_MS);
  const researchObserverTimer = settlementObserverLearner || directionShadowObserver
    ? setInterval(runResearchObservers, SETTLEMENT_OBSERVER_INTERVAL_MS)
    : null;
  scanTimer.unref?.();
  hotLaneTimer?.unref?.();
  uiTickTimer.unref?.();
  researchObserverTimer?.unref?.();
});
