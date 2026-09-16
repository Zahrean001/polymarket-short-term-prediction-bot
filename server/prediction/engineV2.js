const DEFAULT_MODEL = {
  bias: 0,
  weights: {
    signedDistanceBps: 0.082,
    signedMomentum15Bps: 0.038,
    signedMomentum30Bps: 0.031,
    signedMomentum60Bps: 0.022,
    volatilityAdjustedDistance: 0.17,
    selectedBookImbalance: 0.43,
    selectedDepthPressure: 0.22,
    sideDepthAdvantage: 0.28,
    selectedMicropriceEdgeCents: 0.18,
    micropriceConfirmation: 0.36,
    marketAgreement: 0.34,
    timePressure: 0.13,
    spreadPenalty: -0.32,
    askCostPenalty: -0.48,
    bookAgePenalty: -0.26,
  },
};

const CONFIDENCE_BUCKETS = [
  { label: "50-60", min: 50, max: 60 },
  { label: "60-70", min: 60, max: 70 },
  { label: "70-75", min: 70, max: 75 },
  { label: "75-80", min: 75, max: 80 },
  { label: "80-85", min: 80, max: 85 },
  { label: "85-90", min: 85, max: 90 },
  { label: "90-100", min: 90, max: 101 },
];

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sigmoid(value) {
  const clipped = clamp(value, -40, 40);
  return 1 / (1 + Math.exp(-clipped));
}

function bpsReturn(current, prior) {
  current = finite(current, NaN);
  prior = finite(prior, NaN);
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior <= 0) return 0;
  return ((current / prior) - 1) * 10_000;
}

function getPointAtOrBefore(history, now, secondsBack) {
  const target = now - secondsBack * 1000;
  let best = null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    const ts = Date.parse(item.time || item.updatedAt || "");
    if (!Number.isFinite(ts)) continue;
    if (ts <= target) {
      best = item;
      break;
    }
  }
  return best;
}

