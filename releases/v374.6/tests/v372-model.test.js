import test from "node:test";
import assert from "node:assert/strict";
import { calculateIndependentDigitalProbability } from "../server/prediction/independentDigitalModel.js";

const returns = Array.from({ length: 30 }, (_, index) => (index % 2 === 0 ? 1 : -1) * 0.0001);

test("independent model rejects missing strike instead of inventing one", () => {
  const result = calculateIndependentDigitalProbability({ currentPrice: 100, strikePrice: 0, timeLeftSec: 120, oneSecondLogReturns: returns });
  assert.equal(result.available, false);
  assert.equal(result.reason, "invalid_spot_strike_or_horizon");
});

test("independent model rejects insufficient volatility history", () => {
  const result = calculateIndependentDigitalProbability({ currentPrice: 101, strikePrice: 100, timeLeftSec: 120, oneSecondLogReturns: [0.001], minReturnSamples: 12 });
  assert.equal(result.available, false);
  assert.equal(result.reason, "insufficient_external_return_history");
});

test("probability is directionally symmetric around the strike", () => {
  const up = calculateIndependentDigitalProbability({ currentPrice: 101, strikePrice: 100, timeLeftSec: 120, oneSecondLogReturns: returns });
  const down = calculateIndependentDigitalProbability({ currentPrice: 100 / 1.01, strikePrice: 100, timeLeftSec: 120, oneSecondLogReturns: returns });
  assert.equal(up.available, true);
  assert.equal(down.available, true);
  assert.ok(up.probabilityUp > 0.5);
  assert.ok(down.probabilityUp < 0.5);
  assert.ok(Math.abs(up.probabilityUp + down.probabilityUp - 1) < 1e-10);
});
