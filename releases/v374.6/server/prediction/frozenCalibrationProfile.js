const FROZEN_CALIBRATION_PROFILE = Object.freeze({
  id: "v3742-v3721-dual-confidence-platt-fastgrow-ev-20260717",
  status: "frozen_paper_challenger",
  source: Object.freeze({
    release: "v372.1-dual-bot-independent-settlement-research-paper",
    officialSettlementDatasetSha256: "37c202dd2fccee977cc16c9c1d7102dda0aa95fcc4afb35a8cb8d9d683746da5",
    fitScope: "chronological_development_only",
    syntheticRows: 0,
  }),
  forwardDiscovery: Object.freeze({
    release: "v374.0-calibrated-netev-dual-fastgrow-full-paper",
    officialSettlementDatasetSha256: "3d8f047c237b5b85eba79cf19f48e74d425a4546e1078cb27e614e16b01b026d",
    uniqueOfficialFills: 37,
    use: "policy_development_only_excluded_from_v3742_promotion",
  }),
  calibration: Object.freeze({
    type: "platt_on_v372_dual_side_confidence",
    intercept: -0.2188868507830796,
    beta: 0.4926614714030268,
    ridgeLambda: 2,
  }),
  entry: Object.freeze({
    minSecondsIntoWindow: 75,
    maxSecondsIntoWindowExclusive: 180,
    minCalibratedProbability: 0.625,
    minNetEdge: 0.05,
    maxExecutableAsk: 0.85,
    stressSlippagePerShare: 0.005,
    feeRate: 0.07,
  }),
  promotion: Object.freeze({
    newForwardUniqueOfficialFills: 150,
    targetWinRatePct: 70,
    requirePositiveNetRoi: true,
    paperOnly: true,
  }),
});

export { FROZEN_CALIBRATION_PROFILE };
