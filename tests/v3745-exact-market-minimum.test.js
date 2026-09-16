import assert from "node:assert/strict";
import test from "node:test";
import { calculateActualMinimumStake, maximumStakeWithinUnresolvedReserve, resolveMarketMinimumShares } from "../server/execution/marketMinimumStake.js";
import { classifyFastGrowEv, sizeFastGrowStake } from "../server/prediction/fastGrowEvPolicy.js";

const CONFIG = {
  minNetEdge: 0.05,
  laneSMinNetEdge: 0.10,
  laneAMinFraction: 0.08,
  laneAMaxFraction: 0.10,
  laneSMinFraction: 0.12,
  laneSMaxFraction: 0.15,
  laneSMaxEdge: 0.20,
  depthUtilization: 1,
};

function sizeAt({ equity, price, marketMinimumShares }) {
  const economics = { eligible: true, netEdge: 0.20, calibratedProbability: 0.80 };
  const policy = classifyFastGrowEv(economics, CONFIG);
  return sizeFastGrowStake({
    policy,
    calibratedNetEv: economics,
    equity,
    entryPrice: price,
    depthShares: 1_000,
    maxTradeUsd: equity * 0.15,
    minimumOrderShares: marketMinimumShares,
    minimumRecordedFillUsd: 1,
  }, CONFIG);
}

test("equity 19.77325 can execute five shares at 0.54 without a fixed three-dollar floor", () => {
  const minimum = calculateActualMinimumStake({ minimumRecordedFillUsd: 1, marketMinimumShares: 5, executablePrice: 0.54 });
  const sizing = sizeAt({ equity: 19.77325, price: 0.54, marketMinimumShares: 5 });
  assert.equal(minimum.actualMinimumStakeUsd, 2.7);
  assert.equal(minimum.artificialFixedUsdFloorApplied, false);
  assert.ok(Math.abs(sizing.stakeUsd - 2.9659875) < 1e-9);
  assert.equal(sizing.executable, true);
});

test("the same equity rejects a real five-share minimum at 0.63 without inflating stake", () => {
  const minimum = calculateActualMinimumStake({ minimumRecordedFillUsd: 1, marketMinimumShares: 5, executablePrice: 0.63 });
  const sizing = sizeAt({ equity: 19.77325, price: 0.63, marketMinimumShares: 5 });
  assert.equal(minimum.actualMinimumStakeUsd, 3.15);
  assert.equal(sizing.executable, false);
  assert.ok(sizing.stakeUsd < minimum.actualMinimumStakeUsd);
});

test("market minimum scales with price and never contains a hidden fixed-dollar threshold", () => {
  for (const price of [0.50, 0.54, 0.63, 0.85]) {
    const result = calculateActualMinimumStake({ minimumRecordedFillUsd: 1, marketMinimumShares: 5, executablePrice: price });
    assert.equal(result.actualMinimumStakeUsd, 5 * price);
    assert.equal(result.artificialFixedUsdFloorApplied, false);
  }
});

test("missing market minimum fails closed and conflicting metadata uses the strictest share minimum", () => {
  assert.equal(resolveMarketMinimumShares(undefined, null, 0, ""), null);
  assert.equal(resolveMarketMinimumShares(1, "5", 3), 5);
  const missing = calculateActualMinimumStake({ minimumRecordedFillUsd: 1, marketMinimumShares: 0, executablePrice: 0.60 });
  assert.equal(missing.valid, false);
  assert.equal(missing.reason, "market_minimum_shares_invalid");
  const economics = { eligible: true, netEdge: 0.20, calibratedProbability: 0.80 };
  const policy = classifyFastGrowEv(economics, CONFIG);
  const sizing = sizeFastGrowStake({ policy, calibratedNetEv: economics, equity: 40, entryPrice: 0.60, depthShares: 1_000, maxTradeUsd: 6 }, CONFIG);
  assert.equal(sizing.executable, false);
  assert.equal(sizing.reason, "fastgrow_market_minimum_shares_unavailable");
});

test("unresolved stake plus fee reserve is capped at thirty percent of current realized equity", () => {
  const result = maximumStakeWithinUnresolvedReserve({
    realizedEquityUsd: 40,
    openReservedUsd: 6.2,
    maxReserveFraction: 0.30,
    entryPrice: 0.60,
    feeRate: 0.07,
    minimumStakeUsd: 3,
  });
  assert.equal(result.reserveLimitUsd, 12);
  assert.equal(result.executable, true);
  const reservedAfter = result.openReservedUsd + result.maximumStakeUsd * (1 + result.feeRatioToStake);
  assert.ok(reservedAfter <= 12 + 1e-9);
});

test("reserve cap rejects only when the true market minimum cannot fit", () => {
  const result = maximumStakeWithinUnresolvedReserve({
    realizedEquityUsd: 40,
    openReservedUsd: 11,
    maxReserveFraction: 0.30,
    entryPrice: 0.60,
    feeRate: 0.07,
    minimumStakeUsd: 3,
  });
  assert.equal(result.executable, false);
  assert.equal(result.maximumStakeUsd, 0);
  assert.equal(result.reason, "unresolved_reserve_cap_reached");
});
