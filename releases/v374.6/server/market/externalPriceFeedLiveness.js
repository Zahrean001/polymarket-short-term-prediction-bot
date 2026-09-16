function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeSymbols(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean))];
}

function readTimestamp(source, symbol) {
  if (source instanceof Map) return finite(source.get(symbol), 0);
  if (source && typeof source === "object") return finite(source[symbol], 0);
  return 0;
}

function ageMs(now, timestamp) {
  return timestamp > 0 ? now - timestamp : Number.POSITIVE_INFINITY;
}

function maximumTimestamp(source, symbols = []) {
  return symbols.reduce((latest, symbol) => Math.max(latest, readTimestamp(source, symbol)), 0);
}

function hasTimestampSource(source) {
  return source instanceof Map || (source && typeof source === "object");
}

function evaluateExternalPriceFeedLiveness(options = {}) {
  const enabled = options.enabled !== false;
  const now = finite(options.now, Date.now());
  const connectedAtMs = finite(options.connectedAtMs, 0);
  const staleAfterMs = Math.max(250, finite(options.staleAfterMs, 4_500));
  const startupGraceMs = Math.max(staleAfterMs, finite(options.startupGraceMs, 6_000));
  const futureToleranceMs = Math.max(0, finite(options.futureToleranceMs, 2_000));
  const transportStaleAfterMs = Math.max(staleAfterMs, finite(options.transportStaleAfterMs, 12_000));
  const publisherStaleAfterMs = Math.max(staleAfterMs, finite(options.publisherStaleAfterMs, 15_000));
  const socketState = String(options.socketState || "closed").toLowerCase();
  const requiredSymbols = normalizeSymbols(options.requiredSymbols);
  const connectionAgeMs = ageMs(now, connectedAtMs);
  const derivedTransportActivityAtMs = maximumTimestamp(options.lastArrivalBySymbol, requiredSymbols);
  const lastTransportActivityAtMs = finite(options.lastTransportActivityAtMs, derivedTransportActivityAtMs);
  const lastValidPublisherAtMs = finite(options.lastValidPublisherAtMs, derivedTransportActivityAtMs);
  const transportAgeMs = ageMs(now, lastTransportActivityAtMs);
  const publisherAgeMs = ageMs(now, lastValidPublisherAtMs);

  if (!enabled) {
    return {
      enabled: false,
      healthy: true,
      reconnectRequired: false,
      reason: "external_price_watchdog_disabled",
      socketState,
      connectionAgeMs,
      transportAgeMs: Number.isFinite(transportAgeMs) ? transportAgeMs : null,
      publisherAgeMs: Number.isFinite(publisherAgeMs) ? publisherAgeMs : null,
      symbols: [],
    };
  }

  if (socketState !== "open") {
    return {
      enabled: true,
      healthy: false,
      reconnectRequired: false,
      reason: `external_price_socket_${socketState}`,
      socketState,
      connectionAgeMs,
      symbols: [],
    };
  }

  const symbols = requiredSymbols.map((symbol) => {
    const lastArrivalAtMs = readTimestamp(options.lastArrivalBySymbol, symbol);
    const latestEventAtMs = readTimestamp(options.latestEventBySymbol, symbol);
    const arrivalAgeMs = ageMs(now, lastArrivalAtMs);
    const eventAgeMs = ageMs(now, latestEventAtMs);
    const lastEventProgressAtMs = hasTimestampSource(options.lastEventProgressBySymbol)
      ? readTimestamp(options.lastEventProgressBySymbol, symbol)
      : lastArrivalAtMs;
    const eventProgressAgeMs = ageMs(now, lastEventProgressAtMs);
    const arrivalMissing = lastArrivalAtMs <= 0;
    const eventMissing = latestEventAtMs <= 0;
    const arrivalSilent = !arrivalMissing && arrivalAgeMs > staleAfterMs;
    const eventStale = !eventMissing && eventAgeMs > staleAfterMs;
    const eventProgressStale = lastEventProgressAtMs <= 0 || eventProgressAgeMs > publisherStaleAfterMs;
    const eventFromFuture = !eventMissing && eventAgeMs < -futureToleranceMs;
    return {
      symbol,
      lastArrivalAtMs: lastArrivalAtMs || null,
      latestEventAtMs: latestEventAtMs || null,
      arrivalAgeMs: Number.isFinite(arrivalAgeMs) ? arrivalAgeMs : null,
      eventAgeMs: Number.isFinite(eventAgeMs) ? eventAgeMs : null,
      lastEventProgressAtMs: lastEventProgressAtMs || null,
      eventProgressAgeMs: Number.isFinite(eventProgressAgeMs) ? eventProgressAgeMs : null,
      arrivalMissing,
      eventMissing,
      arrivalSilent,
      eventStale,
      eventProgressStale,
      eventFromFuture,
      healthy: !arrivalMissing && !eventMissing && !arrivalSilent && !eventStale && !eventProgressStale && !eventFromFuture,
    };
  });

  const inStartupGrace = connectedAtMs <= 0 || connectionAgeMs < startupGraceMs;
  const transportSilent = lastTransportActivityAtMs <= 0 || transportAgeMs > transportStaleAfterMs;
  const publisherSilent = lastValidPublisherAtMs <= 0 || publisherAgeMs > publisherStaleAfterMs;
  const publisherProgressFrozenSymbols = !transportSilent && !publisherSilent
    ? symbols.filter((item) => (
        item.lastEventProgressAtMs > 0
          ? item.eventProgressAgeMs > publisherStaleAfterMs
          : connectionAgeMs > publisherStaleAfterMs
      )).map((item) => item.symbol)
    : [];
  const publisherProgressFrozen = publisherProgressFrozenSymbols.length > 0;
  const unhealthy = symbols.filter((item) => !item.healthy);
  let reason = "external_price_feed_live";
  if (inStartupGrace && unhealthy.length) reason = "external_price_feed_startup_grace";
  else if (transportSilent) reason = "external_price_transport_silent";
  else if (publisherSilent) reason = "external_price_chainlink_topic_silent";
  else if (publisherProgressFrozen) {
    reason = `external_price_required_symbol_progress_frozen:${publisherProgressFrozenSymbols[0]}`;
  }
  else if (unhealthy.some((item) => item.eventFromFuture)) {
    reason = `external_price_event_timestamp_future:${unhealthy.find((item) => item.eventFromFuture).symbol}`;
  } else if (unhealthy.some((item) => item.arrivalSilent)) {
    reason = `external_price_symbol_silent:${unhealthy.find((item) => item.arrivalSilent).symbol}`;
  } else if (unhealthy.some((item) => item.eventStale)) {
    reason = `external_price_event_stale:${unhealthy.find((item) => item.eventStale).symbol}`;
  } else if (unhealthy.some((item) => item.arrivalMissing || item.eventMissing)) {
    reason = `external_price_symbol_missing:${unhealthy.find((item) => item.arrivalMissing || item.eventMissing).symbol}`;
  }

  return {
    enabled: true,
    healthy: unhealthy.length === 0,
    reconnectRequired: !inStartupGrace && (transportSilent || publisherSilent || publisherProgressFrozen),
    reason,
    socketState,
    connectionAgeMs,
    staleAfterMs,
    startupGraceMs,
    futureToleranceMs,
    transportStaleAfterMs,
    publisherStaleAfterMs,
    lastTransportActivityAtMs: lastTransportActivityAtMs || null,
    lastValidPublisherAtMs: lastValidPublisherAtMs || null,
    transportAgeMs: Number.isFinite(transportAgeMs) ? transportAgeMs : null,
    publisherAgeMs: Number.isFinite(publisherAgeMs) ? publisherAgeMs : null,
    transportSilent,
    publisherSilent,
    publisherProgressFrozen,
    publisherProgressFrozenSymbols,
    symbols,
  };
}

export { evaluateExternalPriceFeedLiveness, normalizeSymbols };
