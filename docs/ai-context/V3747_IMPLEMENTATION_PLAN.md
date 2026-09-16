# V374.7 Implementation Plan — Applied

## Primary problem solved

The latest V374.6 run is profitable and has 84.21% win rate, but profit growth is fragile because three Lane S losses are much larger than the average win. One average loss erases about 4.35 average wins. The available 19-settlement sample does not identify a safe execution filter: the model's calibrated probability is slightly higher on losses than wins, while the old replay improvement removes 15.79% of entries and is not forward evidence.

The safe next step is therefore not another immediate main-policy mutation. V374.7 keeps the verified execution control and builds causal evidence specifically for direction selection.

## Applied architecture

| Component | Responsibility | Can execute or alter main? |
|---|---|---|
| `polymarket-main-v3747` | Live feed, paper FAK fill, official settlement, frozen V374.5 selection/sizing | Yes, paper execution only |
| `polymarket-direction-observer-v3747` | Settlement learning plus immutable forward direction challenger | No |

Main and observer use separate data roots. The observer reads only the main signal and settlement directories. Runtime validation rejects any shared trading-state path, observer writer in main, shadow execution, automatic promotion, simulation, fallback entry, or real order mode.

## Main anti-downgrade contract

1. The execution strategy remains `v374.5-regime-core-fastgrow-paper`.
2. The observer policy cannot cap main probability. The hard-disabled branch does not call the policy reader and returns the exact asset probability.
3. Scan 500/200/100 ms, eight entries per tick, active-position limit 144, Lane A 8–10%, Lane S 12–15%, and all existing realistic cash/depth/fee/minimum constraints remain unchanged.
4. Direction shadow writes no main decision, position, settlement, or paper-state file.
5. Risk flags are research telemetry only and cannot block, resize, reduce count, or slow scans.

## Direction-only causal protocol

1. Main records a dual-side live order-book snapshot in every eligible filled signal.
2. The observer creates exactly one hash-protected decision per signal, no later than 10 seconds after entry and before window end.
3. A late archive/backfill decision is retained for audit but excluded from forward metrics.
4. Decision features are allowlisted entry-time fields. Settlement/result fields are not read.
5. Historical evidence has a strict cutoff: only settlements finalized before the new signal entry may affect its weights.
6. A challenger flip requires either:
   - three independent contradictory families, including asset probability and price distance; or
   - at least 50 prior forward cohort samples where the baseline direction's Wilson 95% upper bound is below 50%.
7. Official final Polymarket settlement is reconciled only after the immutable decision exists.
8. Flipped-direction PnL is counterfactual unless the opposite-side entry snapshot has exact live price/depth parity; this is labeled explicitly in the report.

## Manual evidence gate

Passing every check creates only a manual-review candidate. It never promotes automatically:

- at least 200 official forward matches;
- forward decision and official-settlement coverage at least 99.5%;
- challenger WR at least 90%;
- Wilson 95% lower bound at least 85%;
- rolling-50 WR at least 90%;
- positive PnL, profit factor at least 2, maximum drawdown at most 25%;
- PnL not below control and drawdown not worse than control;
- at least ten actual direction changes and at least +2 percentage-point WR lift;
- exact execution-parity coverage at least 99.5%;
- three complete profitable 50-trade epochs, each with WR at least 80%.

## Explicit non-goals of this release

- No claim that V374.7 already raises execution WR to 90–100%.
- No confidence-only, Lane-S, correlation, or high-price veto is applied to main.
- No stake reduction or throughput reduction is used to manufacture a higher displayed WR.
- No synthetic market data, proxy settlement, future outcome, or retrospective row is counted as forward proof.
