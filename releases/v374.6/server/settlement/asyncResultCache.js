class AsyncResultCache {
  constructor(options = {}) {
    this.hitTtlMs = Math.max(0, Number(options.hitTtlMs || 300_000));
    this.missTtlMs = Math.max(0, Number(options.missTtlMs || 2_500));
    this.now = typeof options.now === "function" ? options.now : Date.now;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  async getOrLoad(key, loader) {
    const normalizedKey = String(key || "");
    if (!normalizedKey) return loader();
    const now = this.now();
    const cached = this.cache.get(normalizedKey);
    if (cached && cached.expiresAt > now) return cached.value;
    if (cached) this.cache.delete(normalizedKey);
    if (this.inFlight.has(normalizedKey)) return this.inFlight.get(normalizedKey);

    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        const ttlMs = value === null || value === undefined ? this.missTtlMs : this.hitTtlMs;
        if (ttlMs > 0) this.cache.set(normalizedKey, { value: value ?? null, expiresAt: this.now() + ttlMs });
        return value ?? null;
      })
      .finally(() => {
        this.inFlight.delete(normalizedKey);
      });
    this.inFlight.set(normalizedKey, promise);
    return promise;
  }

  clear(key) {
    if (key === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(String(key));
  }
}

export { AsyncResultCache };
