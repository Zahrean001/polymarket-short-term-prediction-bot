# V374.7 Forward Validation Protocol

## Objective

Measure whether the direction-only challenger improves accuracy and profit quality without changing main throughput, stake, timing, or execution realism.

## Valid sample contract

A row is eligible only when all are true:

- created by `main_test` on release V374.7 and strategy V374.5 frozen control;
- `sourceType=real_market`;
- actual paper execution is `filled` or `partial_fill`, stake is positive, and `realParityEligible=true`;
- direction decision was persisted within 10 seconds of entry and before window end;
- decision used the embedded live, non-synthetic, dual-side entry snapshot;
- outcome is a final official Polymarket settlement after decision creation;
- signal ID is unique.

Proxy, fallback, synthetic, unfilled, rejected, late-backfill, duplicate, corrupted, or future-informed records are excluded.

## Minimum run

- Preferred decision point: at least 200 matched official settlements.
- Also require three complete 50-trade epochs.
- Run main and observer concurrently and continuously.
- Do not reset equity, edit state, copy prior data, or restart only one process unless documenting an infrastructure failure.

## Control and challenger

- Control is the direction actually executed by frozen main.
- Challenger uses the same opportunity, entry timestamp, and stake.
- If direction is unchanged, actual execution PnL is used.
- If direction flips, PnL is explicitly counterfactual unless the captured opposite-side ask and depth prove exact entry parity.
- WR comparisons remain valid as direction research; PnL promotion additionally requires 99.5% exact execution-parity coverage.

## Gate for manual review only

All of these must pass simultaneously: 200 samples, 99.5% decision coverage, 99.5% official match coverage, WR 90%, Wilson lower 85%, rolling-50 WR 90%, PF 2, DD at most 25%, no PnL downgrade, no drawdown downgrade, ten flips, +2 pp accuracy lift, 99.5% execution parity, and three profitable 50-trade epochs with each epoch WR at least 80%.

Passing does not change main automatically. A new reviewed package and a new forward A/B phase are required before any execution promotion.

## Early-stop conditions

Stop and preserve all artifacts if any occurs:

- main execution settings or config hash change unexpectedly;
- observer writes a position, main signal, or paper trading state;
- synthetic/fallback data becomes entry eligible;
- official settlement ordering or decision immutability fails;
- sustained feed errors, corrupted JSONL, or missing signal/settlement coverage;
- main performance materially regresses versus the V374.6 evidence baseline.
