const PRICE_EPSILON = 1e-9;
const ECONOMIC_DEPTH_LEVELS = 5;

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function eventTime(value, fallback = Date.now()) {
  const numeric = finite(value, 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeLevels(levels = [], side = "ask", limit = 200) {
  const byPrice = new Map();
  for (const raw of Array.isArray(levels) ? levels : []) {
    const price = finite(raw?.price, 0);
    const size = finite(raw?.size, 0);
    if (price <= 0 || price >= 1 || size <= 0) continue;
    byPrice.set(price.toFixed(10), { price, size });
  }
  return [...byPrice.values()]
    .sort((left, right) => side === "bid" ? right.price - left.price : left.price - right.price)
    .slice(0, limit);
}

function best(levels = []) {
  return Array.isArray(levels) && levels.length ? levels[0] : null;
}

function inspectBook(book = {}) {
  const bids = normalizeLevels(book.bids, "bid");
  const asks = normalizeLevels(book.asks, "ask");
  const bestBid = best(bids);
  const bestAsk = best(asks);
  let integrityReason = "ok";
  if (!bids.length || !asks.length) integrityReason = "missing_side";
  else if (bestBid.price >= bestAsk.price - PRICE_EPSILON) integrityReason = "crossed_or_zero_spread";
  return {
    bids,
    asks,
    bestBid,
    bestAsk,
    spread: bestBid && bestAsk ? bestAsk.price - bestBid.price : null,
    valid: integrityReason === "ok",
    integrityReason,
  };
}

function economicBookFingerprint(book = {}, depth = ECONOMIC_DEPTH_LEVELS) {
  const inspected = inspectBook(book);
  const encode = (levels) => levels
    .slice(0, Math.max(1, finite(depth, ECONOMIC_DEPTH_LEVELS)))
    .map((level) => `${level.price.toFixed(10)}@${level.size.toFixed(8)}`)
    .join(",");
  return `b:${encode(inspected.bids)}|a:${encode(inspected.asks)}`;
}

function attachEconomicRevision(next = {}, current = null, resetEpochMs = 0) {
  const fingerprint = economicBookFingerprint(next);
  const previousFingerprint = String(current?.economicFingerprint || "");
  const previousRevision = Math.max(0, Math.trunc(finite(current?.economicRevision, 0)));
  const changed = !current || fingerprint !== previousFingerprint;
  const economicRevision = changed ? previousRevision + 1 : previousRevision;
  const economicEpochMs = Math.max(
    1,
    Math.trunc(finite(current?.economicEpochMs, resetEpochMs || next.receivedAt || Date.now())),
  );
  return {
    ...next,
    economicFingerprint: fingerprint,
    economicRevision,
    economicEpochMs,
    economicGeneration: `${economicEpochMs}:${economicRevision}`,
    economicChangedAt: changed
      ? Math.max(1, Math.trunc(finite(next.receivedAt, Date.now())))
      : finite(current?.economicChangedAt, null),
  };
}

function buildBookSnapshot(rawBook = {}, options = {}) {
  const receivedAt = eventTime(options.receivedAt, Date.now());
  const tokenId = String(options.tokenId || rawBook.asset_id || rawBook.token_id || "");
  const inspected = inspectBook(rawBook);
  const current = options.current || null;
  const lastEventTimestamp = eventTime(rawBook.timestamp, receivedAt);
  if (current && lastEventTimestamp + 1 < finite(current.lastEventTimestamp, 0)) return current;
  return attachEconomicRevision({
    ...rawBook,
    tokenId,
    bids: inspected.bids,
    asks: inspected.asks,
    source: options.source || "unknown",
    receivedAt,
    lastEventTimestamp,
    topConfirmedAt: receivedAt,
    complete: inspected.valid,
    resyncRequired: !inspected.valid,
    integrityReason: inspected.integrityReason,
    bestBidHint: inspected.bestBid?.price ?? null,
    bestAskHint: inspected.bestAsk?.price ?? null,
  }, current, receivedAt);
}

function setLevel(levels, side, price, size) {
  const normalized = normalizeLevels(levels, side);
  const key = price.toFixed(10);
  const byPrice = new Map(normalized.map((level) => [level.price.toFixed(10), level]));
  if (size <= 0) byPrice.delete(key);
  else byPrice.set(key, { price, size });
  return normalizeLevels([...byPrice.values()], side);
}

function hintMatches(actual, hinted) {
  if (hinted === null) return true;
  if (!actual) return hinted === 0;
  return Math.abs(actual.price - hinted) <= PRICE_EPSILON;
}

function normalizeHint(value) {
  if (value === null || value === undefined || value === "") return null;
  return finite(value, 0);
}

function applyPriceChanges(current, rows = [], options = {}) {
  const tokenId = String(options.tokenId || current?.tokenId || "");
  const receivedAt = eventTime(options.receivedAt, Date.now());
  const eventTimestamp = eventTime(options.eventTimestamp, receivedAt);
  if (!current || !tokenId) {
    return {
      tokenId,
      bids: [],
      asks: [],
      source: options.source || "ws",
      receivedAt,
      lastEventTimestamp: eventTimestamp,
      complete: false,
      resyncRequired: true,
      integrityReason: "delta_before_snapshot",
    };
  }
  if (eventTimestamp + 1 < finite(current.lastEventTimestamp, 0)) return current;

  let bids = normalizeLevels(current.bids, "bid");
  let asks = normalizeLevels(current.asks, "ask");
  let bestBidHint = null;
  let bestAskHint = null;
  let malformed = false;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (String(row?.asset_id || tokenId) !== tokenId) continue;
    const side = String(row?.side || "").trim().toUpperCase();
    const price = finite(row?.price, 0);
    const size = finite(row?.size, 0);
    if ((side !== "BUY" && side !== "SELL") || price <= 0 || price >= 1 || size < 0) {
      malformed = true;
      continue;
    }
    if (side === "BUY") bids = setLevel(bids, "bid", price, size);
    else asks = setLevel(asks, "ask", price, size);
    const rowBidHint = normalizeHint(row?.best_bid);
    const rowAskHint = normalizeHint(row?.best_ask);
    if (rowBidHint !== null) bestBidHint = rowBidHint;
    if (rowAskHint !== null) bestAskHint = rowAskHint;
  }

  const inspected = inspectBook({ bids, asks });
  const hintMismatch = !hintMatches(inspected.bestBid, bestBidHint) || !hintMatches(inspected.bestAsk, bestAskHint);
  const integrityReason = malformed
    ? "malformed_delta"
    : hintMismatch
      ? "best_quote_mismatch"
      : inspected.integrityReason;
  const valid = inspected.valid && !malformed && !hintMismatch;
  return attachEconomicRevision({
    ...current,
    tokenId,
    bids: inspected.bids,
    asks: inspected.asks,
    source: options.source || current.source || "ws",
    receivedAt,
    lastEventTimestamp: eventTimestamp,
    complete: valid,
    resyncRequired: !valid,
    integrityReason,
    bestBidHint,
    bestAskHint,
  }, current);
}

function applyBestBidAskHint(current, hint = {}, options = {}) {
  const tokenId = String(options.tokenId || current?.tokenId || "");
  const receivedAt = eventTime(options.receivedAt, Date.now());
  const eventTimestamp = eventTime(options.eventTimestamp, receivedAt);
  if (!current || !tokenId) {
    return {
      tokenId,
      bids: [],
      asks: [],
      source: options.source || "ws",
      receivedAt,
      lastEventTimestamp: eventTimestamp,
      complete: false,
      resyncRequired: true,
      integrityReason: "top_hint_before_snapshot",
    };
  }
  if (eventTimestamp + 1 < finite(current.lastEventTimestamp, 0)) return current;
  const inspected = inspectBook(current);
  const bestBidHint = normalizeHint(hint.best_bid ?? hint.bestBid);
  const bestAskHint = normalizeHint(hint.best_ask ?? hint.bestAsk);
  const matches = hintMatches(inspected.bestBid, bestBidHint) && hintMatches(inspected.bestAsk, bestAskHint);
  return {
    ...current,
    bestBidHint,
    bestAskHint,
    topConfirmedAt: receivedAt,
    lastEventTimestamp: eventTimestamp,
    complete: inspected.valid && matches,
    resyncRequired: !inspected.valid || !matches,
    integrityReason: !inspected.valid ? inspected.integrityReason : matches ? "ok" : "best_quote_mismatch",
  };
}

function updateBookTickSize(current, tickSize, options = {}) {
  const numericTick = finite(tickSize, 0);
  if (!current || numericTick <= 0) return current;
  return {
    ...current,
    tick_size: String(tickSize),
    minimum_tick_size: numericTick,
    topConfirmedAt: eventTime(options.receivedAt, Date.now()),
  };
}

function isBookUsable(book = {}) {
  if (!book || book.resyncRequired || !book.complete) return false;
  return inspectBook(book).valid;
}

export {
  ECONOMIC_DEPTH_LEVELS,
  PRICE_EPSILON,
  applyBestBidAskHint,
  applyPriceChanges,
  buildBookSnapshot,
  economicBookFingerprint,
  inspectBook,
  isBookUsable,
  normalizeLevels,
  updateBookTickSize,
};
