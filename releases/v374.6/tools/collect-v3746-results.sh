#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN_DATA_DIR="${MAIN_DATA_DIR:-$ROOT_DIR/server/data-main-v3746}"
OBSERVER_DATA_DIR="${OBSERVER_DATA_DIR:-$ROOT_DIR/server/data-observer-v3746}"
MAIN_PORT="${CHALLENGER_BOT_PORT:-8799}"
OUTPUT_DIR="${1:-$HOME}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="v3746-complete-results-$STAMP"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${NAME}.XXXXXX")"
STAGE_DIR="$WORK_DIR/$NAME"
ARCHIVE="$OUTPUT_DIR/$NAME.tar.gz"

cleanup() {
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT

if [[ ! -d "$MAIN_DATA_DIR" ]]; then
  printf 'Main data directory not found: %s\n' "$MAIN_DATA_DIR" >&2
  exit 1
fi

mkdir -p "$STAGE_DIR" "$OUTPUT_DIR"
cp -a "$MAIN_DATA_DIR" "$STAGE_DIR/data-main-v3746"
if [[ -d "$OBSERVER_DATA_DIR" ]]; then
  cp -a "$OBSERVER_DATA_DIR" "$STAGE_DIR/data-observer-v3746"
fi

pm2 logs polymarket-main-v3746 --lines 10000 --nostream > "$STAGE_DIR/main-pm2.log" 2>&1 || true
pm2 logs polymarket-settlement-observer-v3746 --lines 10000 --nostream > "$STAGE_DIR/observer-pm2.log" 2>&1 || true
pm2 describe polymarket-main-v3746 > "$STAGE_DIR/main-pm2-describe.txt" 2>&1 || true
pm2 describe polymarket-settlement-observer-v3746 > "$STAGE_DIR/observer-pm2-describe.txt" 2>&1 || true

curl -fsS "http://127.0.0.1:$MAIN_PORT/health" > "$STAGE_DIR/health.json" || true
curl -fsS "http://127.0.0.1:$MAIN_PORT/api/v3/effective-config" > "$STAGE_DIR/effective-config.json" || true
curl -fsS "http://127.0.0.1:$MAIN_PORT/api/v3/account" > "$STAGE_DIR/account.json" || true
curl -fsS "http://127.0.0.1:$MAIN_PORT/api/v3/ui-state" > "$STAGE_DIR/ui-state.json" || true

cp "$ROOT_DIR/package.json" "$ROOT_DIR/ecosystem.config.cjs" "$ROOT_DIR/MANIFEST.sha256" "$STAGE_DIR/"
tar -czf "$ARCHIVE" -C "$WORK_DIR" "$NAME"
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"

printf '%s\n%s\n' "$ARCHIVE" "$ARCHIVE.sha256"
