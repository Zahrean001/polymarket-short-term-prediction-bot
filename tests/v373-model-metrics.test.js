import test from "node:test";
import assert from "node:assert/strict";
import { calculateRealOnlyDirectionProbability } from "../server/prediction/realOnlyDirectionModel.js";
import {
  isFilledTrade,
  summarizeOfficialFilledUnique,
  uniqueOfficialFilledTrades,
} from "../server/metrics/officialTradeMetrics.js";

const observedReturnShape = [
  -0.00008, 0.00003, -0.00002, 0.00006, -0.00001, 0.00004,
  -0.00005, 0.00002, -0.00003, 0.00007, -0.00004, 0.00001,
  -0.00002, 0.00005, -0.00006, 0.00003, -0.00001, 0.00004,
  -0.00003, 0.00002, -0.00004, 0.00006, -0.00002, 0.00001,
];

test("real-only model refuses missing Chainlink return history", () => {
  const result = calculateRealOnlyDirectionProbability({
    currentPrice: 100,
    strikePrice: 99,
    timeLeftSec: 120,
    oneSecondLogReturns: [0.0001],
    minReturnSamples: 12,
  });
  assert.equal(result.available, false);
  assert.equal(result.reason, "insufficient_real_return_history");
});

test("bounded market context cannot flip the independent asset direction", () => {
  const result = calculateRealOnlyDirectionProbability({
    currentPrice: 99.7,
    strikePrice: 100,
    timeLeftSec: 90,
    oneSecondLogReturns: observedReturnShape,
    minReturnSamples: 12,
    prices: { upBidPrice: 0.88, upBuyPrice: 0.89, downBidPrice: 0.10, downBuyPrice: 0.11 },
    marketWeight: 0.2,
  });
  assert.equal(result.available, true);
  assert.ok(result.assetProbabilityUp < 0.5);
  assert.ok(result.probabilityUp < 0.5);
  assert.equal(result.calibrationStatus, "raw_unpromoted");
});

function official(overrides = {}) {
  return {
    id: "trade-1",
    slug: "btc-updown-5m-100",
    timeframe: "5M",
    direction: "Up",
    time: "2026-01-01T00:01:00.000Z",
    status: "paper_win",
    settlementSource: "official_poly",
    officialSettlementUsed: true,
    executionStatus: "filled",
    filledStakeUsd: 3,
    paperStakeUsd: 3,
    ...overrides,
  };
}

test("headline WR is official + filled + unique 5M only", () => {
  const rows = [
    official(),
    official({ id: "duplicate-later", time: "2026-01-01T00:02:00.000Z", status: "paper_loss" }),
    official({ id: "no-fill", slug: "btc-updown-5m-200", executionStatus: "unfilled", filledStakeUsd: 0, paperStakeUsd: 0, status: "paper_loss" }),
    official({ id: "proxy", slug: "btc-updown-5m-300", settlementSource: "proxy_binance_pending_official", officialSettlementUsed: false }),
    official({ id: "second-outcome", slug: "btc-updown-5m-400", status: "paper_loss" }),
    official({ id: "15m", slug: "btc-updown-15m-500", timeframe: "15M", status: "paper_win" }),
  ];
  const summary = summarizeOfficialFilledUnique(rows, { timeframe: "5M" });
  assert.equal(summary.rawFilledSettledTrades, 3);
  assert.equal(summary.uniqueOutcomes, 2);
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 1);
  assert.equal(summary.winRate, 50);
  assert.equal(uniqueOfficialFilledTrades(rows, { timeframe: "15M" }).length, 1);
  assert.equal(isFilledTrade(rows[2]), false);
});
