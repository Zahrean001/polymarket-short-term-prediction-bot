# Install V374.7 Full Paper

## Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- npm
- PM2
- Network access to Polymarket Gamma/CLOB/WebSocket and Polymarket RTDS Chainlink feed

This package is paper-only. It has no real-order executor.

For a continuously running paper session, deploy on an Ubuntu VPS with a stable network connection. Use the repository README for VPS sizing, SSH tunneling, firewall guidance, and operational monitoring. Do not copy credentials or prior runtime state into the deployment.

## Clean deployment

```bash
unzip v374.7-direction-only-shadow-fastgrow-full-paper.zip
cd v374.7-direction-only-shadow-fastgrow-full-paper
npm ci
npm run verify:v3747:all
pm2 delete polymarket-main-v3746 polymarket-settlement-observer-v3746 || true
pm2 start ecosystem.config.cjs --update-env
pm2 save
```

Do not copy `btc-paper-state.json`, `paper-session-state.json`, signal, decision, or settlement directories from an older release. V374.7 deliberately starts from clean `server/data-main-v3747` and `server/data-observer-v3747` roots so the comparison is not contaminated.

## Required process state

```bash
pm2 status
curl -fsS http://127.0.0.1:8799/health
curl -fsS http://127.0.0.1:8800/health
curl -fsS http://127.0.0.1:8799/api/v3/effective-config
```

Expected:

- exactly two PM2 processes: `polymarket-main-v3747` and `polymarket-direction-observer-v3747`;
- main role `main_test`, observer role `checkpoint_observer`;
- release `v374.7-direction-only-shadow-fastgrow-full-paper`;
- main `directionShadowObserver.status` is `disabled_for_main`;
- observer direction status becomes `ready` after a qualifying signal;
- `directionShadowExecutionEnabled=false` and `directionShadowAutomaticPromotion=false`;
- probability basis `regime_core_independent_asset_probability_frozen_no_observer_execution`;
- real execution mode `paper_shadow`.

## Do not override

Do not set any of these to `1`:

```text
ANTI_DOWNGRADE_SHADOW_EXECUTION_ENABLED
ANTI_DOWNGRADE_AUTOMATIC_PROMOTION
DIRECTION_SHADOW_EXECUTION_ENABLED
DIRECTION_SHADOW_AUTOMATIC_PROMOTION
ALLOW_SYNTHETIC_BOOK
ALLOW_SYNTHETIC_PRICE
FALLBACK_CAN_OPEN_POSITION
BTC_LEARNING_FALLBACK_MODE
```

Runtime validation intentionally refuses to start if an unsafe override is detected.

## Collect the next evidence bundle

After at least 200 official settlements, or earlier if a severe regression appears:

```bash
bash tools/collect-v3747-results.sh "$HOME"
```

Send both the generated `.tar.gz` and `.sha256`. Keep the main and observer running for the same uninterrupted period; do not edit their JSON/JSONL artifacts.
