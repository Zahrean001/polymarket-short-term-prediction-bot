import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAntiDowngradeEvidence,
  uniqueEvidenceRows,
} from "../server/research/antiDowngradeEvidence.js";

function settlement(index, status = "paper_win", overrides = {}) {
  const entryMs = 1_780_000_000_000 + index * 600_000;
  return {
    id: `v3746-evidence-${index}`,
    slug: `btc-updown-5m-${index}`,
    botRole: "main_test",
    strategyVersion: "v374.5-regime-core-fastgrow-paper",
    releaseVersion: "v374.6-anti-downgrade-evidence-full-paper",
    sourceType: "real_market",
    status,
    officialSettlementUsed: true,
    settlementSource: "official_poly",
    executionStatus: "filled",
    realParityEligible: true,
    learningEligible: true,
    filledStakeUsd: 6,
    paperStakeUsd: 6,
    paperPnlUsd: status === "paper_win" ? 3 : -6,
    symbol: "BTC",
    direction: "UP",
    confidence: 97,
    averageFillPrice: 0.60,
    accountEquity: 40,
    entryLane: "S",
    bookConfirmationScore: 0.25,
    legacyCalibrationTelemetry: { netEdge: 0.05 },
    regimeCorePolicy: { eligible: true },
    independentAssetEdgePolicy: { eligible: true },
    eligibilityEpisode: { correlation: { correlationIndex: 0 } },
    time: new Date(entryMs).toISOString(),
    settledAt: new Date(entryMs + 300_000).toISOString(),
    ...overrides,
  };
}

test("anti-downgrade evidence accepts only official real filled unique main settlements", () => {
  const valid = settlement(1);
  const rows = [
    valid,
    { ...valid },
    settlement(2, "paper_win", { sourceType: "synthetic" }),
    settlement(3, "paper_win", { executionStatus: "unfilled", filledStakeUsd: 0 }),
    settlement(4, "paper_win", { officialSettlementUsed: false, settlementSource: "proxy_binance" }),
    settlement(5, "paper_win", { botRole: "checkpoint_observer" }),
  ];
  assert.equal(uniqueEvidenceRows(rows).length, 1);
});

test("loss and correlation controls remain shadow-only and use no look-ahead settlements", () => {
  const rows = [
    settlement(1, "paper_loss"),
    settlement(2, "paper_loss"),
    settlement(3, "paper_loss", {
      averageFillPrice: 0.82,
      bookConfirmationScore: 0.05,
      legacyCalibrationTelemetry: { netEdge: -0.01 },
      eligibilityEpisode: {
        correlation: { correlationIndex: 1, correlatedOpenReservedUsd: 7 },
      },
    }),
    settlement(4, "paper_win"),
  ];
  const evidence = buildAntiDowngradeEvidence(rows, { startEquityUsd: 40 });
  assert.equal(evidence.observerOnly, true);
  assert.equal(evidence.executionEligible, false);
  assert.equal(evidence.automaticPromotion, false);
  assert.equal(evidence.source.syntheticDataUsed, false);
  assert.ok(evidence.counters.directionLossTrigger >= 1);
  assert.ok(evidence.counters.laneSCappedToLaneA >= 1);
  assert.ok(evidence.counters.correlatedReserveCapped >= 1);
  assert.equal(evidence.counters.highPriceWeakBookRejected, 1);
  assert.equal(evidence.promotionEligible, false);
  const third = evidence.decisionDigest.find((row) => row.id === "v3746-evidence-3");
  assert.equal(third.accepted, false);
  assert.ok(third.reasons.includes("high_price_weak_book_negative_legacy_edge_shadow_veto"));
});

test("manual promotion gate needs 200 factual samples and every no-downgrade check", () => {
  const rows = Array.from({ length: 200 }, (_, offset) => {
    const index = offset + 1;
    const won = index % 5 !== 0;
    return settlement(index, won ? "paper_win" : "paper_loss", {
      entryLane: "A",
      filledStakeUsd: 1,
      paperStakeUsd: 1,
      paperPnlUsd: won ? 0.50 : -1,
      averageFillPrice: 0.60,
    });
  });
  const evidence = buildAntiDowngradeEvidence(rows, { startEquityUsd: 40 });
  assert.equal(evidence.baseline.samples, 200);
  assert.equal(evidence.challenger.samples, 200);
  assert.equal(evidence.challenger.winRate, 80);
  assert.equal(evidence.paired.coveragePct, 100);
  assert.equal(evidence.promotionEligible, true);
  assert.equal(evidence.automaticPromotion, false);
  assert.equal(Object.values(evidence.checks).every(Boolean), true);
});
