import fs from "node:fs";
import path from "node:path";

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function dateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function appendJsonl(filePath, row) {
  try {
    ensureDir(filePath);
    fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`);
    return true;
  } catch {
    // Logging must never stop the trading loop.
    return false;
  }
}

function compactKey(row = {}, fields = []) {
  return fields.map((field) => {
    const pathParts = field.split(".");
    let value = row;
    for (const part of pathParts) value = value?.[part];
    return `${field}=${typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}`;
  }).join("|");
}

function createAuditLogger(dataDir, options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const intervals = {
    snapshot: Math.max(0, Number(options.snapshotDedupeMs) || 0),
    decision: Math.max(0, Number(options.decisionDedupeMs) || 0),
    strategy: Math.max(0, Number(options.strategyDedupeMs) || 0),
    gate: Math.max(0, Number(options.gateDedupeMs) || 0),
    event: Math.max(0, Number(options.eventDedupeMs) || 0),
  };
  const lastRows = new Map();
  const maximumKeys = Math.max(128, Number(options.maximumDedupeKeys) || 4_096);

  function rateLimited(channel, filePath, row, key, intervalMs = intervals[channel] || 0) {
    if (!intervalMs) return appendJsonl(filePath, row);
    const nowMs = now();
    const mapKey = `${channel}:${key}`;
    const previous = lastRows.get(mapKey);
    if (previous && nowMs - previous.writtenAtMs < intervalMs) {
      previous.suppressedRepeats += 1;
      return false;
    }
    const output = previous?.suppressedRepeats
      ? { ...row, suppressedRepeats: previous.suppressedRepeats }
      : row;
    const written = appendJsonl(filePath, output);
    if (written) {
      lastRows.delete(mapKey);
      lastRows.set(mapKey, { writtenAtMs: nowMs, suppressedRepeats: 0 });
      while (lastRows.size > maximumKeys) lastRows.delete(lastRows.keys().next().value);
    }
    return written;
  }

  return {
    snapshot(row) {
      const key = compactKey(row, [
        "slug", "symbol", "timeframe", "predictedOutcome", "tradeable", "status", "reason",
        "selectedStrategy", "selectedProbability", "upBuyPrice", "downBuyPrice",
        "eligibilityEpisode.bookGeneration", "eligibilityEpisode.chainlinkGeneration",
      ]);
      return rateLimited("snapshot", path.join(dataDir, "snapshots", `${dateKey()}.jsonl`), row, key);
    },
    checkpoint(row) {
      appendJsonl(path.join(dataDir, "research", "canonical-checkpoints", `${dateKey()}.jsonl`), row);
    },
    signal(row) {
      appendJsonl(path.join(dataDir, "signals", `${dateKey()}.jsonl`), row);
    },
    settlement(row) {
      appendJsonl(path.join(dataDir, "settlements", `${dateKey()}.jsonl`), row);
    },
    decision(row) {
      const key = compactKey(row, [
        "market", "symbol", "timeframe", "selectedOutcome", "tradeable", "reason",
        "executionStatus", "rejectionCategory", "feeAdjustedEdge", "confidence",
      ]);
      return rateLimited("decision", path.join(dataDir, "decisions", `${dateKey()}.jsonl`), row, key);
    },
    strategy(row) {
      const strategy = String(row?.strategy || "unknown").replace(/[^a-z0-9_-]/gi, "_");
      const key = compactKey(row, ["strategy", "slug", "side", "approved", "reason", "bookEconomicRevision"]);
      return rateLimited("strategy", path.join(dataDir, "strategies", strategy, `${dateKey()}.jsonl`), row, key);
    },
    gate(row) {
      const key = compactKey(row, ["market", "strategy", "side", "approved", "reason", "blockedAt"]);
      return rateLimited("gate", path.join(dataDir, "gates", `${dateKey()}.jsonl`), row, key);
    },
    event(row) {
      const isIdleObserverRefresh = row?.reason === "observer_settlement_policy_refreshed" &&
        Number(row?.status?.newOfficialSettlements || 0) === 0;
      const intervalMs = isIdleObserverRefresh ? intervals.event : 0;
      const key = compactKey(row, ["reason", "type", "status.officialUniqueCount", "status.reliable"]);
      return rateLimited("event", path.join(dataDir, "events", `${dateKey()}.jsonl`), row, key, intervalMs);
    },
    report(name, payload) {
      try {
        const filePath = path.join(dataDir, "reports", name);
        ensureDir(filePath);
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
      } catch {
        // Ignore.
      }
    },
  };
}

export { compactKey, createAuditLogger };
