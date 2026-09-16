function createCheckpointObserver(options = {}) {
  const checkpoints = (options.checkpoints || [60, 90, 120, 150, 180, 210, 240])
    .map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const toleranceSeconds = Math.max(0, Number(options.toleranceSeconds ?? 1));
  const emitted = new Set();
  return {
    consider(row = {}) {
      const slug = String(row.slug || "").trim();
      const seconds = Number(row.secondsIntoWindow);
      if (!slug || !Number.isFinite(seconds)) return null;
      const checkpoint = checkpoints.find((value) => Math.abs(seconds - value) <= toleranceSeconds);
      if (!Number.isFinite(checkpoint)) return null;
      const key = `${slug}:${checkpoint}`;
      if (emitted.has(key)) return null;
      emitted.add(key);
      return {
        ...row,
        recordType: "canonical_checkpoint",
        checkpointSeconds: checkpoint,
        observerOnly: true,
        executionEligible: false,
      };
    },
    size() { return emitted.size; },
  };
}

export { createCheckpointObserver };
