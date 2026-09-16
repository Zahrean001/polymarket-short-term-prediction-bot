function finiteProbability(value) {
  const probability = Number(value);
  return Number.isFinite(probability) && probability > 0 && probability < 1
    ? probability
    : null;
}

function staticCoreResult(assetProbability, reason, policyStatus = null) {
  return {
    applied: false,
    reason,
    assetProbability,
    effectiveProbability: assetProbability,
    policyStatus: policyStatus || {
      valid: false,
      reason: "observer_execution_hard_disabled",
    },
  };
}

/**
 * Keeps every observer policy outside the frozen main execution path unless a
 * future, separately reviewed release explicitly enables it. V374.7 runtime
 * validation forbids that enable flag, so the only deployable branch is the
 * exact Static Core probability returned below.
 */
function resolveObserverExecutionProbability(options = {}) {
  const input = options.input || {};
  const assetProbability = finiteProbability(input.assetProbability);
  if (assetProbability === null) {
    return staticCoreResult(null, "asset_probability_invalid");
  }
  if (options.executionEnabled !== true) {
    return staticCoreResult(assetProbability, "observer_telemetry_only_frozen_control");
  }

  const reader = options.reader;
  if (!reader || typeof reader.effectiveProbability !== "function") {
    return staticCoreResult(assetProbability, "static_core_fallback:observer_reader_unavailable");
  }
  try {
    const candidate = reader.effectiveProbability(input, options.now);
    const effectiveProbability = finiteProbability(candidate?.effectiveProbability);
    if (effectiveProbability === null) {
      return staticCoreResult(
        assetProbability,
        "static_core_fallback:observer_probability_invalid",
        candidate?.policyStatus,
      );
    }
    return candidate;
  } catch (error) {
    return staticCoreResult(assetProbability, "static_core_fallback:observer_reader_failed", {
      valid: false,
      reason: "observer_reader_failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export { resolveObserverExecutionProbability };