function standardDeviation(values) {
  const rows = values.map(Number).filter(Number.isFinite);
  if (rows.length < 3) return 0;
  const mean = rows.reduce((sum, value) => sum + value, 0) / rows.length;
  const variance = rows.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (rows.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function computeMomentumFeatures({ currentPrice, priceToBeat, previousHistory, now }) {
  const history = Array.isArray(previousHistory) ? previousHistory : [];
  const p15 = getPointAtOrBefore(history, now, 15)?.currentPrice;
  const p30 = getPointAtOrBefore(history, now, 30)?.currentPrice;
  const p60 = getPointAtOrBefore(history, now, 60)?.currentPrice;
  const momentum15Bps = bpsReturn(currentPrice, p15);
  const momentum30Bps = bpsReturn(currentPrice, p30);
  const momentum60Bps = bpsReturn(currentPrice, p60);

  const recent = history
    .filter((item) => {
      const ts = Date.parse(item.time || item.updatedAt || "");
      return Number.isFinite(ts) && now - ts <= 60_000 && Number.isFinite(Number(item.currentPrice));
    })
    .map((item) => Number(item.currentPrice));
  recent.push(currentPrice);

  const returnSeries = [];
  for (let index = 1; index < recent.length; index += 1) {
    returnSeries.push(bpsReturn(recent[index], recent[index - 1]));
  }

  const volatility60Bps = standardDeviation(returnSeries);
  const distanceBps = priceToBeat > 0 ? Math.abs(((currentPrice / priceToBeat) - 1) * 10_000) : 0;

  return {
    momentum15Bps,
    momentum30Bps,
    momentum60Bps,
    volatility60Bps,
    volatilityAdjustedDistance: volatility60Bps > 0 ? distanceBps / Math.max(1.0, volatility60Bps) : distanceBps,
  };
}

function calculateBookDiagnostics({ upBuyPrice, downBuyPrice, upBidPrice, downBidPrice, upDepthShares, downDepthShares, bookAgeMs }) {
  const upSpreadCents = Math.max(0, (finite(upBuyPrice) - finite(upBidPrice)) * 100);
  const downSpreadCents = Math.max(0, (finite(downBuyPrice) - finite(downBidPrice)) * 100);
  const yesNoAskCost = finite(upBuyPrice) + finite(downBuyPrice);
  const bidCost = finite(upBidPrice) + finite(downBidPrice);
  const totalDepth = Math.max(1e-9, finite(upDepthShares) + finite(downDepthShares));
  const upBookImbalance = (finite(upDepthShares) - finite(downDepthShares)) / totalDepth;
  const downBookImbalance = -upBookImbalance;
  const upMid = finite(upBidPrice) && finite(upBuyPrice) ? (finite(upBidPrice) + finite(upBuyPrice)) / 2 : 0;
  const downMid = finite(downBidPrice) && finite(downBuyPrice) ? (finite(downBidPrice) + finite(downBuyPrice)) / 2 : 0;
  const upMicroprice = upMid + upBookImbalance * Math.max(0.001, upSpreadCents / 100) * 0.5;
  const downMicroprice = downMid + downBookImbalance * Math.max(0.001, downSpreadCents / 100) * 0.5;

  return {
    upSpreadCents,
    downSpreadCents,
    yesNoAskCost,
    bidCost,
    upBookImbalance,
    downBookImbalance,
    upMicroprice,
    downMicroprice,
    bookAgePenalty: clamp(finite(bookAgeMs) / 2_000, 0, 3),
    askCostPenalty: clamp(Math.max(0, yesNoAskCost - 1) * 25, 0, 5),
  };
}

function extractBtcFeatures({ market, target, spot, prices, previousHistory, now }) {
  const currentPrice = finite(spot?.price);
  const priceToBeat = finite(target?.price);
  const priceDelta = currentPrice - priceToBeat;
  const direction = priceDelta >= 0 ? 1 : -1;
  const predictedOutcome = direction > 0 ? "Up" : "Down";
  const selectedBuyPrice = predictedOutcome === "Up" ? finite(prices.upBuyPrice) : finite(prices.downBuyPrice);
  const selectedBidPrice = predictedOutcome === "Up" ? finite(prices.upBidPrice) : finite(prices.downBidPrice);
  const oppositeBuyPrice = predictedOutcome === "Up" ? finite(prices.downBuyPrice) : finite(prices.upBuyPrice);
  const selectedDepthShares = predictedOutcome === "Up" ? finite(prices.upDepthShares) : finite(prices.downDepthShares);
  const distanceBps = priceToBeat > 0 ? Math.abs(((currentPrice / priceToBeat) - 1) * 10_000) : 0;
  const signedDistanceBps = distanceBps;
  const momentum = computeMomentumFeatures({ currentPrice, priceToBeat, previousHistory, now });
  const book = calculateBookDiagnostics(prices);
  const upDepthDiagnostics = prices.upDepthDiagnostics || {};
  const downDepthDiagnostics = prices.downDepthDiagnostics || {};
  const selectedSpreadCents = predictedOutcome === "Up" ? book.upSpreadCents : book.downSpreadCents;
  const selectedBookImbalance = predictedOutcome === "Up" ? book.upBookImbalance : book.downBookImbalance;
  const upDepthPressure = finite(upDepthDiagnostics.bidAskPressure);
  const downDepthPressure = finite(downDepthDiagnostics.bidAskPressure);
  const selectedDepthPressure = predictedOutcome === "Up" ? upDepthPressure : downDepthPressure;
  const oppositeDepthPressure = predictedOutcome === "Up" ? downDepthPressure : upDepthPressure;
  const sideDepthAdvantage = selectedDepthPressure - oppositeDepthPressure;
  const selectedMicropriceEdgeCents = predictedOutcome === "Up"
    ? finite(upDepthDiagnostics.micropriceEdgeCents)
    : finite(downDepthDiagnostics.micropriceEdgeCents);
  const selectedAskSlopeCents = predictedOutcome === "Up"
    ? finite(upDepthDiagnostics.askSlopeCents)
    : finite(downDepthDiagnostics.askSlopeCents);
  const selectedMicroprice = predictedOutcome === "Up" ? book.upMicroprice : book.downMicroprice;
  const selectedMid = selectedBuyPrice && selectedBidPrice ? (selectedBuyPrice + selectedBidPrice) / 2 : 0;
  const micropriceConfirmation = selectedMid > 0 ? (selectedMicroprice - selectedMid) * 100 : 0;
  const marketAgreement = selectedBuyPrice > 0 && oppositeBuyPrice > 0 ? selectedBuyPrice - oppositeBuyPrice : 0;
  const timeLeftSec = Math.max(0, Math.round((finite(market?.windowEndMs, now) - now) / 1000));
  const secondsIntoWindow = Math.max(0, Math.round((now - finite(market?.windowStartMs, now)) / 1000));
  const timePressure = clamp((300 - timeLeftSec) / 300, 0, 1);
  const signedMomentum15Bps = direction * momentum.momentum15Bps;
  const signedMomentum30Bps = direction * momentum.momentum30Bps;
  const signedMomentum60Bps = direction * momentum.momentum60Bps;

  return {
    currentPrice,
    priceToBeat,
    priceDelta,
    priceDeltaPercent: priceToBeat > 0 ? (priceDelta / priceToBeat) * 100 : 0,
    predictedOutcome,
    direction,
    selectedBuyPrice,
    selectedBidPrice,
    selectedDepthShares,
    distanceBps,
    signedDistanceBps,
    signedMomentum15Bps,
    signedMomentum30Bps,
    signedMomentum60Bps,
    momentum15Bps: momentum.momentum15Bps,
    momentum30Bps: momentum.momentum30Bps,
    momentum60Bps: momentum.momentum60Bps,
    volatility60Bps: momentum.volatility60Bps,
    volatilityAdjustedDistance: momentum.volatilityAdjustedDistance,
    selectedSpreadCents,
    selectedBookImbalance,
    selectedDepthPressure,
    oppositeDepthPressure,
    sideDepthAdvantage,
    selectedMicropriceEdgeCents,
    selectedAskSlopeCents,
    micropriceConfirmation,
    marketAgreement,
    yesNoAskCost: book.yesNoAskCost,
    bidCost: book.bidCost,
    bookAgePenalty: book.bookAgePenalty,
    askCostPenalty: book.askCostPenalty,
    spreadPenalty: clamp(selectedSpreadCents / 4, 0, 5),
    timeLeftSec,
    secondsIntoWindow,
    upSpreadCents: book.upSpreadCents,
    downSpreadCents: book.downSpreadCents,
    upBookImbalance: book.upBookImbalance,
    downBookImbalance: book.downBookImbalance,
    upDepthPressure,
    downDepthPressure,
    upAskDepth5: finite(upDepthDiagnostics.askDepth5),
    downAskDepth5: finite(downDepthDiagnostics.askDepth5),
    upBidDepth5: finite(upDepthDiagnostics.bidDepth5),
    downBidDepth5: finite(downDepthDiagnostics.bidDepth5),
    upMicropriceEdgeCents: finite(upDepthDiagnostics.micropriceEdgeCents),
    downMicropriceEdgeCents: finite(downDepthDiagnostics.micropriceEdgeCents),
    upAskSlopeCents: finite(upDepthDiagnostics.askSlopeCents),
    downAskSlopeCents: finite(downDepthDiagnostics.askSlopeCents),
  };
}

function predictProbability(features, model = DEFAULT_MODEL) {
  const weights = model?.weights || DEFAULT_MODEL.weights;
  let logit = finite(model?.bias, DEFAULT_MODEL.bias);
  for (const [name, weight] of Object.entries(weights)) {
    logit += finite(features[name]) * finite(weight);
  }
  const probabilityUp = features.direction > 0 ? sigmoid(logit) : 1 - sigmoid(logit);
  const selectedProbability = clamp(features.direction > 0 ? probabilityUp : 1 - probabilityUp, 0.01, 0.99);
  return {
    probabilityUp: clamp(probabilityUp, 0.01, 0.99),
    probabilityDown: clamp(1 - probabilityUp, 0.01, 0.99),
    selectedProbability,
    confidence: selectedProbability * 100,
  };
}

function classifyRank({ confidence, edge, entryPrice, spreadCents }) {
  if (confidence >= 88 && edge >= 0.14 && entryPrice <= 0.72 && spreadCents <= 2) return "A+";
  if (confidence >= 84 && edge >= 0.11 && entryPrice <= 0.78 && spreadCents <= 3) return "A";
  if (confidence >= 82 && edge >= 0.10 && entryPrice <= 0.78 && spreadCents <= 3) return "B";
  if (confidence >= 75 && edge >= 0.07 && entryPrice <= 0.82 && spreadCents <= 4) return "C";
  return "SKIP";
}

function evaluateEv({ selectedProbability, selectedBuyPrice, feeRate = 0.07, slippageBuffer = 0.003 }) {
  const entry = finite(selectedBuyPrice);
  if (entry <= 0) {
    return { grossEdge: 0, feeEstimate: 0, feeAdjustedEdge: 0, breakEvenProbability: 1 };
  }
  const feeEstimate = feeRate * entry * (1 - entry);
  const grossEdge = selectedProbability - entry;
  const feeAdjustedEdge = grossEdge - feeEstimate - slippageBuffer;
  return {
    grossEdge,
    feeEstimate,
    feeAdjustedEdge,
    breakEvenProbability: entry + feeEstimate + slippageBuffer,
  };
}

function evaluateMomentumAlignment(features) {
  const votes = [features.signedDistanceBps, features.signedMomentum15Bps, features.signedMomentum30Bps].map((value) => {
    if (value > 0) return 1;
    if (value < 0) return -1;
    return 0;
  });
  const opposed = votes.filter((value) => value < 0).length;
  return {
    allowed: opposed <= 1,
    opposed,
    votes,
    reason: opposed <= 1 ? "" : "momentum_against_signal",
  };
}

function buildCalibrationReport(signals = []) {
  const settled = signals.filter((signal) => signal.status === "paper_win" || signal.status === "paper_loss");
  const buckets = CONFIDENCE_BUCKETS.map((bucket) => {
    const rows = settled.filter((signal) => finite(signal.confidence) >= bucket.min && finite(signal.confidence) < bucket.max);
    const wins = rows.filter((signal) => signal.status === "paper_win").length;
    const losses = rows.length - wins;
    const pnl = rows.reduce((sum, signal) => sum + finite(signal.paperPnlUsd), 0);
    const stake = rows.reduce((sum, signal) => sum + finite(signal.paperStakeUsd), 0);
    const avgEdge = rows.length ? rows.reduce((sum, signal) => sum + finite(signal.feeAdjustedEdge ?? signal.selectedEdgePercent / 100), 0) / rows.length : 0;
    return {
      ...bucket,
      count: rows.length,
      wins,
      losses,
      winRate: rows.length ? (wins / rows.length) * 100 : 0,
      pnl,
      roi: stake ? (pnl / stake) * 100 : 0,
      avgEdge,
    };
  });
  const wins = settled.filter((signal) => signal.status === "paper_win").length;
  const stake = settled.reduce((sum, signal) => sum + finite(signal.paperStakeUsd), 0);
  const pnl = settled.reduce((sum, signal) => sum + finite(signal.paperPnlUsd), 0);
  return {
    generatedAt: new Date().toISOString(),
    settled: settled.length,
    wins,
    losses: settled.length - wins,
    winRate: settled.length ? (wins / settled.length) * 100 : 0,
    roi: stake ? (pnl / stake) * 100 : 0,
    pnl,
    stake,
    reliable: settled.length >= 300,
    buckets,
  };
}

export {
  CONFIDENCE_BUCKETS,
  DEFAULT_MODEL,
  buildCalibrationReport,
  classifyRank,
  evaluateEv,
  evaluateMomentumAlignment,
  extractBtcFeatures,
  predictProbability,
};
