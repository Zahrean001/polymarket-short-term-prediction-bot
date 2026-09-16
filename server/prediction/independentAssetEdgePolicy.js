import { feePerShareAtPrice } from "./calibratedNetEvPolicy.js";

const DEFAULT_INDEPENDENT_ASSET_EDGE_CONFIG = Object.freeze({
  minNetEdge: 0.05,
  stressSlippagePerShare: 0.005,
  feeRate: 0.07,
});

function finite(value, fallback = Number.NaN) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function evaluateIndependentAssetEdge(input = {}, config = {}) {
  const cfg = { ...DEFAULT_INDEPENDENT_ASSET_EDGE_CONFIG, ...config };
  const assetProbability = finite(input.assetProbability);
  const executablePrice = finite(input.executablePrice);
  if (!Number.isFinite(assetProbability) || assetProbability <= 0 || assetProbability >= 1) {
    return { eligible: false, reason: "independent_asset_probability_unavailable" };
  }
  if (!Number.isFinite(executablePrice) || executablePrice <= 0 || executablePrice >= 1) {
    return {
      eligible: false,
      reason: "independent_asset_executable_price_invalid",
      assetProbability: clamp(assetProbability, 0.01, 0.99),
    };
  }

  const feeRate = Math.max(0, finite(input.feeRate, cfg.feeRate));
  const measuredFeePerShare = finite(input.measuredFeePerShare);
  const feePerShare = Number.isFinite(measuredFeePerShare)
    ? Math.max(0, measuredFeePerShare)
    : feePerShareAtPrice(executablePrice, feeRate);
  const stressSlippagePerShare = Math.max(
    0,
    finite(input.stressSlippagePerShare, cfg.stressSlippagePerShare),
  );
  const minNetEdge = Math.max(0, finite(input.minNetEdge, cfg.minNetEdge));
  const netEdge = assetProbability - executablePrice - feePerShare - stressSlippagePerShare;
  const eligible = netEdge >= minNetEdge;

  return {
    eligible,
    reason: eligible ? "independent_asset_net_edge_ready" : "independent_asset_net_edge_below_floor",
    probabilitySource: "independent_chainlink_asset_model",
    assetProbability: clamp(assetProbability, 0.01, 0.99),
    executablePrice,
    feePerShare,
    stressSlippagePerShare,
    netEdge,
    minNetEdge,
  };
}

export { DEFAULT_INDEPENDENT_ASSET_EDGE_CONFIG, evaluateIndependentAssetEdge };
