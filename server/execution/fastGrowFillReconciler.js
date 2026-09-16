import { simulateMarketableBuy } from "./paperFill.js";
import { evaluateCalibratedNetEv } from "../prediction/calibratedNetEvPolicy.js";
import { evaluateIndependentAssetEdge } from "../prediction/independentAssetEdgePolicy.js";
import { classifyFastGrowEv, sizeFastGrowStake } from "../prediction/fastGrowEvPolicy.js";
import { buildRegimeCoreEconomics, evaluateRegimeCorePolicy } from "../prediction/regimeCorePolicy.js";

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

/**
 * Reconciles a proposed fast-grow stake with the observed weighted-average fill.
 *
 * A depth sweep can reduce calibrated net edge enough to demote Lane S to Lane A.
 * The loop is deliberately monotone: it may reduce intended stake, but it never
 * increases stake after observing a fill. This prevents a preliminary lane from
 * retaining a larger risk allocation than its final fill economics allow.
 */
function reconcileFastGrowObservedFill(input = {}, config = {}) {
  const maxIterations = Math.max(1, Math.min(8, Math.trunc(finite(config.maxIterations, 4))));
  let intendedStakeUsd = Math.max(0, finite(input.intendedStakeUsd, 0));
  let paperFill = null;
  let calibratedNetEv = null;
  let independentAssetEdge = null;
  let regimeCorePolicy = null;
  let policy = null;
  let sizing = null;

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    paperFill = simulateMarketableBuy({
      asks: input.asks,
      intendedStakeUsd,
      orderType: input.orderType,
      maxSlippageCents: input.maxSlippageCents,
      limitPrice: input.limitPrice,
      feeRate: input.feeRate,
      minimumOrderShares: input.minimumOrderShares,
      tickSize: input.tickSize,
    });
    if (!paperFill.realParityEligible || !(paperFill.filledStakeUsd > 0)) {
      return {
        executable: false,
        reason: paperFill.reason || "fastgrow_observed_fill_unavailable",
        iterations: iteration,
        intendedStakeUsd,
        paperFill,
        calibratedNetEv,
        independentAssetEdge,
        regimeCorePolicy,
        policy,
        sizing,
      };
    }

    calibratedNetEv = evaluateCalibratedNetEv({
      rawConfidence: input.rawConfidence,
      executablePrice: paperFill.averageFillPrice,
      measuredFeePerShare: paperFill.filledShares > 0
        ? paperFill.takerFeeUsd / paperFill.filledShares
        : Number.NaN,
      secondsIntoWindow: input.secondsIntoWindow,
      feeRate: input.feeRate,
    });
    independentAssetEdge = evaluateIndependentAssetEdge({
      assetProbability: input.effectiveAssetProbability ?? input.assetProbability,
      executablePrice: paperFill.averageFillPrice,
      measuredFeePerShare: paperFill.filledShares > 0
        ? paperFill.takerFeeUsd / paperFill.filledShares
        : Number.NaN,
      feeRate: input.feeRate,
      minNetEdge: config.independentAssetMinNetEdge,
      stressSlippagePerShare: config.independentAssetStressSlippagePerShare,
    });
    regimeCorePolicy = config.regimeCoreEnabled === true
      ? evaluateRegimeCorePolicy({
          confidence: input.rawConfidence,
          executablePrice: paperFill.averageFillPrice,
          selectedDirection: input.selectedDirection,
          modelDirection: input.modelDirection,
          independentAssetEdge,
          observerProbability: input.observerProbability,
        }, {
          minConfidence: config.regimeCoreMinConfidence,
          minEntryPrice: config.regimeCoreMinEntryPrice,
          maxEntryPrice: config.regimeCoreMaxEntryPrice,
        })
      : null;
    const executionEconomics = config.regimeCoreEnabled === true
      ? buildRegimeCoreEconomics(regimeCorePolicy, independentAssetEdge, input.observerProbability)
      : calibratedNetEv;
    policy = classifyFastGrowEv(executionEconomics, config);
    if ((config.regimeCoreEnabled === true ? !regimeCorePolicy?.eligible : !calibratedNetEv.eligible) || !policy.executable || !independentAssetEdge.eligible) {
      return {
        executable: false,
        reason: !independentAssetEdge.eligible
          ? independentAssetEdge.reason
          : (regimeCorePolicy?.reason || policy.reason || calibratedNetEv.reason || "fastgrow_final_net_ev_rejected"),
        iterations: iteration,
        intendedStakeUsd,
        paperFill,
        calibratedNetEv,
        independentAssetEdge,
        regimeCorePolicy,
        policy,
        sizing,
      };
    }

    sizing = sizeFastGrowStake({
      policy,
      calibratedNetEv,
      equity: input.equity,
      entryPrice: paperFill.averageFillPrice,
      depthShares: input.depthShares,
      maxTradeUsd: input.maxTradeUsd,
      minimumOrderShares: input.minimumOrderShares,
      minimumRecordedFillUsd: input.minimumRecordedFillUsd,
    }, config);
    if (!sizing.executable) {
      return {
        executable: false,
        reason: sizing.reason || "fastgrow_final_sizing_rejected",
        iterations: iteration,
        intendedStakeUsd,
        paperFill,
        calibratedNetEv,
        independentAssetEdge,
        regimeCorePolicy,
        policy,
        sizing,
      };
    }

    if (paperFill.filledStakeUsd <= sizing.stakeUsd + 1e-7) {
      return {
        executable: true,
        reason: iteration === 1 ? "fastgrow_fill_consistent" : "fastgrow_fill_reconciled",
        iterations: iteration,
        intendedStakeUsd,
        paperFill,
        calibratedNetEv,
        independentAssetEdge,
        regimeCorePolicy,
        policy,
        sizing,
      };
    }

    const reducedStakeUsd = Math.min(intendedStakeUsd, sizing.stakeUsd);
    if (!(reducedStakeUsd < intendedStakeUsd - 1e-7)) {
      return {
        executable: false,
        reason: "fastgrow_fill_sizing_nonconvergent",
        iterations: iteration,
        intendedStakeUsd,
        paperFill,
        calibratedNetEv,
        independentAssetEdge,
        regimeCorePolicy,
        policy,
        sizing,
      };
    }
    intendedStakeUsd = reducedStakeUsd;
  }

  return {
    executable: false,
    reason: "fastgrow_fill_reconciliation_iteration_limit",
    iterations: maxIterations,
    intendedStakeUsd,
    paperFill,
    calibratedNetEv,
    independentAssetEdge,
    regimeCorePolicy,
    policy,
    sizing,
  };
}

export { reconcileFastGrowObservedFill };
