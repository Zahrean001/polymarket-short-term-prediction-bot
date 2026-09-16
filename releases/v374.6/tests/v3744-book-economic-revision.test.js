import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBestBidAskHint,
  applyPriceChanges,
  buildBookSnapshot,
} from "../server/market/orderBookState.js";

function snapshot() {
  return buildBookSnapshot({
    asset_id: "token-up",
    timestamp: 900,
    bids: [{ price: "0.49", size: "10" }],
    asks: [{ price: "0.51", size: "10" }],
  }, { tokenId: "token-up", receivedAt: 1_000, source: "ws_snapshot" });
}

test("duplicate deltas and top hints do not manufacture economic generations", () => {
  const initial = snapshot();
  const duplicate = applyPriceChanges(initial, [{
    asset_id: "token-up", side: "SELL", price: "0.51", size: "10",
  }], { tokenId: "token-up", receivedAt: 1_100, eventTimestamp: 1_100, source: "ws_delta" });
  const hinted = applyBestBidAskHint(duplicate, { best_bid: "0.49", best_ask: "0.51" }, {
    tokenId: "token-up", receivedAt: 1_200, eventTimestamp: 1_200, source: "ws_best_bid_ask",
  });
  assert.equal(initial.economicRevision, 1);
  assert.equal(duplicate.economicRevision, 1);
  assert.equal(duplicate.economicGeneration, initial.economicGeneration);
  assert.equal(hinted.economicGeneration, initial.economicGeneration);
});

test("a top-five size mutation advances exactly one economic revision", () => {
  const initial = snapshot();
  const changed = applyPriceChanges(initial, [{
    asset_id: "token-up", side: "SELL", price: "0.51", size: "12",
  }], { tokenId: "token-up", receivedAt: 1_100, eventTimestamp: 1_100, source: "ws_delta" });
  assert.equal(changed.economicRevision, 2);
  assert.notEqual(changed.economicGeneration, initial.economicGeneration);
});

test("identical full WS snapshots preserve generation and a changed snapshot advances once", () => {
  const initial = snapshot();
  const duplicate = buildBookSnapshot({
    asset_id: "token-up",
    timestamp: 1_100,
    bids: [{ price: "0.49", size: "10" }],
    asks: [{ price: "0.51", size: "10" }],
  }, { tokenId: "token-up", receivedAt: 1_100, source: "ws_snapshot", current: initial });
  const changed = buildBookSnapshot({
    asset_id: "token-up",
    timestamp: 1_200,
    bids: [{ price: "0.49", size: "10" }],
    asks: [{ price: "0.51", size: "12" }],
  }, { tokenId: "token-up", receivedAt: 1_200, source: "ws_snapshot", current: duplicate });

  assert.equal(duplicate.economicFingerprint, initial.economicFingerprint);
  assert.equal(duplicate.economicRevision, initial.economicRevision);
  assert.equal(duplicate.economicGeneration, initial.economicGeneration);
  assert.equal(changed.economicRevision, initial.economicRevision + 1);
  assert.notEqual(changed.economicGeneration, initial.economicGeneration);
});

test("out-of-order deltas cannot advance or regress economic state", () => {
  const initial = snapshot();
  const stale = applyPriceChanges(initial, [{
    asset_id: "token-up", side: "SELL", price: "0.51", size: "99",
  }], { tokenId: "token-up", receivedAt: 1_100, eventTimestamp: 800, source: "ws_delta" });
  assert.equal(stale, initial);
  assert.equal(stale.economicRevision, 1);
});
