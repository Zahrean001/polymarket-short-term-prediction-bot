function buildExitEngineStatus() {
  return {
    enabled: process.env.EXIT_ENGINE_ENABLED !== "0",
    mode: "paper_simulated",
    triggers: ["target_capture", "volume_spike", "odds_reversal", "time_decay", "force_near_end", "stair_exit"],
    targetCaptureRatio: Number(process.env.EXIT_TARGET_CAPTURE_RATIO || 0.75),
    volumeSpikeMultiplier: Number(process.env.EXIT_VOLUME_SPIKE_MULTIPLIER || 3),
    maxHoldSeconds: Number(process.env.EXIT_MAX_HOLD_SECONDS || 120),
    forceSecondsLeft: Number(process.env.EXIT_FORCE_SECONDS_LEFT || 8),
    oddsReversalThreshold: Number(process.env.EXIT_ODDS_REVERSAL_THRESHOLD || 0.05),
    updatedAt: new Date().toISOString(),
  };
}

export { buildExitEngineStatus };
