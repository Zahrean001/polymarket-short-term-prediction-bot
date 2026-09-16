# V374.7 Verification Report

## Build identity

- Release: `v374.7-direction-only-shadow-fastgrow-full-paper`
- Main policy: `v3745-frozen-control`
- Strategy version: `v374.5-regime-core-fastgrow-paper`
- Package mode: paper-only, live market feed, official Polymarket settlement
- Processes: `polymarket-main-v3747` and `polymarket-direction-observer-v3747`

## Evidence source verified

- Input archive: `v374.6-run-data(1).zip`
- SHA-256: `26e3b237e035d62ca7db9fce6a927adb9fb83ff43ec06dd80f3800a96c0de6ac`
- 20 main signals and 19 official real filled unique settlements
- Baseline: 16 win / 3 loss, WR 84.210526%, PnL +$5.31949913, PF 1.227238, DD 32.387787%
- No same-run replay is claimed as forward proof

## Verification results

| Check | Result |
|---|---:|
| Runtime configuration semantics | PASS |
| Frozen V374.5 execution-core hashes | PASS — 23/23 |
| JavaScript/CJS/MJS syntax | PASS — 81 files |
| JSON parsing | PASS — 3 files |
| Sequential unit/regression tests | PASS — 117/117 across 22 files |
| Local relative import resolution | PASS — 114 imports |
| Vite production build | PASS — 16 modules |
| Main process runtime smoke | PASS |
| Settlement + direction observer runtime smoke | PASS |

## Critical regression coverage

- Hard-disabled observer probability performs zero observer-reader calls and returns the exact Static Core probability.
- Runtime rejects shadow execution, automatic promotion, main-side direction writer, shared main/observer paths, synthetic data, fallback entry, simulated latency, and real-order mode.
- Direction decisions are invariant to settlement status, official outcome, final price, settlement timestamp, and PnL fields.
- Exactly one hash-protected decision is persisted per signal.
- Decisions observed after window end are excluded from forward evidence.
- Prior evidence cannot include a settlement finalized after the next signal entry.
- A direction flip requires the documented independent-family or proven-cohort rule.
- Risk flags cannot mutate main direction, stake, entry block, entry count, or scan interval.
- Counterfactual binary PnL uses the same paper fee equation.
- Fallback, synthetic/non-parity, unfilled, and stale-release signals are rejected from the challenger sample.
- Runtime observer test creates a forward decision, later appends an official final settlement, reconciles exactly once, and proves the decision bytes and main source files remain unchanged.
- Observer creates no positions, execution signals, or paper trading state.

## Fastgrow invariants preserved

- Scan 500 ms, hot 200 ms, ultra-hot 100 ms.
- Eight entries per tick and 144 maximum active positions.
- Lane A 8–10%; Lane S 12–15% of current realized equity.
- No fixed USD hard cap, artificial fixed minimum, ATH lock, martingale, recovery multiplier, or new global brake.
- FAK fill, actual market minimum, cash plus fee reserve, observed depth, maximum slippage, 30% unresolved reserve, and one-position-per-slug remain active.

## Honest result boundary

The package is verified to implement the plan and preserve main behavior. It does not yet possess forward production evidence that the direction challenger reaches 90–100% win rate or improves PnL. The challenger remains observer-only until the documented 200-settlement manual gate is satisfied and independently reviewed.

The final source ZIP is additionally rebuilt from the manifest, extracted into a fresh directory, installed with `npm ci`, and reverified before delivery. Its archive SHA-256 is supplied separately.
