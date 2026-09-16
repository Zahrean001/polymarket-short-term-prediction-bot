import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBestBidAskHint,
  applyPriceChanges,
  buildBookSnapshot,
  inspectBook,
  isBookUsable,
} from "../server/market/orderBookState.js";
import { normalizeRtdsTimestamp, parseRtdsCryptoMessage } from "../server/market/rtdsPriceMessage.js";
import { simulateMarketableBuy } from "../server/execution/paperFill.js";
import { isCandidateTechnicallyExecutable } from "../server/execution/candidateValidity.js";

const documentedSnapshot = {
  asset_id: "token-1",
  bids: [
    { price: ".48", size: "30" },
    { price: ".49", size: "20" },
    { price: ".50", size: "15" },
  ],
  asks: [
    { price: ".52", size: "25" },
    { price: ".53", size: "60" },
    { price: ".54", size: "10" },
  ],
  timestamp: "123456789000",
};

test("CLOB size=0 deletes the exact level without ghost liquidity", () => {
  const initial = buildBookSnapshot(documentedSnapshot, { tokenId: "token-1", source: "ws_snapshot", receivedAt: 200 });
  const next = applyPriceChanges(initial, [{
    asset_id: "token-1",
    price: "0.50",
    size: "0",
    side: "BUY",
    best_bid: "0.49",
    best_ask: "0.52",
  }], { tokenId: "token-1", eventTimestamp: 123456789001, receivedAt: 201 });
  assert.equal(next.bids.some((level) => level.price === 0.5), false);
  assert.equal(inspectBook(next).bestBid.price, 0.49);
  assert.equal(next.integrityReason, "ok");
  assert.equal(isBookUsable(next), true);
});

test("best_bid_ask is a consistency hint and never invents level size", () => {
  const initial = buildBookSnapshot(documentedSnapshot, { tokenId: "token-1", source: "ws_snapshot", receivedAt: 200 });
  const before = structuredClone(initial);
  const next = applyBestBidAskHint(initial, { best_bid: "0.51", best_ask: "0.52", timestamp: 123456789002 }, {
    tokenId: "token-1",
    receivedAt: 202,
    eventTimestamp: 123456789002,
  });
  assert.deepEqual(next.bids, before.bids);
  assert.deepEqual(next.asks, before.asks);
  assert.equal(next.resyncRequired, true);
  assert.equal(next.integrityReason, "best_quote_mismatch");
});

test("crossed or zero-spread snapshots are not executable", () => {
  const crossed = buildBookSnapshot({ bids: [{ price: 0.52, size: 2 }], asks: [{ price: 0.52, size: 2 }] }, {
    tokenId: "crossed",
    source: "ws_snapshot",
  });
  assert.equal(crossed.integrityReason, "crossed_or_zero_spread");
  assert.equal(isBookUsable(crossed), false);
});

test("RTDS parser separates Chainlink canonical price from Binance context", () => {
  const chainlink = parseRtdsCryptoMessage({
    topic: "crypto_prices_chainlink",
    type: "update",
    timestamp: 1753314088421,
    payload: { symbol: "btc/usd", timestamp: 1753314088395, value: 67234.5 },
  }, ["BTC"]);
  const binance = parseRtdsCryptoMessage({
    topic: "crypto_prices",
    type: "update",
    timestamp: 1753314088421,
    payload: { symbol: "btcusdt", timestamp: 1753314088395, value: 67235.1 },
  }, ["BTC"]);
  assert.equal(chainlink[0].source, "polymarket_chainlink_rtds");
  assert.equal(binance[0].source, "polymarket_binance_rtds_context");
  assert.equal(chainlink[0].symbol, "BTC");
});

test("RTDS timestamps normalize seconds, milliseconds, microseconds, and ISO without making fresh prices stale", () => {
  const expected = 1_720_000_000_000;
  assert.equal(normalizeRtdsTimestamp(1_720_000_000), expected);
  assert.equal(normalizeRtdsTimestamp(expected), expected);
  assert.equal(normalizeRtdsTimestamp(1_720_000_000_000_000), expected);
  assert.equal(normalizeRtdsTimestamp("2024-07-03T09:46:40.000Z"), expected);
});

test("RTDS parser accepts batched messages and payload-level timestamps", () => {
  const points = parseRtdsCryptoMessage([
    { topic: "crypto_prices_chainlink", payload: { timestamp: 1_720_000_000, data: [{ symbol: "BTC/USD", value: 60_000 }] } },
    { topic: "crypto_prices", payload: { timestamp: 1_720_000_001, data: [{ symbol: "solusdt", value: 150 }] } },
  ], ["BTC", "SOL"]);
  assert.deepEqual(points.map((point) => [point.source, point.symbol, point.timestamp]), [
    ["polymarket_chainlink_rtds", "BTC", 1_720_000_000_000],
    ["polymarket_binance_rtds_context", "SOL", 1_720_000_001_000],
  ]);
});

test("FAK paper fill sweeps observed depth and records fee/slippage", () => {
  const fill = simulateMarketableBuy({
    asks: [{ price: 0.5, size: 2 }, { price: 0.51, size: 10 }],
    intendedStakeUsd: 3,
    orderType: "FAK",
    maxSlippageCents: 1,
    feeRate: 0.07,
  });
  assert.equal(fill.executionStatus, "filled");
  assert.ok(Math.abs(fill.filledStakeUsd - 3) < 1e-9);
  assert.ok(fill.averageFillPrice > 0.5 && fill.averageFillPrice <= 0.51);
  assert.ok(fill.takerFeeUsd > 0);
  assert.ok(fill.slippageUsd > 0);
  assert.equal(fill.realParityEligible, true);
});

test("partial FAK is recorded but incomplete FOK becomes no-fill", () => {
  const input = { asks: [{ price: 0.5, size: 2 }], intendedStakeUsd: 3, maxSlippageCents: 1, feeRate: 0.07 };
  const fak = simulateMarketableBuy({ ...input, orderType: "FAK" });
  const fok = simulateMarketableBuy({ ...input, orderType: "FOK" });
  assert.equal(fak.executionStatus, "partial_fill");
  assert.equal(fak.filledStakeUsd, 1);
  assert.equal(fok.executionStatus, "unfilled");
  assert.equal(fok.filledStakeUsd, 0);
});

test("quality rejection remains eligible in aggressive mode while technical invalid data never does", () => {
  const base = { entryPrice: 0.61, depthShares: 20 };
  assert.equal(isCandidateTechnicallyExecutable({ ...base, blockedReason: "confidence_below_threshold" }), true);
  assert.equal(isCandidateTechnicallyExecutable({ ...base, blockedReason: "momentum_against_signal" }), true);
  assert.equal(isCandidateTechnicallyExecutable({ ...base, blockedReason: "stale_orderbook" }), false);
  assert.equal(isCandidateTechnicallyExecutable({ ...base, blockedReason: "missing_external_price_anchor" }), false);
});
