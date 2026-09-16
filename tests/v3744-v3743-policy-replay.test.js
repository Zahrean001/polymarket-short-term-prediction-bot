import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCalibratedNetEv } from "../server/prediction/calibratedNetEvPolicy.js";
import { evaluateIndependentAssetEdge } from "../server/prediction/independentAssetEdgePolicy.js";

// Recorded V374.3 observed fills. This is a development regression fixture,
// not forward proof and not synthetic performance data.
const RECORDED_V3743_FILLS = [
  {
    id: "SOL-UP-loss",
    symbol: "SOL",
    rawConfidence: 85.12007681135208,
    assetProbability: 0.6326793103957777,
    fillPrice: 0.58,
    feeUsd: 0.09539,
    filledShares: 5.5938640950180645,
    expectedAssetEligible: false,
  },
  {
    id: "BTC-UP-loss",
    symbol: "BTC",
    rawConfidence: 88.96305887817331,
    assetProbability: 0.7832624194740881,
    fillPrice: 0.59,
    feeUsd: 0.10563,
    filledShares: 6.237925371418677,
    expectedAssetEligible: true,
  },
  {
    id: "BTC-DOWN-win-1",
    symbol: "BTC",
    rawConfidence: 87.49,
    assetProbability: 0.7359996268,
    fillPrice: 0.58,
    feeUsd: 0.09693,
    filledShares: 5.6842923,
    expectedAssetEligible: true,
  },
  {
    id: "BTC-DOWN-win-2",
    symbol: "BTC",
    rawConfidence: 89.93,
    assetProbability: 0.6987561733,
    fillPrice: 0.59,
    feeUsd: 0.09083,
    filledShares: 5.3638995,
    expectedAssetEligible: true,
  },
];

test("recorded V374.3 replay rejects the weak SOL asset edge without starving three BTC rows", () => {
  const evaluated = RECORDED_V3743_FILLS.map((row) => {
    const calibrated = evaluateCalibratedNetEv({
      rawConfidence: row.rawConfidence,
      executablePrice: row.fillPrice,
      measuredFeePerShare: row.feeUsd / row.filledShares,
      secondsIntoWindow: 100,
      feeRate: 0.07,
    });
    const independent = evaluateIndependentAssetEdge({
      assetProbability: row.assetProbability,
      executablePrice: row.fillPrice,
      measuredFeePerShare: row.feeUsd / row.filledShares,
      feeRate: 0.07,
    });
    assert.equal(calibrated.eligible, true, `${row.id}: legacy calibration cadence changed`);
    assert.equal(independent.eligible, row.expectedAssetEligible, `${row.id}: independent asset gate mismatch`);
    return { row, calibrated, independent };
  });

  assert.deepEqual(
    evaluated.filter((item) => item.independent.eligible).map((item) => item.row.symbol),
    ["BTC", "BTC", "BTC"],
  );
  assert.ok(evaluated[0].independent.netEdge > 0.03 && evaluated[0].independent.netEdge < 0.05);
  assert.ok(evaluated[3].independent.netEdge > 0.08);
});
