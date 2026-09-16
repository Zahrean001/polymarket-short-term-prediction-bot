function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeRtdsSymbol(value = "") {
  const symbol = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\/USD$/, "")
    .replace(/USDT$/, "")
    .replace(/USD$/, "");
  return symbol === "XBT" ? "BTC" : symbol;
}

function normalizeRtdsTimestamp(value) {
  if (typeof value === "string" && /[a-z:-]/i.test(value)) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  const numeric = finite(value, 0);
  if (numeric <= 0) return 0;
  if (numeric >= 1e17) return Math.round(numeric / 1e6); // nanoseconds
  if (numeric >= 1e14) return Math.round(numeric / 1e3); // microseconds
  if (numeric < 1e11) return Math.round(numeric * 1e3); // seconds
  return Math.round(numeric); // milliseconds
}

function parseRtdsCryptoMessage(message = {}, allowedSymbols = []) {
  if (Array.isArray(message)) {
    return message.flatMap((row) => parseRtdsCryptoMessage(row, allowedSymbols));
  }
  const topic = String(message?.topic || "").toLowerCase();
  if (topic !== "crypto_prices_chainlink" && topic !== "crypto_prices") return [];
  const source = topic === "crypto_prices_chainlink"
    ? "polymarket_chainlink_rtds"
    : "polymarket_binance_rtds_context";
  const allow = new Set((Array.isArray(allowedSymbols) ? allowedSymbols : [])
    .map((value) => String(value).toUpperCase())
    .filter(Boolean));
  const payload = message?.payload || {};
  const rows = Array.isArray(payload.data) ? payload.data : [payload];
  return rows.flatMap((row) => {
    const symbol = normalizeRtdsSymbol(row?.symbol);
    const price = finite(row?.value ?? row?.price, 0);
    const timestamp = normalizeRtdsTimestamp(row?.timestamp ?? payload?.timestamp ?? message?.timestamp);
    if (!symbol || price <= 0 || timestamp <= 0 || (allow.size && !allow.has(symbol))) return [];
    return [{ source, symbol, price, timestamp }];
  });
}

export { normalizeRtdsSymbol, normalizeRtdsTimestamp, parseRtdsCryptoMessage };
