import assert from "node:assert/strict";
import test from "node:test";
import { evaluateExternalPriceFeedLiveness } from "../server/market/externalPriceFeedLiveness.js";

const NOW = 10_000_000;
const base = {
  enabled: true,
  now: NOW,
  socketState: "open",
  connectedAtMs: NOW - 20_000,
  requiredSymbols: ["BTC", "SOL"],
  staleAfterMs: 4_500,
  startupGraceMs: 6_000,
  futureToleranceMs: 2_000,
};

test("watchdog keeps a fresh official feed live", () => {
  const result = evaluateExternalPriceFeedLiveness({
    ...base,
    lastArrivalBySymbol: { BTC: NOW - 100, SOL: NOW - 200 },
    latestEventBySymbol: { BTC: NOW - 150, SOL: NOW - 250 },
  });
  assert.equal(result.healthy, true);
  assert.equal(result.reconnectRequired, false);
  assert.equal(result.reason, "external_price_feed_live");
});

test("watchdog reconnects only when the transport actually stays silent", () => {
  const result = evaluateExternalPriceFeedLiveness({
    ...base,
    lastTransportActivityAtMs: NOW - 13_000,
    lastValidPublisherAtMs: NOW - 13_000,
    transportStaleAfterMs: 12_000,
    publisherStaleAfterMs: 15_000,
    lastArrivalBySymbol: { BTC: NOW - 13_000, SOL: NOW - 13_100 },
    latestEventBySymbol: { BTC: NOW - 13_000, SOL: NOW - 13_100 },
  });
  assert.equal(result.healthy, false);
  assert.equal(result.reconnectRequired, true);
  assert.equal(result.reason, "external_price_transport_silent");
});

test("one required stale symbol triggers delayed recovery even when the shared socket carries BTC", () => {
  const result = evaluateExternalPriceFeedLiveness({
    ...base,
    lastArrivalBySymbol: { BTC: NOW - 100, SOL: NOW - 20_000 },
    latestEventBySymbol: { BTC: NOW - 100, SOL: NOW - 20_000 },
    lastEventProgressBySymbol: { BTC: NOW - 100, SOL: NOW - 20_000 },
  });
  assert.equal(result.healthy, false);
  assert.equal(result.reconnectRequired, true);
  assert.equal(result.publisherProgressFrozen, true);
  assert.deepEqual(result.publisherProgressFrozenSymbols, ["SOL"]);
  assert.equal(result.reason, "external_price_required_symbol_progress_frozen:SOL");
});

test("startup grace prevents reconnect storms before the first tick", () => {
  const result = evaluateExternalPriceFeedLiveness({
    ...base,
    connectedAtMs: NOW - 1_000,
    lastArrivalBySymbol: {},
    latestEventBySymbol: {},
  });
  assert.equal(result.healthy, false);
  assert.equal(result.reconnectRequired, false);
  assert.equal(result.reason, "external_price_feed_startup_grace");
});

test("future-dated feed events are rejected as poisoned liveness", () => {
  const result = evaluateExternalPriceFeedLiveness({
    ...base,
    lastArrivalBySymbol: { BTC: NOW - 100, SOL: NOW - 100 },
    latestEventBySymbol: { BTC: NOW + 5_000, SOL: NOW - 100 },
  });
  assert.equal(result.healthy, false);
  assert.equal(result.reconnectRequired, false);
  assert.equal(result.reason, "external_price_event_timestamp_future:BTC");
});

test("unchanged price events with fresh arrival and event progress remain healthy", () => {
  const result = evaluateExternalPriceFeedLiveness({
    ...base,
    lastTransportActivityAtMs: NOW - 50,
    lastValidPublisherAtMs: NOW - 50,
    lastArrivalBySymbol: { BTC: NOW - 50, SOL: NOW - 50 },
    latestEventBySymbol: { BTC: NOW - 50, SOL: NOW - 50 },
    lastEventProgressBySymbol: { BTC: NOW - 50, SOL: NOW - 50 },
  });
  assert.equal(result.healthy, true);
  assert.equal(result.reconnectRequired, false);
});

test("fresh frames with frozen vendor time fail data closed but avoid eager reconnect", () => {
  const result = evaluateExternalPriceFeedLiveness({
    ...base,
    lastTransportActivityAtMs: NOW - 50,
    lastValidPublisherAtMs: NOW - 50,
    lastArrivalBySymbol: { BTC: NOW - 50, SOL: NOW - 50 },
    latestEventBySymbol: { BTC: NOW - 6_000, SOL: NOW - 6_000 },
    lastEventProgressBySymbol: { BTC: NOW - 6_000, SOL: NOW - 6_000 },
  });
  assert.equal(result.healthy, false);
  assert.equal(result.reconnectRequired, false);
  assert.equal(result.publisherProgressFrozen, false);
  assert.match(result.reason, /event_stale|symbol_silent/);
});

test("fresh Chainlink frames with all vendor timestamps frozen for 20s request delayed reconnect", () => {
  const result = evaluateExternalPriceFeedLiveness({
    ...base,
    lastTransportActivityAtMs: NOW - 50,
    lastValidPublisherAtMs: NOW - 50,
    publisherStaleAfterMs: 15_000,
    lastArrivalBySymbol: { BTC: NOW - 50, SOL: NOW - 50 },
    latestEventBySymbol: { BTC: NOW - 20_000, SOL: NOW - 20_000 },
    lastEventProgressBySymbol: { BTC: NOW - 20_000, SOL: NOW - 20_000 },
  });
  assert.equal(result.healthy, false);
  assert.equal(result.publisherProgressFrozen, true);
  assert.equal(result.reconnectRequired, true);
  assert.equal(result.reason, "external_price_required_symbol_progress_frozen:BTC");
});

test("PONG activity with a silent Chainlink topic triggers delayed publisher recovery", () => {
  const result = evaluateExternalPriceFeedLiveness({
    ...base,
    lastTransportActivityAtMs: NOW - 50,
    lastValidPublisherAtMs: NOW - 16_000,
    publisherStaleAfterMs: 15_000,
    lastArrivalBySymbol: { BTC: NOW - 16_000, SOL: NOW - 16_000 },
    latestEventBySymbol: { BTC: NOW - 16_000, SOL: NOW - 16_000 },
  });
  assert.equal(result.reconnectRequired, true);
  assert.equal(result.reason, "external_price_chainlink_topic_silent");
});

test("a closed socket is left to the connection manager instead of double reconnecting", () => {
  const result = evaluateExternalPriceFeedLiveness({ ...base, socketState: "closed" });
  assert.equal(result.healthy, false);
  assert.equal(result.reconnectRequired, false);
  assert.equal(result.reason, "external_price_socket_closed");
});
