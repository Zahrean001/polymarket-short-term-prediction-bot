import crypto from "node:crypto";

function canonicalPredictionPayload(prediction = {}, options = {}) {
  const maxSignals = Math.max(1, Math.trunc(Number(options.maxSignals) || 500));
  const maxHistory = Math.max(1, Math.trunc(Number(options.maxHistory) || 500));
  return {
    version: 1,
    signals: (Array.isArray(prediction.signals) ? prediction.signals : []).slice(0, maxSignals),
    history: (Array.isArray(prediction.history) ? prediction.history : []).slice(-maxHistory),
  };
}

function predictionPayloadFingerprint(payload = {}) {
  const stable = {
    version: Number(payload.version) || 1,
    signals: Array.isArray(payload.signals) ? payload.signals : [],
    history: Array.isArray(payload.history) ? payload.history : [],
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function createPredictionPersistenceGate(options = {}) {
  const heartbeatMs = Math.max(5_000, Number(options.heartbeatMs) || 60_000);
  const now = typeof options.now === "function" ? options.now : Date.now;
  let lastFingerprint = null;
  let lastWriteAtMs = 0;

  function markLoaded(payload, loadedAtMs = now()) {
    lastFingerprint = predictionPayloadFingerprint(payload);
    lastWriteAtMs = Number.isFinite(Number(loadedAtMs)) ? Number(loadedAtMs) : now();
  }

  function shouldWrite(payload, writeOptions = {}) {
    const currentTimeMs = now();
    const fingerprint = predictionPayloadFingerprint(payload);
    const force = writeOptions.force === true;
    const changed = fingerprint !== lastFingerprint;
    const heartbeatDue = currentTimeMs - lastWriteAtMs >= heartbeatMs;
    if (!force && !changed && !heartbeatDue) {
      return { write: false, reason: "unchanged_before_heartbeat", fingerprint, currentTimeMs };
    }
    return {
      write: true,
      reason: force ? "forced" : changed ? "state_changed" : "heartbeat_due",
      fingerprint,
      currentTimeMs,
    };
  }

  function markWritten(fingerprint, writtenAtMs = now()) {
    lastFingerprint = String(fingerprint || "");
    lastWriteAtMs = Number.isFinite(Number(writtenAtMs)) ? Number(writtenAtMs) : now();
  }

  function status() {
    return { heartbeatMs, lastFingerprint, lastWriteAtMs };
  }

  return { heartbeatMs, markLoaded, markWritten, shouldWrite, status };
}

export {
  canonicalPredictionPayload,
  createPredictionPersistenceGate,
  predictionPayloadFingerprint,
};
